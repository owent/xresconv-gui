/**
 * Guardian: backend 进程监督（P2-09，SC10/SC11 backend 侧）。
 *
 * 拓扑（Plan 02 §59）：guardian 经 `child_process.fork`（可信角色通道，明确
 * execPath + json serialization）启动长驻 backend；backend 进程内自持
 * ScriptWorkerPool 与 per-batch Java 进程树（各自的 ProcessScope）。guardian
 * 对 backend 整树持有 ProcessScope——backend 异常退出/失联时，整树终止即覆盖
 * 其脚本 worker 与 Java 子树（树组合语义，替代逐进程登记）。
 *
 * 行为合同（Plan 02 §140）：
 * - backend 异常退出/失联：停止派发（不再 send）、终止所属整树、发事件通知
 *   （壳层接线属 P4）；只允许显式 restart() 恢复，**不自动重放**。
 * - 心跳：每 heartbeatMs 发 health ping（带 generation），heartbeatDeadlineMs
 *   内无对应 in_reply_to 回复 → 判定失联。send 返回 false（背压）只记诊断，
 *   不当作送达证据；send 回调不代表对方已处理（SC11）。
 * - 身份绑定实际通道：fork IPC 由本进程创建，握手仍校验 role/pid/generation
 *   一致性（防御伪造/串线）。
 * - 迟到回复：旧 generation 或未知 in_reply_to 的 health 回复一律忽略并记
 *   诊断（新 backend 不接受旧回复，SC10）。
 * - 业务 RPC（P4-02）：request() 经 kind "rpc"/"rpc_result" 按 in_reply_to
 *   关联，超时/死亡/未就绪确定性拒绝；迟到或未知回复忽略并记诊断（SC10）。
 *   backend kind "event" 业务事件经 onBackendEvent 原样上浮（bin 转发壳）。
 */

import { type ChildProcess, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { type Envelope, PROTOCOL_VERSION } from "@xresconv/contracts";
import { createProcessScope, type ProcessScope } from "./process-tree.ts";

const DEFAULT_SPAWN_DEADLINE_MS = 5000;
const DEFAULT_HEARTBEAT_MS = 1000;
const DEFAULT_HEARTBEAT_DEADLINE_MS = 3000;
/** shutdown 帧发出后等 backend 自行退出的宽限，超期整树终止。 */
const SHUTDOWN_GRACE_MS = 2000;
/** 单次业务 RPC（P4-02）缺省等待上限；超时拒绝，迟到回复忽略并记诊断（SC10）。 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export type BackendSupervisorState = "idle" | "starting" | "ready" | "dead" | "shutdown";

/** 业务 RPC 拒绝码（P4-02；backend 侧业务错误码见 backend-rpc schema）。 */
export type BackendRequestErrorCode = "BACKEND_NOT_READY" | "BACKEND_DIED" | "BACKEND_TIMEOUT";

/** supervisor 层 RPC 失败：backend 未就绪/死亡/超时，与 backend 业务错误区分。 */
export class BackendRequestError extends Error {
  readonly code: BackendRequestErrorCode;

  constructor(code: BackendRequestErrorCode, message: string) {
    super(message);
    this.name = "BackendRequestError";
    this.code = code;
  }
}

export interface BackendSupervisorEvent {
  /** ready=握手成功；died=退出/失联/协议违规（含原因）；diag=诊断行。 */
  type: "ready" | "died" | "diag";
  message: string;
  pid?: number;
  generation?: number;
}

export interface BackendSupervisorOptions {
  /** backend 入口；缺省 packages/backend/bin/service.mjs。 */
  backendEntry?: string;
  /** 追加给 backend Node 的参数。 */
  backendNodeArgs?: string[];
  /** backend 环境变量（附加在 process.env 之上）。 */
  backendEnv?: Record<string, string>;
  spawnDeadlineMs?: number;
  heartbeatMs?: number;
  heartbeatDeadlineMs?: number;
  /** 单次业务 RPC 等待上限（毫秒，P4-02），默认 30s。 */
  requestTimeoutMs?: number;
  createScope?: () => ProcessScope;
  onEvent?: (event: BackendSupervisorEvent) => void;
  /** backend kind "event" 业务事件（P4-02：log/state_change/dialog_*、run_end）；bin 转发给壳。 */
  onBackendEvent?: (env: Envelope) => void;
}

export interface BackendSupervisorStats {
  state: BackendSupervisorState;
  pid: number | undefined;
  generation: number;
  /** 最近一次心跳往返（毫秒）；尚无样本为 0。 */
  lastRttMs: number;
  /** 最近一次健康自报的 RSS（字节）；无样本为 0。 */
  lastRssBytes: number;
}

interface PendingRequest {
  readonly resolve: (payload: unknown) => void;
  readonly reject: (err: BackendRequestError) => void;
  readonly timer: NodeJS.Timeout;
}

interface BackendSlot {
  child: ChildProcess;
  scope: ProcessScope;
  pid: number | undefined;
  generation: number;
  ready: boolean;
  dead: boolean;
  cleanup: Promise<void> | null;
  cancelStart?: () => void;
  /** 在途心跳：ping envelope id → 发出时间。 */
  outstandingPing: { id: string; sentAt: number } | null;
}

function defaultBackendEntry(): string {
  return fileURLToPath(new URL("../../backend/bin/service.mjs", import.meta.url));
}

export class BackendSupervisor {
  private readonly options: Required<
    Pick<
      BackendSupervisorOptions,
      | "backendEntry"
      | "spawnDeadlineMs"
      | "heartbeatMs"
      | "heartbeatDeadlineMs"
      | "requestTimeoutMs"
    >
  > &
    BackendSupervisorOptions;
  private readonly createScope: () => ProcessScope;
  private slot: BackendSlot | null = null;
  private state: BackendSupervisorState = "idle";
  private generation = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastRttMs = 0;
  private lastRssBytes = 0;
  private startPromise: Promise<void> | null = null;
  private shutdownPromise: Promise<void> | null = null;
  /** 在途业务 RPC（P4-02）：请求 envelope id → 结算函数。 */
  private readonly pendingRequests = new Map<string, PendingRequest>();

  constructor(options: BackendSupervisorOptions = {}) {
    this.options = {
      ...options,
      backendEntry: options.backendEntry ?? defaultBackendEntry(),
      spawnDeadlineMs: options.spawnDeadlineMs ?? DEFAULT_SPAWN_DEADLINE_MS,
      heartbeatMs: options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
      heartbeatDeadlineMs: options.heartbeatDeadlineMs ?? DEFAULT_HEARTBEAT_DEADLINE_MS,
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    };
    for (const [name, value] of [
      ["spawnDeadlineMs", this.options.spawnDeadlineMs],
      ["heartbeatMs", this.options.heartbeatMs],
      ["heartbeatDeadlineMs", this.options.heartbeatDeadlineMs],
      ["requestTimeoutMs", this.options.requestTimeoutMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) {
        throw new RangeError(`invalid ${name}`);
      }
    }
    this.createScope = options.createScope ?? (() => createProcessScope({ name: "backend" }));
  }

  stats(): BackendSupervisorStats {
    return {
      state: this.state,
      pid: this.slot?.pid,
      generation: this.generation,
      lastRttMs: this.lastRttMs,
      lastRssBytes: this.lastRssBytes,
    };
  }

  /** 启动（或自 dead 显式恢复）backend；幂等仅对 ready/starting。不自动重放。 */
  async start(): Promise<void> {
    if (this.state === "shutdown") {
      throw new Error("backend supervisor is shut down");
    }
    if (this.state === "starting") {
      return this.startPromise ?? undefined;
    }
    if (this.state === "ready") {
      return;
    }
    if (this.slot !== null && !this.slot.dead) {
      throw new Error("backend slot still alive");
    }
    const previousCleanup = this.slot?.cleanup;
    this.state = "starting";
    this.startPromise = (async () => {
      await previousCleanup;
      if (this.state === "shutdown") throw new Error("backend supervisor is shut down");
      await this.spawnBackend();
    })().catch((error: unknown) => {
      if (this.state !== "shutdown") this.state = "dead";
      throw error;
    });
    return this.startPromise;
  }

  /** 显式恢复入口（Plan 02 §140：只允许显式新建会话恢复）。 */
  async restart(): Promise<void> {
    if (this.state !== "dead") {
      throw new Error(`restart requires dead state (current: ${this.state})`);
    }
    await this.start();
  }

  /**
   * 业务 RPC 透传（P4-02）：payload 作为 kind "rpc" 发给当前 ready 的 backend，
   * 按 in_reply_to 匹配其 rpc_result 并结算。backend 未就绪/死亡/超时分别按
   * BACKEND_NOT_READY / BACKEND_DIED / BACKEND_TIMEOUT 拒绝；不自动重放
   * （SC10：受影响调用得到确定的失败状态，重试策略归调用方）。
   */
  request(payload: unknown, timeoutMs = this.options.requestTimeoutMs): Promise<unknown> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) {
      return Promise.reject(new RangeError("invalid request timeout"));
    }
    const slot = this.slot;
    if (this.state !== "ready" || slot === null || slot.dead || !slot.ready) {
      return Promise.reject(
        new BackendRequestError("BACKEND_NOT_READY", `backend not ready (state: ${this.state})`),
      );
    }
    const id = randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timer = setTimeout(() => {
      this.settleRequest(
        id,
        null,
        new BackendRequestError(
          "BACKEND_TIMEOUT",
          `backend rpc exceeded ${String(timeoutMs)}ms deadline`,
        ),
      );
    }, timeoutMs);
    timer.unref();
    this.pendingRequests.set(id, { resolve, reject, timer });
    try {
      const ok = slot.child.send(
        {
          protocol_version: PROTOCOL_VERSION,
          kind: "rpc",
          id,
          role: "guardian",
          generation: slot.generation,
          payload,
        },
        undefined,
        undefined,
        (err: Error | null) => {
          if (err !== null) {
            // 通道交付失败：拒绝本请求；死亡判定留给 exit/disconnect/心跳路径。
            this.settleRequest(
              id,
              null,
              new BackendRequestError("BACKEND_DIED", `rpc send failed: ${err.message}`),
            );
          }
        },
      );
      if (!ok) {
        // 通道缓冲已满（背压）：不当作送达；由请求超时兜底（SC11）。
        this.emit("diag", "rpc send backpressured (channel buffer full)", slot);
      }
    } catch (err) {
      this.settleRequest(
        id,
        null,
        new BackendRequestError("BACKEND_DIED", `rpc send threw: ${String(err)}`),
      );
    }
    return promise;
  }

  /** 终止监督：停止心跳、拒绝在途 RPC、发 shutdown、宽限后整树终止并 dispose。幂等。 */
  shutdown(): Promise<void> {
    if (this.shutdownPromise !== null) return this.shutdownPromise;
    this.state = "shutdown";
    this.stopHeartbeat();
    this.rejectAllRequests("backend supervisor shut down");
    const slot = this.slot;
    this.slot = null;
    if (slot !== null) {
      slot.dead = true;
      slot.cancelStart?.();
    }
    this.shutdownPromise = slot === null ? Promise.resolve() : this.terminateSlot(slot, true);
    return this.shutdownPromise;
  }

  private emit(type: BackendSupervisorEvent["type"], message: string, slot?: BackendSlot): void {
    try {
      this.options.onEvent?.({
        type,
        message,
        pid: slot?.pid,
        generation: slot?.generation ?? this.generation,
      });
    } catch {
      /* A diagnostics subscriber cannot interrupt cleanup. */
    }
  }

  private spawnBackend(): Promise<void> {
    this.state = "starting";
    this.generation += 1;
    const generation = this.generation;
    const scope = this.createScope();
    const child = fork(this.options.backendEntry, [], {
      execPath: process.execPath,
      execArgv: this.options.backendNodeArgs ?? [],
      silent: true,
      env: { ...process.env, ...this.options.backendEnv },
      ...scope.decorateSpawnOptions({}),
    });
    scope.register(child);
    const slot: BackendSlot = {
      child,
      scope,
      pid: child.pid,
      generation,
      ready: false,
      dead: false,
      cleanup: null,
      outstandingPing: null,
    };
    this.slot = slot;
    child.stdout?.resume();

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (!slot.dead) {
        this.emit("diag", `[backend] ${chunk.trimEnd()}`, slot);
      }
    });

    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const handshakeTimer = setTimeout(() => {
      void this.declareDead(
        slot,
        `backend health handshake timeout after ${this.options.spawnDeadlineMs}ms`,
      );
      reject(new Error(`backend did not hand within ${this.options.spawnDeadlineMs}ms`));
    }, this.options.spawnDeadlineMs);
    slot.cancelStart = () => {
      clearTimeout(handshakeTimer);
      reject(new Error("backend startup cancelled"));
    };

    child.on("message", (value: unknown) => {
      if (slot.dead || this.slot !== slot || this.state === "shutdown") {
        return;
      }
      const env = value as Record<string, unknown>;
      if (
        typeof env !== "object" ||
        env === null ||
        env.role !== "backend" ||
        env.protocol_version !== PROTOCOL_VERSION
      ) {
        void this.declareDead(slot, "backend sent invalid envelope or forged role");
        if (!slot.ready) {
          clearTimeout(handshakeTimer);
          reject(new Error("backend handshake: forged role or invalid envelope"));
        }
        return;
      }
      if (env.generation !== undefined && env.generation !== slot.generation) {
        // 旧代际迟到回复：忽略（SC10；fork 通道随进程消亡，此分支是防御）。
        this.emit("diag", `stale generation reply ignored (gen ${String(env.generation)})`, slot);
        return;
      }
      switch (env.kind) {
        case "health": {
          const payload = env.payload as Record<string, unknown>;
          if (
            typeof payload !== "object" ||
            payload === null ||
            payload.ok !== true ||
            payload.pid !== slot.pid
          ) {
            void this.declareDead(slot, "backend health identity mismatch");
            if (!slot.ready) {
              clearTimeout(handshakeTimer);
              reject(new Error("backend handshake: identity mismatch"));
            }
            return;
          }
          if (!slot.ready) {
            slot.ready = true;
            clearTimeout(handshakeTimer);
            this.state = "ready";
            this.emit("ready", "backend ready", slot);
            this.startHeartbeat(slot);
            resolve();
            return;
          }
          // ping 回复：必须对在途 ping 的 in_reply_to（否则为来路不明/迟到）。
          const outstanding = slot.outstandingPing;
          if (outstanding === null || env.in_reply_to !== outstanding.id) {
            this.emit("diag", "unsolicited or late health reply ignored", slot);
            return;
          }
          slot.outstandingPing = null;
          this.lastRttMs = Date.now() - outstanding.sentAt;
          const memory = payload.memory as Record<string, unknown> | undefined;
          if (typeof memory?.rss === "number") {
            this.lastRssBytes = memory.rss;
          }
          return;
        }
        case "fault":
          this.emit("diag", `backend fault: ${String(payloadMessage(env))}`, slot);
          return;
        case "rpc_result": {
          const replyTo = typeof env.in_reply_to === "string" ? env.in_reply_to : undefined;
          if (replyTo === undefined || !this.pendingRequests.has(replyTo)) {
            // 迟到/来路不明的回复：忽略并记诊断（SC10；已超时/已死亡的请求不回填）。
            this.emit("diag", "late or unknown rpc_result ignored", slot);
            return;
          }
          this.settleRequest(replyTo, env.payload, null);
          return;
        }
        case "event":
          // backend 业务事件（P4-02）：原样交给 bin 转发壳，payload 由 backend 构造。
          this.options.onBackendEvent?.(env as unknown as Envelope);
          return;
        default:
          this.emit("diag", `unexpected backend kind: ${String(env.kind)}`, slot);
      }
    });

    child.on("exit", (code, signal) => {
      clearTimeout(handshakeTimer);
      if (!slot.dead) {
        void this.declareDead(
          slot,
          `backend exited (code ${String(code)}, signal ${String(signal)})`,
        );
      }
      if (!slot.ready) {
        reject(new Error(`backend exited before handshake (code ${String(code)})`));
      }
    });
    child.on("disconnect", () => {
      if (!slot.dead && slot.ready) {
        void this.declareDead(slot, "backend IPC channel disconnected");
      }
    });
    child.on("error", (err) => {
      clearTimeout(handshakeTimer);
      if (!slot.dead) {
        void this.declareDead(slot, `backend spawn/channel error: ${err.message}`);
      }
      if (!slot.ready) {
        reject(err);
      }
    });
    return promise;
  }

  private startHeartbeat(slot: BackendSlot): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (slot.dead || this.state !== "ready") {
        return;
      }
      const outstanding = slot.outstandingPing;
      if (outstanding !== null) {
        if (Date.now() - outstanding.sentAt >= this.options.heartbeatDeadlineMs) {
          void this.declareDead(
            slot,
            `backend heartbeat deadline exceeded (${this.options.heartbeatDeadlineMs}ms)`,
          );
        }
        return; // 有在途 ping 不再叠加（背压/失联只记一条）
      }
      const id = randomUUID();
      slot.outstandingPing = { id, sentAt: Date.now() };
      try {
        const ok = slot.child.send(
          {
            protocol_version: PROTOCOL_VERSION,
            kind: "health",
            id,
            role: "guardian",
            generation: slot.generation,
            payload: {},
          },
          undefined,
          undefined,
          (err: Error | null) => {
            if (err !== null && !slot.dead) {
              this.emit("diag", `heartbeat send callback error: ${err.message}`, slot);
            }
          },
        );
        if (!ok) {
          // 通道缓冲已满（背压）：不当作送达；由心跳截止兜底判失联（SC11）。
          this.emit("diag", "heartbeat send backpressured (channel buffer full)", slot);
        }
      } catch (err) {
        if (!slot.dead) {
          void this.declareDead(slot, `heartbeat send threw: ${String(err)}`);
        }
      }
    }, this.options.heartbeatMs);
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** 判死：停止心跳、拒绝在途 RPC、整树终止（覆盖其脚本/Java 子树）、发事件。幂等。 */
  private async declareDead(slot: BackendSlot, reason: string): Promise<void> {
    if (slot.dead) {
      return;
    }
    slot.dead = true;
    slot.cancelStart?.();
    if (this.slot === slot) {
      this.stopHeartbeat();
      if (this.state !== "shutdown") {
        this.state = "dead";
      }
    }
    if (this.slot === slot) this.rejectAllRequests(`backend died: ${reason}`);
    const cleanup = this.terminateSlot(slot, false);
    this.emit("died", reason, slot);
    try {
      await cleanup;
    } catch (error) {
      this.emit("diag", `backend cleanup failed: ${String(error)}`, slot);
    }
  }

  /** 结算一个在途 RPC（超时/回复/死亡共用）；未知 id 为迟到回包，静默。 */
  private settleRequest(id: string, payload: unknown, error: BackendRequestError | null): void {
    const pending = this.pendingRequests.get(id);
    if (pending === undefined) {
      return;
    }
    this.pendingRequests.delete(id);
    clearTimeout(pending.timer);
    if (error !== null) {
      pending.reject(error);
    } else {
      pending.resolve(payload);
    }
  }

  /** 拒绝全部在途 RPC（死亡/关停）；SC10：受影响调用得到确定的失败状态。 */
  private rejectAllRequests(reason: string): void {
    for (const id of [...this.pendingRequests.keys()]) {
      this.settleRequest(id, null, new BackendRequestError("BACKEND_DIED", reason));
    }
  }

  /** 整树终止并 dispose；只有回收完成后才返回（实际回收后才算清理成功）。 */
  private terminateSlot(slot: BackendSlot, graceful: boolean): Promise<void> {
    slot.cleanup ??= Promise.resolve().then(() => this.cleanSlot(slot, graceful));
    return slot.cleanup;
  }

  private async cleanSlot(slot: BackendSlot, graceful: boolean): Promise<void> {
    if (graceful && slot.ready) {
      // 先发 shutdown 帧给自行退出机会；宽限后整树终止。
      try {
        slot.child.send(
          {
            protocol_version: PROTOCOL_VERSION,
            kind: "shutdown",
            id: randomUUID(),
            role: "guardian",
            generation: slot.generation,
            payload: {},
          },
          () => {},
        );
      } catch {
        // 通道已断，直接进终止路径。
      }
      const exited = await new Promise<boolean>((resolve) => {
        if (slot.child.exitCode !== null || slot.child.signalCode !== null) {
          resolve(true);
          return;
        }
        const finish = (exited: boolean): void => {
          clearTimeout(timer);
          slot.child.off("exit", onExit);
          resolve(exited);
        };
        const onExit = (): void => finish(true);
        const timer = setTimeout(() => finish(false), SHUTDOWN_GRACE_MS);
        slot.child.once("exit", onExit);
      });
      if (!exited) {
        this.emit("diag", "backend ignored shutdown frame; terminating tree", slot);
      }
    }
    try {
      const report = await slot.scope.terminate(SHUTDOWN_GRACE_MS);
      if (report.unreapedPids.length > 0)
        throw new Error(`unreaped backend pids: ${report.unreapedPids.join(",")}`);
    } finally {
      await slot.scope.dispose();
    }
  }
}

function payloadMessage(env: Record<string, unknown>): unknown {
  const payload = env.payload;
  if (typeof payload === "object" && payload !== null && "message" in payload) {
    return (payload as Record<string, unknown>).message;
  }
  return env.kind;
}
