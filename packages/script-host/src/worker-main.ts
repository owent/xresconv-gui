/**
 * Script worker main loop (P2-03). Speaks the framed envelope protocol on
 * fd0/fd1 (@xresconv/ipc); every diagnostic of the worker itself goes to fd2.
 * Executes the five legacy script entry kinds via ./executor.ts. Behavior
 * baseline: docs/plan/records/P0-08.md §2/§5; divergences are the BD-S entries
 * in docs/plan/records/P2-03.md.
 */
import { randomUUID } from "node:crypto";
import type { Envelope, ScriptInvoke, ScriptResult } from "@xresconv/contracts";
import { PROTOCOL_VERSION, validate } from "@xresconv/contracts";
import { FrameDecoder, writeFrame } from "@xresconv/ipc";
import type { DialogCallbacks, ExecutorHooks } from "./executor.ts";
import { executeInvocation } from "./executor.ts";

const ROLE = "script-worker" as const;
/** Grace on top of invoke.timeout_ms for the worker-level wall-clock fallback (BD-S5). */
const OUTER_TIMEOUT_GRACE_MS = 100;
/** Forced exit delay after shutdown is requested, even if invocations never settle. */
const SHUTDOWN_FORCE_EXIT_MS = 2000;

const inflight = new Set<Promise<void>>();
const dialogCallbacks = new Map<string, DialogCallbacks>();
let shutdownRequested = false;

function logStderr(message: string): void {
  process.stderr.write(`[script-worker] ${message}\n`);
}

function formatUnknown(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }
  return String(err);
}

function envelope(
  kind: Envelope["kind"],
  payload: Record<string, unknown>,
  extra?: Partial<Envelope>,
): Envelope {
  return {
    protocol_version: PROTOCOL_VERSION,
    kind,
    id: randomUUID(),
    role: ROLE,
    payload,
    ...extra,
  };
}

function send(
  kind: Envelope["kind"],
  payload: Record<string, unknown>,
  extra?: Partial<Envelope>,
): Promise<void> {
  return writeFrame(process.stdout, envelope(kind, payload, extra));
}

function sendFault(message: string, inReplyTo?: string): Promise<void> {
  return send("fault", { message }, inReplyTo === undefined ? {} : { in_reply_to: inReplyTo });
}

function sendHealth(inReplyTo?: string): Promise<void> {
  return send(
    "health",
    { ok: true, pid: process.pid, node: process.version },
    inReplyTo === undefined ? {} : { in_reply_to: inReplyTo },
  );
}

/**
 * Worker-level wall-clock fallback around every invocation (BD-S5). The
 * executor's own timer fires first (grace) and reports the legacy reason;
 * this outer race only wins when an invocation stays unsettled past
 * timeout_ms + grace (e.g. a dialog that is never answered).
 */
async function runWithOuterDeadline(
  invoke: ScriptInvoke,
  hooks: ExecutorHooks,
): Promise<ScriptResult> {
  const { promise: fallback, resolve: settleFallback } = Promise.withResolvers<ScriptResult>();
  const timer = setTimeout(() => {
    settleFallback({ invocation_id: invoke.invocation_id, outcome: "rejected", reason: "timeout" });
  }, invoke.timeout_ms + OUTER_TIMEOUT_GRACE_MS);
  try {
    return await Promise.race([executeInvocation(invoke, hooks), fallback]);
  } catch (err) {
    return {
      invocation_id: invoke.invocation_id,
      outcome: "error",
      error: { code: "WORKER_INTERNAL_ERROR", message: formatUnknown(err) },
    };
  } finally {
    clearTimeout(timer);
  }
}

function makeHooks(entryKind: ScriptInvoke["entry_kind"]): ExecutorHooks {
  return {
    emitLog(invocationId, op) {
      send(
        "log",
        { invocation_id: invocationId, entry_kind: entryKind, ...op },
        { invocation_id: invocationId },
      ).catch((err: unknown) => logStderr(`failed to send log envelope: ${formatUnknown(err)}`));
    },
    requestDialog(invocationId, payload) {
      send("dialog_request", { ...payload }, { invocation_id: invocationId }).catch(
        (err: unknown) => logStderr(`failed to send dialog_request: ${formatUnknown(err)}`),
      );
    },
    registerDialogCallbacks(token, callbacks) {
      dialogCallbacks.set(token, callbacks);
    },
  };
}

function handleInvoke(env: Envelope): void {
  let invoke: ScriptInvoke;
  try {
    invoke = validate<ScriptInvoke>("script-invoke", env.payload);
  } catch (err) {
    void sendFault(`invalid invoke payload: ${formatUnknown(err)}`, env.id);
    return;
  }
  if (shutdownRequested) {
    void sendFault("worker shutting down, invoke rejected", env.id);
    return;
  }
  const task = (async () => {
    const result = await runWithOuterDeadline(invoke, makeHooks(invoke.entry_kind));
    await send(
      "complete",
      { ...result },
      { invocation_id: invoke.invocation_id, in_reply_to: env.id },
    );
  })().catch((err: unknown) => {
    logStderr(`invoke ${invoke.invocation_id} failed internally: ${formatUnknown(err)}`);
    return sendFault("unable to serialize or send invocation result", env.id).catch(
      () => undefined,
    );
  });
  inflight.add(task);
  void task.finally(() => {
    inflight.delete(task);
  });
}

/**
 * alert_warning answer (P0-08 §5): "yes" -> yes() -> on_close(); "no" -> no()
 * -> on_close(); choice null/missing (ESC/backdrop) -> no callbacks at all.
 * Callbacks run with this=undefined and no arguments (BD-S6); an exception in
 * yes/no skips on_close, matching the legacy single-handler sequencing.
 */
function handleDialogRespond(env: Envelope): void {
  const fromPayload = env.payload.token;
  const token =
    typeof fromPayload === "string" && fromPayload.length > 0 ? fromPayload : env.in_reply_to;
  if (token === undefined) {
    logStderr("dialog_respond without token, ignored");
    return;
  }
  const callbacks = dialogCallbacks.get(token);
  if (callbacks === undefined) {
    logStderr(`dialog_respond for unknown token ${token}, ignored`);
    return;
  }
  dialogCallbacks.delete(token);
  const call = (fn: unknown): void => {
    if (typeof fn === "function") {
      Reflect.apply(fn, undefined, []);
    }
  };
  try {
    if (env.payload.choice === "yes") {
      call(callbacks.yes);
      call(callbacks.on_close);
    } else if (env.payload.choice === "no") {
      call(callbacks.no);
      call(callbacks.on_close);
    }
  } catch (err) {
    logStderr(`dialog callback threw: ${formatUnknown(err)}`);
  }
}

/** Drains in-flight invocations before exit(0); a 2s fallback forces the exit. */
function handleShutdown(): void {
  if (shutdownRequested) {
    return;
  }
  shutdownRequested = true;
  const force = setTimeout(() => {
    logStderr(`shutdown: force exit after ${SHUTDOWN_FORCE_EXIT_MS}ms with in-flight work`);
    process.exit(0);
  }, SHUTDOWN_FORCE_EXIT_MS);
  void Promise.allSettled([...inflight]).then(() => {
    clearTimeout(force);
    process.exit(0);
  });
}

async function handleEnvelope(value: unknown): Promise<void> {
  let env: Envelope;
  try {
    env = validate<Envelope>("envelope", value);
    if (env.role !== "guardian") throw new Error("only the guardian may command a script worker");
  } catch (err) {
    await sendFault(`invalid envelope: ${formatUnknown(err)}`);
    return;
  }
  switch (env.kind) {
    case "health":
      await sendHealth(env.id);
      return;
    case "invoke":
      handleInvoke(env);
      return;
    case "dialog_respond":
      handleDialogRespond(env);
      return;
    case "shutdown":
      handleShutdown();
      return;
    default:
      await sendFault(`unsupported inbound kind: ${env.kind}`, env.id);
  }
}

// Script callbacks scheduled via injected setTimeout must never crash the
// worker; legacy surfaced such errors in the GUI log, we surface them on fd2.
process.on("uncaughtException", (err) => {
  logStderr(`uncaughtException: ${formatUnknown(err)}`);
});
process.on("unhandledRejection", (reason) => {
  logStderr(`unhandledRejection: ${formatUnknown(reason)}`);
});

const decoder = new FrameDecoder(
  (value: unknown) => {
    void handleEnvelope(value);
  },
  (error) => {
    logStderr(`frame decode error (${error.code}): ${error.message}`);
    void sendFault(`frame decode error: ${error.message}`);
  },
);
process.stdin.on("data", (chunk: Buffer) => {
  decoder.push(chunk);
});
process.stdin.once("end", handleShutdown);
process.stdin.once("error", handleShutdown);

await sendHealth();
