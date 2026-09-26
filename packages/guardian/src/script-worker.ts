/**
 * Guardian: script-worker pool (P2-01). Owns spawn/handshake/invoke routing
 * between the guardian and the P2-03 script worker (packages/script-host):
 * framed envelopes on fd0/fd1 (@xresconv/ipc), worker diagnostics on fd2.
 *
 * Behavior contract: docs/plan/records/P2-01.md (BD-W entries). The worker
 * side protocol is frozen in packages/contracts/schema (envelope,
 * script-invoke, script-result) and implemented in P2-03.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Envelope, ScriptInvoke, ScriptResult } from "@xresconv/contracts";
import { PROTOCOL_VERSION, validate } from "@xresconv/contracts";
import { FrameDecoder, writeFrame } from "@xresconv/ipc";
import { createProcessScope, type ProcessScope } from "./process-tree.ts";

/**
 * Default pool size 1: button-script `data` and require.cache live inside a
 * single worker process (P2-03), so session affinity matters; scale out only
 * when the caller accepts that (BD-W5).
 */
const DEFAULT_POOL_SIZE = 1;
/** Health handshake deadline after spawn. */
const DEFAULT_SPAWN_DEADLINE_MS = 5000;
/** Grace added to req.timeout_ms for the default invoke deadline. */
const INVOKE_TIMEOUT_GRACE_MS = 2000;
/** SIGTERM -> SIGKILL escalation grace when destroying a worker. */
const KILL_GRACE_MS = 1000;
/** Wait for a worker to exit after the shutdown frame before SIGKILL. */
const SHUTDOWN_EXIT_WAIT_MS = 2000;
/** Retained stderr bytes per worker, for diagnostics. */
const STDERR_TAIL_BYTES = 4096;
/**
 * 未应答弹框的默认保留上限（P2-06，BD-W10）：旧版 modal 无限期挂着（ESC 还不
 * 回调 → BD-06 挂起），新架构 pool/worker 长命，必须给未应答弹框一个有界留存；
 * 过期按 ESC 语义应答 null（无回调）并通知 UI 关闭。30 分钟对正常交互足够宽。
 */
const DEFAULT_DIALOG_TIMEOUT_MS = 30 * 60_000;

export type DialogChoice = "yes" | "no" | null;

/** Diagnostic side channel; interleaves with kind:"log" envelopes on onLog. */
export interface WorkerDiag {
  source: "worker-stderr" | "worker-fault" | "worker-exit";
  pid: number | undefined;
  line: string;
}

export type WorkerInvokeErrorCode =
  | "WORKER_TIMEOUT"
  | "WORKER_EXIT"
  | "WORKER_FAULT"
  | "NO_WORKER_AVAILABLE"
  | "POOL_SHUTDOWN";

export class WorkerInvokeError extends Error {
  readonly code: WorkerInvokeErrorCode;
  readonly exitCode: number | null | undefined;

  constructor(code: WorkerInvokeErrorCode, message: string, exitCode?: number | null) {
    super(message);
    this.name = "WorkerInvokeError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export interface ScriptWorkerPoolOptions {
  /** Workers kept alive concurrently (default 1, see BD-W5). */
  size?: number;
  /** Worker entry path; defaults to packages/script-host/bin/worker.mjs. */
  workerEntry?: string;
  /** Health handshake deadline per spawned worker. */
  spawnDeadlineMs?: number;
  /** 追加给 worker Node 的参数（如 ["--max-old-space-size=64"]，P2-07 资源限额）。 */
  workerNodeArgs?: string[];
  /**
   * V8 堆上限（MB，P2-07）：等价于追加 `--max-old-space-size=N`。只覆盖 V8 堆；
   * Buffer/原生内存走 RSS 看门狗（memoryLimitBytes）。
   */
  workerMaxOldSpaceMb?: number;
  /**
   * 每 worker RSS 看门狗上限（字节，P2-07，BD-W11）：worker 周期自报
   * memoryUsage（health envelope 携带），超出即销毁并按 WORKER_EXIT 结算在途
   * invocation，随后补员。缺省不限制（只记录峰值）。
   */
  memoryLimitBytes?: number;
  /** 每 worker 的进程树作用域工厂（P2-02）；测试可注入降级后端。 */
  createScope?: () => ProcessScope;
  /** 未应答弹框保留上限（毫秒，默认 30min，BD-W10）；过期按 null 应答并失效。 */
  dialogTimeoutMs?: number;
  /**
   * 追加给 worker 进程的环境变量（P2-04 环境策略/P2-10 发行锚点），覆盖在
   * 继承的 process.env 之上；值 undefined 表示删除该键。发行接线（P5-02 落地）：
   * guardian 按发行布局自定位 app 根，经 backendEnv 接力，backend 将
   * XRESCONV_SCRIPT_MODULE_DIRS 显式注入本选项（锚点是布局约定，不经
   * manifest 传输，见 docs/plan/records/P5-02.md 偏差说明）。
   */
  workerEnv?: Record<string, string | undefined>;
}

/** 在途弹框（P2-06）：worker 发过 dialog_request 但未最终化的条目。 */
interface PendingDialog {
  readonly key: string;
  readonly slot: WorkerSlot;
  readonly env: Envelope;
  readonly createdAt: number;
  answered: boolean;
}

interface PendingInvocation {
  readonly envelopeId: string;
  readonly invocationId: string;
  readonly slot: WorkerSlot;
  readonly resolve: (result: ScriptResult) => void;
  readonly reject: (err: WorkerInvokeError) => void;
  readonly timer: NodeJS.Timeout;
}

interface WorkerSlot {
  readonly child: ChildProcess;
  readonly pid: number | undefined;
  /** 该 worker 的进程树作用域（P2-02）；终止覆盖脚本派生的子孙进程。 */
  readonly scope: ProcessScope;
  ready: boolean;
  exited: boolean;
  /** Protocol-fault discard: never replenished (BD-W1). */
  discarded: boolean;
  /** Deliberate kill in progress (timeout destroy / fault / shutdown). */
  killing: boolean;
  inflightCount: number;
  /** Total invocations assigned; exposed via stats(). */
  served: number;
  stderrLine: string;
  stderrTail: string;
  /** 最近一次健康自报（P2-07）；握手帧不带 memory 时为 undefined。 */
  lastMemory?: { rss: number; heapUsed: number; heapTotal: number };
  /** 观测到的 RSS 峰值（字节）；stats() 透出。 */
  maxRssBytes: number;
}

export interface WorkerStat {
  pid: number | undefined;
  inflight: number;
  served: number;
  /** 观测到的 RSS 峰值（字节，P2-07）；未收到过自报时为 0。 */
  maxRssBytes: number;
}

function defaultWorkerEntry(): string {
  return fileURLToPath(new URL("../../script-host/bin/worker.mjs", import.meta.url));
}

export class ScriptWorkerPool {
  /** worker -> guardian dialog request; respond() answers it exactly once. */
  onDialogRequest?: (env: Envelope, respond: (choice: DialogChoice) => void) => void;
  /**
   * 弹框失效通知（P2-06）：worker 死亡、TTL 过期（BD-W10）或 dismissPendingDialogs
   * 显式收尾时触发，UI 据此关闭对应弹框；已失效弹框的迟到应答被丢弃（SC06）。
   */
  onDialogInvalidate?: (env: Envelope, reason: string) => void;
  /** kind:"log" envelopes and WorkerDiag diagnostics (stderr/fault/exit). */
  onLog?: (event: Envelope | WorkerDiag) => void;

  private readonly size: number;
  private readonly workerEntry: string;
  private readonly spawnDeadlineMs: number;
  private readonly workerNodeArgs: readonly string[];
  private readonly workerMaxOldSpaceMb: number | undefined;
  private readonly memoryLimitBytes: number | undefined;
  private readonly createScope: () => ProcessScope;
  private readonly dialogTimeoutMs: number;
  private readonly workerEnv: Record<string, string | undefined> | undefined;
  private readonly workers = new Set<WorkerSlot>();
  /** Includes starting and faulted children until their pipes actually close. */
  private readonly children = new Set<WorkerSlot>();
  private readonly pendingByKey = new Map<string, PendingInvocation>();
  private readonly pendingDialogs = new Map<string, PendingDialog>();
  private dialogSweeper: NodeJS.Timeout | null = null;
  private readonly readyWaiters: Array<{ resolve: () => void }> = [];
  private starting = 0;
  private startPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(options: ScriptWorkerPoolOptions = {}) {
    this.size = options.size ?? DEFAULT_POOL_SIZE;
    if (!Number.isSafeInteger(this.size) || this.size < 1 || this.size > 64) {
      throw new RangeError("worker pool size must be an integer in [1,64]");
    }
    this.workerEntry =
      options.workerEntry ?? process.env.XRESCONV_WORKER_ENTRY ?? defaultWorkerEntry();
    this.spawnDeadlineMs = options.spawnDeadlineMs ?? DEFAULT_SPAWN_DEADLINE_MS;
    if (
      !Number.isSafeInteger(this.spawnDeadlineMs) ||
      this.spawnDeadlineMs < 1 ||
      this.spawnDeadlineMs > 2147483647
    ) {
      throw new RangeError("invalid worker spawn deadline");
    }
    this.workerNodeArgs = options.workerNodeArgs ?? [];
    this.workerMaxOldSpaceMb = options.workerMaxOldSpaceMb;
    if (
      this.workerMaxOldSpaceMb !== undefined &&
      (!Number.isSafeInteger(this.workerMaxOldSpaceMb) || this.workerMaxOldSpaceMb < 16)
    ) {
      throw new RangeError("workerMaxOldSpaceMb must be an integer >= 16");
    }
    this.memoryLimitBytes = options.memoryLimitBytes;
    if (
      this.memoryLimitBytes !== undefined &&
      (!Number.isSafeInteger(this.memoryLimitBytes) || this.memoryLimitBytes < 1)
    ) {
      throw new RangeError("memoryLimitBytes must be a positive integer");
    }
    this.createScope = options.createScope ?? (() => createProcessScope({ name: "script-worker" }));
    this.dialogTimeoutMs = options.dialogTimeoutMs ?? DEFAULT_DIALOG_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.dialogTimeoutMs) ||
      this.dialogTimeoutMs < 1 ||
      this.dialogTimeoutMs > 2147483647
    ) {
      throw new RangeError("invalid dialog timeout");
    }
    this.workerEnv = options.workerEnv;
  }

  start(): Promise<void> {
    if (this.shuttingDown)
      return Promise.reject(new WorkerInvokeError("POOL_SHUTDOWN", "pool shut down"));
    if (this.startPromise !== null) return this.startPromise;
    this.startPromise = Promise.all(Array.from({ length: this.size }, () => this.spawnWorker()))
      .then(() => undefined)
      .catch(async (err: unknown) => {
        await this.shutdown();
        throw err;
      });
    return this.startPromise;
  }

  async invoke(req: ScriptInvoke, opts?: { timeoutMs?: number }): Promise<ScriptResult> {
    if (this.shutdownPromise !== null) {
      throw new WorkerInvokeError("POOL_SHUTDOWN", "script worker pool is shut down");
    }
    const timeoutMs = opts?.timeoutMs ?? req.timeout_ms + INVOKE_TIMEOUT_GRACE_MS;
    validate<ScriptInvoke>("script-invoke", req);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) {
      throw new RangeError("invalid invocation deadline");
    }
    // Pick + register + increment atomically (no await in between) so a burst
    // of invokes in one tick spreads across workers by inflight count.
    let slot = this.pickReadySlot();
    if (slot === null) {
      slot = await this.waitForReadySlot(timeoutMs);
    }
    if (this.shuttingDown) throw new WorkerInvokeError("POOL_SHUTDOWN", "pool shut down");
    if (this.pendingByKey.has(req.invocation_id))
      throw new WorkerInvokeError("WORKER_FAULT", "duplicate invocation id");
    const { promise, resolve, reject } = Promise.withResolvers<ScriptResult>();
    const pending: PendingInvocation = {
      envelopeId: randomUUID(),
      invocationId: req.invocation_id,
      slot,
      resolve,
      reject,
      timer: setTimeout(() => this.timeoutInvocation(slot, req.invocation_id), timeoutMs),
    };
    this.pendingByKey.set(pending.envelopeId, pending);
    this.pendingByKey.set(pending.invocationId, pending);
    slot.inflightCount += 1;
    slot.served += 1;
    const stdin = slot.child.stdin;
    if (stdin === null) {
      this.settlePending(pending, new WorkerInvokeError("WORKER_FAULT", "worker stdin closed"));
      return promise;
    }
    writeFrame(stdin, {
      protocol_version: PROTOCOL_VERSION,
      kind: "invoke",
      id: pending.envelopeId,
      role: "guardian",
      invocation_id: req.invocation_id,
      payload: req,
    }).catch((err: unknown) => {
      this.settlePending(
        pending,
        new WorkerInvokeError("WORKER_FAULT", `invoke write failed: ${String(err)}`),
      );
    });
    return promise;
  }

  /** Ready workers with assignment counters (diagnostics + tests). */
  stats(): WorkerStat[] {
    return [...this.workers].map((slot) => ({
      pid: slot.pid,
      inflight: slot.inflightCount,
      served: slot.served,
      maxRssBytes: slot.maxRssBytes,
    }));
  }

  /** Sends shutdown to every worker, waits for exit (2s), SIGKILLs stragglers. Idempotent. */
  shutdown(): Promise<void> {
    if (this.shutdownPromise !== null) {
      return this.shutdownPromise;
    }
    this.shuttingDown = true;
    if (this.dialogSweeper !== null) {
      clearInterval(this.dialogSweeper);
      this.dialogSweeper = null;
    }
    this.notifyReady();
    this.shutdownPromise = (async () => {
      const exits: Promise<void>[] = [];
      for (const slot of this.children) {
        exits.push(this.shutdownWorker(slot));
      }
      await Promise.all(exits);
      for (const pending of new Set(this.pendingByKey.values())) {
        this.settlePending(pending, new WorkerInvokeError("POOL_SHUTDOWN", "pool shut down"));
      }
    })();
    return this.shutdownPromise;
  }

  private pickReadySlot(): WorkerSlot | null {
    let best: WorkerSlot | null = null;
    for (const slot of this.workers) {
      if (!slot.ready || slot.killing) {
        continue;
      }
      if (best === null || slot.inflightCount < best.inflightCount) {
        best = slot;
      }
    }
    return best;
  }

  /** No ready worker: only wait when a spawn/replenish is already in flight. */
  private async waitForReadySlot(timeoutMs: number): Promise<WorkerSlot> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.shuttingDown) {
        throw new WorkerInvokeError("POOL_SHUTDOWN", "script worker pool is shut down");
      }
      const slot = this.pickReadySlot();
      if (slot !== null) {
        return slot;
      }
      if (
        this.starting <= 0 &&
        ![...this.children].some((child) => child.killing && !child.discarded)
      ) {
        throw new WorkerInvokeError("NO_WORKER_AVAILABLE", "no healthy script worker in pool");
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new WorkerInvokeError("WORKER_TIMEOUT", "no worker became ready before deadline");
      }
      const { promise, resolve } = Promise.withResolvers<void>();
      const waiter = { resolve };
      this.readyWaiters.push(waiter);
      const timer = setTimeout(() => {
        const index = this.readyWaiters.indexOf(waiter);
        if (index >= 0) {
          this.readyWaiters.splice(index, 1);
        }
        resolve();
      }, remaining);
      await promise;
      clearTimeout(timer);
    }
  }

  private notifyReady(): void {
    for (const waiter of this.readyWaiters.splice(0)) {
      waiter.resolve();
    }
  }

  private spawnWorker(): Promise<WorkerSlot> {
    this.starting += 1;
    const { promise, resolve, reject } = Promise.withResolvers<WorkerSlot>();
    const scope = this.createScope();
    const child = spawn(
      process.execPath,
      [
        ...(this.workerMaxOldSpaceMb === undefined
          ? []
          : [`--max-old-space-size=${String(this.workerMaxOldSpaceMb)}`]),
        ...this.workerNodeArgs,
        this.workerEntry,
      ],
      scope.decorateSpawnOptions({
        stdio: ["pipe", "pipe", "pipe"],
        ...(this.workerEnv === undefined ? {} : { env: { ...process.env, ...this.workerEnv } }),
      }),
    );
    scope.register(child);
    const slot: WorkerSlot = {
      child,
      pid: child.pid,
      scope,
      ready: false,
      exited: false,
      discarded: false,
      killing: false,
      inflightCount: 0,
      served: 0,
      stderrLine: "",
      stderrTail: "",
      maxRssBytes: 0,
    };
    this.children.add(slot);
    const handshakeTimer = setTimeout(() => {
      this.faultWorker(slot, `health handshake timeout after ${this.spawnDeadlineMs}ms`);
      reject(
        new WorkerInvokeError(
          "WORKER_FAULT",
          `script worker did not send health within ${this.spawnDeadlineMs}ms`,
        ),
      );
    }, this.spawnDeadlineMs);
    const decoder = new FrameDecoder(
      (value) => {
        if ((slot.killing && !slot.ready) || slot.discarded || slot.exited) return;
        if (!slot.ready) {
          clearTimeout(handshakeTimer);
          try {
            this.handleFirstFrame(slot, value);
            resolve(slot);
          } catch (err) {
            reject(err);
          }
          return;
        }
        this.handleEnvelope(slot, value);
      },
      (error) => {
        const reason = `frame decode error (${error.code}): ${error.message}`;
        if (!slot.ready) {
          clearTimeout(handshakeTimer);
        }
        this.faultWorker(slot, reason);
        reject(new WorkerInvokeError("WORKER_FAULT", reason));
      },
    );
    child.stdout?.on("data", (chunk: Buffer) => decoder.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.handleStderr(slot, chunk));
    child.on("error", (err) => {
      if (!slot.ready) {
        clearTimeout(handshakeTimer);
        reject(new WorkerInvokeError("WORKER_FAULT", `worker spawn failed: ${err.message}`));
      }
    });
    child.on("close", (code, signal) => {
      clearTimeout(handshakeTimer);
      if (!slot.ready)
        reject(new WorkerInvokeError("WORKER_EXIT", "worker closed before health handshake", code));
      this.handleExit(slot, code, signal);
    });
    return promise.finally(() => {
      this.starting -= 1;
      this.notifyReady();
    });
  }

  /** First frame MUST be the health envelope; anything else faults the worker. */
  private handleFirstFrame(slot: WorkerSlot, value: unknown): void {
    let env: Envelope;
    try {
      env = validate<Envelope>("envelope", value);
    } catch (err) {
      const reason = `first frame is not a valid envelope: ${String(err)}`;
      this.faultWorker(slot, reason);
      throw new WorkerInvokeError("WORKER_FAULT", reason);
    }
    if (
      env.kind !== "health" ||
      env.role !== "script-worker" ||
      env.payload.ok !== true ||
      env.payload.pid !== slot.pid ||
      typeof env.payload.node !== "string" ||
      !/^v\d+\.\d+\.\d+/.test(env.payload.node)
    ) {
      const reason = "invalid script-worker health handshake";
      this.faultWorker(slot, reason);
      throw new WorkerInvokeError("WORKER_FAULT", reason);
    }
    slot.ready = true;
    this.workers.add(slot);
    this.notifyReady();
  }

  private handleEnvelope(slot: WorkerSlot, value: unknown): void {
    let env: Envelope;
    try {
      env = validate<Envelope>("envelope", value);
      if (env.role !== "script-worker") throw new Error("invalid worker role");
    } catch (err) {
      this.faultWorker(slot, `invalid envelope: ${String(err)}`);
      return;
    }
    switch (env.kind) {
      case "complete":
        this.handleComplete(slot, env);
        return;
      case "fault":
        this.handleWorkerFault(slot, env);
        return;
      case "log":
        this.onLog?.(env);
        return;
      case "dialog_request":
        this.handleDialogRequest(slot, env);
        return;
      case "health":
        this.handleHealthReport(slot, env);
        return;
      default:
        this.faultWorker(slot, `unexpected inbound kind: ${env.kind}`);
    }
  }

  /**
   * 握手后的周期性健康自报（P2-07；BD-W7 修订：不再纯忽略，作为内存样本消费）。
   * 样本是协作式的——同步死循环的 worker 无法自报，该情形由 invoke 超时销毁
   * 覆盖（BD-W3）；RSS 超限即销毁 worker（BD-W11），在途 invocation 经 exit
   * 路径按 WORKER_EXIT 结算并补员。
   */
  private handleHealthReport(slot: WorkerSlot, env: Envelope): void {
    const memory = env.payload.memory;
    if (typeof memory !== "object" || memory === null) {
      return;
    }
    const { rss, heapUsed, heapTotal } = memory as Record<string, unknown>;
    if (typeof rss !== "number" || typeof heapUsed !== "number" || typeof heapTotal !== "number") {
      return;
    }
    slot.lastMemory = { rss, heapUsed, heapTotal };
    slot.maxRssBytes = Math.max(slot.maxRssBytes, rss);
    if (
      this.memoryLimitBytes !== undefined &&
      rss > this.memoryLimitBytes &&
      !slot.killing &&
      !slot.exited
    ) {
      this.emitDiag(
        "worker-fault",
        slot.pid,
        `worker RSS ${String(rss)}B exceeds memory limit ${String(this.memoryLimitBytes)}B, destroying (BD-W11)`,
      );
      this.destroyWorker(slot);
    }
  }

  private findPending(env: Envelope): PendingInvocation | undefined {
    if (env.in_reply_to !== undefined) {
      const byReply = this.pendingByKey.get(env.in_reply_to);
      if (byReply !== undefined) {
        return byReply;
      }
    }
    if (env.invocation_id !== undefined) {
      return this.pendingByKey.get(env.invocation_id);
    }
    const fromPayload = env.payload.invocation_id;
    if (typeof fromPayload === "string") {
      return this.pendingByKey.get(fromPayload);
    }
    return undefined;
  }

  private handleComplete(slot: WorkerSlot, env: Envelope): void {
    const pending = this.findPending(env);
    if (pending === undefined || pending.slot !== slot) {
      // Late/duplicate complete (e.g. after a WORKER_TIMEOUT destroy): expected race.
      this.emitDiag("worker-stderr", slot.pid, "complete for unknown invocation, ignored");
      return;
    }
    let result: ScriptResult;
    try {
      result = validate<ScriptResult>("script-result", env.payload);
      if (
        result.invocation_id !== pending.invocationId ||
        (env.invocation_id !== undefined && env.invocation_id !== pending.invocationId) ||
        (env.in_reply_to !== undefined && env.in_reply_to !== pending.envelopeId)
      ) {
        throw new Error("completion correlation mismatch");
      }
    } catch (err) {
      this.settlePending(
        pending,
        new WorkerInvokeError("WORKER_FAULT", `invalid script-result payload: ${String(err)}`),
      );
      this.faultWorker(slot, "complete carried an invalid script-result payload");
      return;
    }
    this.settlePending(pending, null, result);
  }

  /** Worker-reported fault (bad invoke payload etc.): per-invocation, worker stays alive. */
  private handleWorkerFault(slot: WorkerSlot, env: Envelope): void {
    const message = typeof env.payload.message === "string" ? env.payload.message : "worker fault";
    this.emitDiag("worker-fault", slot.pid, message);
    const pending = this.findPending(env);
    if (pending !== undefined && pending.slot === slot) {
      this.settlePending(pending, new WorkerInvokeError("WORKER_FAULT", message));
    }
  }

  private handleDialogRequest(slot: WorkerSlot, env: Envelope): void {
    const token = env.payload.token;
    const key = typeof token === "string" && token.length > 0 ? token : env.id;
    const entry: PendingDialog = { key, slot, env, createdAt: Date.now(), answered: false };
    this.pendingDialogs.set(key, entry);
    this.ensureDialogSweeper();
    const respond = (choice: DialogChoice): void => {
      if (entry.answered || slot.killing || slot.exited) return;
      // 已失效（TTL 过期/worker 死亡/显式 dismiss）→ 过期应答不执行（SC06）。
      if (!this.pendingDialogs.has(key)) return;
      entry.answered = true;
      this.pendingDialogs.delete(key);
      const stdin = slot.child.stdin;
      if (stdin === null) {
        return;
      }
      writeFrame(stdin, {
        protocol_version: PROTOCOL_VERSION,
        kind: "dialog_respond",
        id: randomUUID(),
        role: "guardian",
        in_reply_to: typeof token === "string" ? token : env.id,
        payload: { token, choice },
      }).catch((err: unknown) => {
        this.emitDiag("worker-stderr", slot.pid, `dialog respond failed: ${String(err)}`);
      });
    };
    if (this.onDialogRequest !== undefined) {
      this.onDialogRequest(env, respond);
    } else {
      // No handler: answer ESC-equivalent so the worker is never blocked (BD-W2).
      respond(null);
    }
  }

  /** 弹框 TTL 清扫：懒启动、注册表清空即停；unref 不拖住进程退出。 */
  private ensureDialogSweeper(): void {
    if (this.dialogSweeper !== null) {
      return;
    }
    const interval = Math.min(Math.max(Math.floor(this.dialogTimeoutMs / 2), 25), 60_000);
    this.dialogSweeper = setInterval(() => this.sweepDialogs(), interval);
    this.dialogSweeper.unref();
  }

  private sweepDialogs(): void {
    if (this.pendingDialogs.size === 0) {
      if (this.dialogSweeper !== null) {
        clearInterval(this.dialogSweeper);
        this.dialogSweeper = null;
      }
      return;
    }
    const now = Date.now();
    for (const entry of [...this.pendingDialogs.values()]) {
      if (now - entry.createdAt >= this.dialogTimeoutMs) {
        this.invalidateDialog(
          entry,
          `dialog unanswered for ${String(this.dialogTimeoutMs)}ms, auto-dismissed (BD-W10)`,
        );
      }
    }
  }

  /**
   * 最终化一个弹框：从注册表删除；worker 还活着就补一条 choice=null 的应答
   * （worker 侧按 BD-06 语义最终化、不触发回调），并通知 UI 关闭。幂等。
   */
  private invalidateDialog(entry: PendingDialog, reason: string): void {
    if (!this.pendingDialogs.delete(entry.key)) {
      return;
    }
    entry.answered = true;
    const slot = entry.slot;
    if (!slot.killing && !slot.exited) {
      const stdin = slot.child.stdin;
      if (stdin !== null) {
        writeFrame(stdin, {
          protocol_version: PROTOCOL_VERSION,
          kind: "dialog_respond",
          id: randomUUID(),
          role: "guardian",
          in_reply_to: entry.key,
          payload: { token: entry.env.payload.token, choice: null },
        }).catch(() => undefined);
      }
    }
    this.onDialogInvalidate?.(entry.env, reason);
  }

  /**
   * 显式失效全部在途弹框（UI reload / 会话重建等代际切换点）：按 ESC 语义
   * 应答 null（无回调）并逐个通知。返回失效条数。
   */
  dismissPendingDialogs(reason: string): number {
    let count = 0;
    for (const entry of [...this.pendingDialogs.values()]) {
      this.invalidateDialog(entry, reason);
      count++;
    }
    return count;
  }

  private handleStderr(slot: WorkerSlot, chunk: Buffer): void {
    const text = chunk.toString("utf8");
    slot.stderrTail = (slot.stderrTail + text).slice(-STDERR_TAIL_BYTES);
    const lines = (slot.stderrLine + text).split(/\r?\n/);
    slot.stderrLine = (lines.pop() ?? "").slice(-STDERR_TAIL_BYTES);
    for (const line of lines) {
      if (line.length > 0) {
        this.emitDiag("worker-stderr", slot.pid, line);
      }
    }
  }

  private handleExit(slot: WorkerSlot, code: number | null, signal: NodeJS.Signals | null): void {
    slot.exited = true;
    this.children.delete(slot);
    const wasMember = this.workers.delete(slot);
    void slot.scope.dispose();
    for (const pending of new Set(this.pendingByKey.values())) {
      if (pending.slot === slot) {
        this.settlePending(
          pending,
          new WorkerInvokeError(
            "WORKER_EXIT",
            `worker pid ${String(slot.pid)} exited (code ${String(code)}, signal ${String(signal)})`,
            code,
          ),
        );
      }
    }
    // P2-06：worker 死亡 → 其在途弹框全部失效（不应答——进程已死），
    // UI 收到 invalidate 关闭弹框；迟到的点击应答被 respond 守卫丢弃（SC06）。
    for (const entry of [...this.pendingDialogs.values()]) {
      if (entry.slot === slot) {
        this.invalidateDialog(
          entry,
          `worker pid ${String(slot.pid)} exited; pending dialog invalidated`,
        );
      }
    }
    this.emitDiag(
      "worker-exit",
      slot.pid,
      `exit code=${String(code)} signal=${String(signal)}${slot.stderrTail ? ` stderr-tail: ${slot.stderrTail.slice(-500)}` : ""}`,
    );
    if (wasMember && !slot.discarded && !this.shuttingDown) {
      void this.spawnWorker().catch((err: unknown) => {
        this.emitDiag("worker-fault", undefined, `worker replenish failed: ${String(err)}`);
      });
    }
    this.notifyReady();
  }

  private timeoutInvocation(slot: WorkerSlot, invocationId: string): void {
    const pending = this.pendingByKey.get(invocationId);
    if (pending === undefined) {
      return;
    }
    this.settlePending(
      pending,
      new WorkerInvokeError("WORKER_TIMEOUT", `invocation ${invocationId} exceeded its deadline`),
    );
    // A worker that missed the deadline may be stuck in a sync loop: destroy
    // it; the exit handler replenishes the pool (BD-W3).
    this.destroyWorker(slot);
  }

  /** 整树终止（P2-02）；补员在 exit 处理里完成（BD-W3）。 */
  private destroyWorker(slot: WorkerSlot): void {
    if (slot.killing || slot.exited) {
      return;
    }
    slot.killing = true;
    void slot.scope.terminate(KILL_GRACE_MS).then((report) => {
      if (report.unreapedPids.length > 0) {
        this.emitDiag(
          "worker-fault",
          slot.pid,
          `worker tree cleanup unconfirmed for pids: ${report.unreapedPids.join(",")}`,
        );
      }
    });
  }

  /** Protocol fault: discard the worker WITHOUT replenishment (BD-W1). */
  private faultWorker(slot: WorkerSlot, reason: string): void {
    slot.discarded = true;
    this.emitDiag("worker-fault", slot.pid, reason);
    for (const pending of new Set(this.pendingByKey.values())) {
      if (pending.slot === slot) {
        this.settlePending(pending, new WorkerInvokeError("WORKER_FAULT", reason));
      }
    }
    this.workers.delete(slot);
    this.destroyWorker(slot);
  }

  private async shutdownWorker(slot: WorkerSlot): Promise<void> {
    if (slot.exited) {
      return;
    }
    slot.killing = true;
    const { promise: exited, resolve: markExited } = Promise.withResolvers<void>();
    slot.child.once("close", markExited);
    // Install the kill deadline BEFORE writing: a stopped reader may never drain.
    const killTimer = setTimeout(() => {
      if (!slot.exited) void slot.scope.terminate(0);
    }, SHUTDOWN_EXIT_WAIT_MS);
    const stdin = slot.child.stdin;
    if (stdin !== null) {
      try {
        await Promise.race([
          exited,
          writeFrame(stdin, {
            protocol_version: PROTOCOL_VERSION,
            kind: "shutdown",
            id: randomUUID(),
            role: "guardian",
            payload: {},
          }),
        ]);
      } catch {
        // Worker already half-gone; fall through to the wait/kill path.
      }
    }
    await exited;
    clearTimeout(killTimer);
  }

  private settlePending(
    pending: PendingInvocation,
    error: WorkerInvokeError | null,
    result?: ScriptResult,
  ): void {
    if (!this.pendingByKey.has(pending.envelopeId)) {
      return;
    }
    this.pendingByKey.delete(pending.envelopeId);
    this.pendingByKey.delete(pending.invocationId);
    clearTimeout(pending.timer);
    pending.slot.inflightCount -= 1;
    if (error !== null) {
      pending.reject(error);
    } else {
      pending.resolve(result as ScriptResult);
    }
  }

  private emitDiag(source: WorkerDiag["source"], pid: number | undefined, line: string): void {
    this.onLog?.({ source, pid, line });
  }
}
