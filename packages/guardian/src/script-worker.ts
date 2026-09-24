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
}

export interface WorkerStat {
  pid: number | undefined;
  inflight: number;
  served: number;
}

function defaultWorkerEntry(): string {
  return fileURLToPath(new URL("../../script-host/bin/worker.mjs", import.meta.url));
}

export class ScriptWorkerPool {
  /** worker -> guardian dialog request; respond() answers it exactly once. */
  onDialogRequest?: (env: Envelope, respond: (choice: DialogChoice) => void) => void;
  /** kind:"log" envelopes and WorkerDiag diagnostics (stderr/fault/exit). */
  onLog?: (event: Envelope | WorkerDiag) => void;

  private readonly size: number;
  private readonly workerEntry: string;
  private readonly spawnDeadlineMs: number;
  private readonly workers = new Set<WorkerSlot>();
  /** Includes starting and faulted children until their pipes actually close. */
  private readonly children = new Set<WorkerSlot>();
  private readonly pendingByKey = new Map<string, PendingInvocation>();
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
    }));
  }

  /** Sends shutdown to every worker, waits for exit (2s), SIGKILLs stragglers. Idempotent. */
  shutdown(): Promise<void> {
    if (this.shutdownPromise !== null) {
      return this.shutdownPromise;
    }
    this.shuttingDown = true;
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
    const child = spawn(process.execPath, [this.workerEntry], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const slot: WorkerSlot = {
      child,
      pid: child.pid,
      ready: false,
      exited: false,
      discarded: false,
      killing: false,
      inflightCount: 0,
      served: 0,
      stderrLine: "",
      stderrTail: "",
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
        return;
      default:
        this.faultWorker(slot, `unexpected inbound kind: ${env.kind}`);
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
    let answered = false;
    const respond = (choice: DialogChoice): void => {
      if (answered || slot.killing || slot.exited) return;
      answered = true;
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

  /** SIGTERM -> 1s grace -> SIGKILL. Replenishment happens in the exit handler. */
  private destroyWorker(slot: WorkerSlot): void {
    if (slot.killing || slot.exited) {
      return;
    }
    slot.killing = true;
    slot.child.kill("SIGTERM");
    const escalate = setTimeout(() => {
      if (!slot.exited) {
        slot.child.kill("SIGKILL");
      }
    }, KILL_GRACE_MS);
    escalate.unref();
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
      if (!slot.exited) slot.child.kill("SIGKILL");
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
