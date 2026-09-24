/**
 * 隔离 matcher 服务（P2-08 剩余项）：把选择器/规则的 RegExp/minimatch 求值
 * 放进可终止的独立 worker 进程，灾难性 regex（ReDoS）不再阻塞 backend 事件
 * 循环——日志服务、取消与健康检查在同进程保持响应（Plan 03 §日志/§选择与转换
 * 计划："可能长时间运行的正则仍须在可终止进程中执行"、"异常 regex 在可终止
 * 任务中执行，不能阻塞日志服务"）。
 *
 * 设计：
 * - 单 worker（CPU 求值无并行收益；串行队列保持语义简单），挂死/死亡后补员；
 * - 每个请求独立 deadline（默认 2000ms）：超时 → 整树终止 worker（ProcessScope）
 *   → 该请求以 MatcherTimeoutError 拒绝 → 补员，后续请求不受影响；
 * - 协议为 backend 内部帧通道（matcher-worker.mjs，非跨角色契约）；
 * - 语义与进程内 buildMatchStringRule 完全一致（worker 复用同一实现），
 *   差分由测试逐对断言。
 *
 * BD-M4（新）：隔离域求值超时 → 该规则按"不匹配任何输入"处理（fail-closed）
 * + 诊断；旧版等价场景是渲染进程白屏卡死。由 SelectionRuleService 落实。
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createProcessScope, type ProcessScope } from "@xresconv/guardian";
import { FrameDecoder, writeFrame } from "@xresconv/ipc";

export class MatcherTimeoutError extends Error {
  readonly rule: string;
  readonly deadlineMs: number;

  constructor(rule: string, deadlineMs: number) {
    super(
      `matcher worker deadline exceeded (${String(deadlineMs)}ms) for rule ${rule.slice(0, 80)}`,
    );
    this.name = "MatcherTimeoutError";
    this.rule = rule;
    this.deadlineMs = deadlineMs;
  }
}

export class MatcherWorkerExitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatcherWorkerExitError";
  }
}

export interface MatcherServiceOptions {
  /** worker 入口；缺省 packages/backend/bin/matcher-worker.mjs。 */
  workerEntry?: string;
  /** 单请求求值上限（毫秒），默认 2000。 */
  deadlineMs?: number;
  /** worker 握手上限（毫秒），默认 5000。 */
  spawnDeadlineMs?: number;
  /** 进程树作用域工厂（测试可注入降级后端）。 */
  createScope?: () => ProcessScope;
  /** 诊断回调（超时/死亡/补员/协议违规）。 */
  onDiag?: (message: string) => void;
}

interface MatchRequest {
  id: string;
  count: number;
  resolve: (results: boolean[]) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface WorkerSlot {
  child: ChildProcess;
  scope: ProcessScope;
  pid: number | undefined;
  ready: boolean;
  dead: boolean;
  killing: boolean;
  cleanup: Promise<void> | null;
}

function defaultWorkerEntry(): string {
  return fileURLToPath(new URL("../../bin/matcher-worker.mjs", import.meta.url));
}

export class MatcherService {
  private readonly workerEntry: string;
  private readonly deadlineMs: number;
  private readonly spawnDeadlineMs: number;
  private readonly createScope: () => ProcessScope;
  private readonly onDiag: (message: string) => void;
  private slot: WorkerSlot | null = null;
  private inFlight: MatchRequest | null = null;
  /** 串行队列尾链（worker 单并发）。 */
  private queueTail: Promise<unknown> = Promise.resolve();
  private replenishChain: Promise<unknown> = Promise.resolve();
  private readonly readyWaiters: Array<{
    resolve: (slot: WorkerSlot) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  private shuttingDown = false;
  private startPromise: Promise<void> | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private queued = 0;

  constructor(options: MatcherServiceOptions = {}) {
    this.workerEntry = options.workerEntry ?? defaultWorkerEntry();
    this.deadlineMs = options.deadlineMs ?? 2000;
    this.spawnDeadlineMs = options.spawnDeadlineMs ?? 5000;
    for (const [name, value] of [
      ["deadlineMs", this.deadlineMs],
      ["spawnDeadlineMs", this.spawnDeadlineMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) {
        throw new RangeError(`invalid matcher ${name}`);
      }
    }
    this.createScope = options.createScope ?? (() => createProcessScope({ name: "matcher" }));
    this.onDiag = options.onDiag ?? (() => {});
  }

  /** 启动首个 worker（握手有界）；幂等。 */
  start(): Promise<void> {
    if (this.shuttingDown) {
      return Promise.reject(new MatcherWorkerExitError("matcher service is shut down"));
    }
    this.startPromise ??= this.spawnWorker();
    return this.startPromise;
  }

  /** 诊断快照（pid/就绪态）；测试与运维可见性。 */
  stats(): { pid: number | undefined; ready: boolean } {
    const slot = this.slot;
    return {
      pid: slot?.pid,
      ready: slot === null ? false : slot.ready && !slot.dead && !slot.killing,
    };
  }

  /**
   * 批量求值：同一条规则对 inputs 顺序求值（worker 内编译一次并复用
   * buildMatchStringRule，旧版懒缓存语义等价）。超时/死亡只拒绝本请求。
   */
  matchBatch(rule: string, inputs: readonly string[]): Promise<boolean[]> {
    if (this.shuttingDown || this.queued >= 128) {
      return Promise.reject(
        new MatcherWorkerExitError("matcher is shut down or queue limit reached"),
      );
    }
    const snapshot = [...inputs];
    this.queued++;
    // 串行化：一个 worker 同一时刻只处理一个请求（单并发，CPU 求值）。
    const result = this.queueTail
      .then(() => this.dispatch(rule, snapshot))
      .finally(() => {
        this.queued--;
      });
    this.queueTail = result.catch(() => undefined);
    return result;
  }

  /** 终止 worker 并拒绝在途/排队请求。幂等；不补员。 */
  shutdown(): Promise<void> {
    if (this.shutdownPromise !== null) return this.shutdownPromise;
    this.shuttingDown = true;
    const slot = this.slot;
    this.slot = null;
    this.settleInFlight(new MatcherWorkerExitError("matcher service shut down"));
    for (const waiter of this.readyWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new MatcherWorkerExitError("matcher service shut down"));
    }
    this.shutdownPromise = (async () => {
      if (slot !== null) await this.killSlot(slot);
      await this.replenishChain;
      await this.queueTail;
    })();
    return this.shutdownPromise;
  }

  /** 等待就绪 slot（补员窗口内的排队请求等补员完成而非失败）；有界。 */
  private waitReadySlot(): Promise<WorkerSlot> {
    const current = this.slot;
    if (current !== null) {
      if (current.ready && !current.dead && !current.killing) {
        return Promise.resolve(current);
      }
    }
    if (this.shuttingDown) {
      return Promise.reject(new MatcherWorkerExitError("matcher service is shut down"));
    }
    const { promise, resolve, reject } = Promise.withResolvers<WorkerSlot>();
    const timer = setTimeout(() => {
      const index = this.readyWaiters.findIndex((w) => w.resolve === resolve);
      if (index >= 0) {
        this.readyWaiters.splice(index, 1);
      }
      reject(new MatcherWorkerExitError("matcher worker not ready before deadline"));
    }, this.spawnDeadlineMs + 1000);
    this.readyWaiters.push({ resolve, reject, timer });
    return promise;
  }

  private async dispatch(rule: string, inputs: readonly string[]): Promise<boolean[]> {
    const slot = await this.waitReadySlot();
    if (this.shuttingDown || slot.dead || slot.killing || slot !== this.slot) {
      throw new MatcherWorkerExitError("matcher worker no longer available");
    }
    const stdin = slot.child.stdin;
    if (stdin === null) {
      return Promise.reject(new MatcherWorkerExitError("matcher worker stdin closed"));
    }
    const { promise, resolve, reject } = Promise.withResolvers<boolean[]>();
    const request: MatchRequest = {
      id: randomUUID(),
      count: inputs.length,
      resolve,
      reject,
      timer: setTimeout(() => {
        this.settleInFlight(new MatcherTimeoutError(rule, this.deadlineMs));
        this.onDiag(`matcher request timed out after ${String(this.deadlineMs)}ms; worker killed`);
        void this.killAndReplenish(slot, "match deadline exceeded");
      }, this.deadlineMs),
    };
    this.inFlight = request;
    writeFrame(stdin, { type: "match", id: request.id, rule, inputs: [...inputs] }).catch(
      (err: unknown) => {
        if (this.inFlight !== request || this.slot !== slot) return;
        this.settleInFlight(new MatcherWorkerExitError(`matcher write failed: ${String(err)}`));
        void this.killAndReplenish(slot, "write failure");
      },
    );
    return promise;
  }

  private settleInFlight(error: Error | null, results?: boolean[]): void {
    const request = this.inFlight;
    if (request === null) {
      return;
    }
    this.inFlight = null;
    clearTimeout(request.timer);
    if (error !== null) {
      request.reject(error);
    } else {
      request.resolve(results as boolean[]);
    }
  }

  private spawnWorker(): Promise<void> {
    const scope = this.createScope();
    const child = spawn(process.execPath, [this.workerEntry], {
      ...scope.decorateSpawnOptions({ stdio: ["pipe", "pipe", "pipe"] }),
    });
    scope.register(child);
    const slot: WorkerSlot = {
      child,
      scope,
      pid: child.pid,
      ready: false,
      dead: false,
      killing: false,
      cleanup: null,
    };
    this.slot = slot;
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const handshakeTimer = setTimeout(() => {
      void this.killSlot(slot);
      reject(new MatcherWorkerExitError("matcher worker handshake timeout"));
    }, this.spawnDeadlineMs);
    const decoder = new FrameDecoder(
      (value: unknown) => {
        if (slot.dead || slot.killing || this.shuttingDown || this.slot !== slot) {
          return;
        }
        const msg = value as Record<string, unknown>;
        if (typeof msg !== "object" || msg === null) {
          this.settleInFlight(new MatcherWorkerExitError("invalid matcher reply"));
          void this.killAndReplenish(slot, "invalid reply");
          return;
        }
        if (!slot.ready) {
          if (
            typeof msg === "object" &&
            msg !== null &&
            msg.type === "ready" &&
            msg.pid === slot.pid
          ) {
            clearTimeout(handshakeTimer);
            slot.ready = true;
            for (const waiter of this.readyWaiters.splice(0)) {
              clearTimeout(waiter.timer);
              waiter.resolve(slot);
            }
            resolve();
          } else {
            clearTimeout(handshakeTimer);
            void this.killSlot(slot);
            reject(new MatcherWorkerExitError("matcher worker invalid handshake"));
          }
          return;
        }
        if (msg.type === "result" && typeof msg.id === "string" && Array.isArray(msg.results)) {
          const request = this.inFlight;
          if (request === null || request.id !== msg.id) {
            this.onDiag("matcher reply for unknown/stale request, ignored");
            return;
          }
          if (
            msg.results.length !== request.count ||
            msg.results.some((value) => typeof value !== "boolean")
          ) {
            this.settleInFlight(
              new MatcherWorkerExitError("invalid matcher result cardinality or value"),
            );
            void this.killAndReplenish(slot, "invalid result");
            return;
          }
          this.settleInFlight(null, msg.results as boolean[]);
          return;
        }
        if (msg.type === "error") {
          const request = this.inFlight;
          if (request !== null && request.id === msg.id) {
            this.settleInFlight(
              new MatcherWorkerExitError(`matcher request rejected: ${String(msg.message)}`),
            );
          }
          return;
        }
        this.onDiag("matcher worker sent unexpected frame, ignored");
      },
      (error) => {
        if (this.slot !== slot || slot.dead || slot.killing) return;
        this.onDiag(`matcher frame decode error (${error.code}): ${error.message}`);
        this.settleInFlight(new MatcherWorkerExitError("matcher channel poisoned"));
        void this.killAndReplenish(slot, "frame decode error");
      },
    );
    child.stdout?.on("data", (chunk: Buffer) => decoder.push(chunk));
    child.on("error", (error) => {
      clearTimeout(handshakeTimer);
      reject(new MatcherWorkerExitError(`matcher spawn failed: ${error.message}`));
      if (this.slot === slot) this.settleInFlight(new MatcherWorkerExitError(error.message));
      void this.killSlot(slot);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.onDiag(`[matcher-worker] ${chunk.toString("utf8").trimEnd()}`);
    });
    child.on("close", (code, signal) => {
      clearTimeout(handshakeTimer);
      slot.dead = true;
      void slot.scope.dispose();
      if (!slot.ready) {
        reject(
          new MatcherWorkerExitError(
            `matcher worker exited before handshake (code ${String(code)})`,
          ),
        );
        return;
      }
      if (!slot.killing && !this.shuttingDown) {
        this.onDiag(
          `matcher worker exited unexpectedly (code ${String(code)}, signal ${String(
            signal,
          )}); replenishing`,
        );
        this.settleInFlight(new MatcherWorkerExitError("matcher worker exited mid-request"));
        this.replenish();
      }
    });
    return promise;
  }

  /** 补员（串行化，避免并发双 spawn）。 */
  private replenish(): void {
    if (this.shuttingDown) {
      return;
    }
    this.replenishChain = this.replenishChain.then(async () => {
      if (this.shuttingDown || (this.slot !== null && !this.slot.dead)) {
        return;
      }
      await this.spawnWorker().catch((err: unknown) => {
        this.onDiag(`matcher worker replenish failed: ${String(err)}`);
      });
    });
  }

  private async killAndReplenish(slot: WorkerSlot, reason: string): Promise<void> {
    await this.killSlot(slot);
    if (!this.shuttingDown) {
      this.onDiag(`matcher worker killed (${reason}); replenishing`);
      this.replenish();
    }
  }

  private killSlot(slot: WorkerSlot): Promise<void> {
    if (slot.cleanup !== null) return slot.cleanup;
    slot.killing = true;
    slot.cleanup = (async () => {
      try {
        const report = await slot.scope.terminate(500);
        if (report.unreapedPids.length > 0)
          this.onDiag(`matcher cleanup unconfirmed: ${report.unreapedPids.join(",")}`);
      } finally {
        await slot.scope.dispose();
      }
    })();
    return slot.cleanup;
  }
}
