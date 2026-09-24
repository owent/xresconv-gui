/**
 * Executor for the five legacy script entry kinds (P0-08 §2, src/main.js
 * anchors noted per entry). Each invocation compiles `invoke.source` with
 * `new vm.Script(text, { filename })` and runs it in a fresh vm context whose
 * keys mirror the legacy sandbox field by field. Wire-observable differences
 * from the legacy GUI are recorded as BD-S entries in docs/plan/records/P2-03.md.
 */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import type { ScriptInvoke, ScriptResult } from "@xresconv/contracts";

export interface LogOp {
  op: "log";
  level: "info" | "notice" | "warning" | "error";
  message: string;
  module_name: string;
}

export interface DialogRequestPayload {
  token: string;
  title: string;
  content: string;
  buttons: string[];
}

/** Script-provided alert_warning callbacks; non-function values are ignored. */
export interface DialogCallbacks {
  yes?: unknown;
  no?: unknown;
  on_close?: unknown;
}

/** Side channels the executor needs from the worker main loop. */
export interface ExecutorHooks {
  emitLog(invocationId: string, op: LogOp): void;
  requestDialog(invocationId: string, payload: DialogRequestPayload): void;
  registerDialogCallbacks(token: string, callbacks: DialogCallbacks): void;
}

/** Worker-lifetime button data store (main.js:612/771: data persists per button). */
const buttonDataStore = new Map<string, Record<string, unknown>>();

function formatException(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }
  // vm-thrown errors are cross-realm and fail instanceof; read stack structurally.
  if (typeof err === "object" && err !== null && "stack" in err && typeof err.stack === "string") {
    return err.stack;
  }
  return String(err);
}

/**
 * Node >= 22 injects a host `console` into every vm context; the legacy
 * renderer sandbox had none (scripts calling console.* died with
 * ReferenceError). Deleting it restores the exact legacy surface.
 */
function stripHostConsole(context: vm.Context): void {
  vm.runInContext("delete globalThis.console", context);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || typeof a !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => deepEqual(value, b[index]))
    );
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  return (
    aKeys.length === bKeys.length && aKeys.every((key) => deepEqual(aRecord[key], bRecord[key]))
  );
}

/** item_data/log_object arrive as JSON; scripts may attach anything, so degrade safely. */
function safeClone(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    // fall through to JSON round-trip
  }
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

/**
 * Top-level field diff between the pre-execution snapshot and the live object.
 * Changed/new keys carry the post-execution value; removed keys map to null.
 */
function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (!Object.hasOwn(after, key)) {
      fields[key] = null;
      continue;
    }
    if (!Object.hasOwn(before, key) || !deepEqual(before[key], after[key])) {
      fields[key] = safeClone(after[key]);
    }
  }
  return fields;
}

function makeLoggers(moduleName: string, invocationId: string, hooks: ExecutorHooks) {
  const make =
    (level: LogOp["level"]) =>
    (message: unknown): void => {
      hooks.emitLog(invocationId, {
        op: "log",
        level,
        message: String(message),
        module_name: moduleName,
      });
    };
  return {
    log_info: make("info"),
    log_notice: make("notice"),
    log_warning: make("warning"),
    log_error: make("error"),
  };
}

function makeAlerts(invocationId: string, hooks: ExecutorHooks) {
  // Legacy defaults: main.js:885-886 ("无内容，参数错误"/"警告"), main.js:864-866 ("出错啦").
  const alertError = (content?: unknown, title?: unknown): void => {
    hooks.requestDialog(invocationId, {
      token: randomUUID(),
      title: title == null ? "出错啦" : String(title),
      content: content == null ? "无内容，参数错误" : String(content),
      buttons: ["ok"],
    });
  };
  const alertWarning = (content?: unknown, title?: unknown, options?: DialogCallbacks): void => {
    const token = randomUUID();
    hooks.requestDialog(invocationId, {
      token,
      title: title == null ? "警告" : String(title),
      content: content == null ? "无内容，参数错误" : String(content),
      buttons: ["yes", "no"],
    });
    hooks.registerDialogCallbacks(token, {
      yes: options?.yes,
      no: options?.no,
      on_close: options?.on_close,
    });
  };
  return { alert_warning: alertWarning, alert_error: alertError };
}

/**
 * BD-S1: require is anchored at the configure file (createRequire), so module
 * resolution starts at the config's directory. Legacy anchored at the app's
 * src/ directory and could reach electron/jquery (main.js:564/2297).
 */
function makeRequire(invoke: ScriptInvoke): NodeJS.Require {
  const anchor = invoke.context.configure_file;
  const filename =
    typeof anchor === "string" && anchor.length > 0
      ? path.resolve(anchor)
      : path.join(process.cwd(), "xresconv-script-worker.cjs");
  return createRequire(filename);
}

/**
 * Keys shared by the event/button/append-log base contexts (main.js:2253-2298).
 * on_append_log reuses the event base verbatim (append_log_context ===
 * vm_context_obj, main.js:2299), so require/selected_nodes/run_seq are present.
 */
function sharedContextKeys(invoke: ScriptInvoke, includeRunSeq: boolean): Record<string, unknown> {
  const context = invoke.context;
  const base: Record<string, unknown> = {
    work_dir: context.work_dir,
    configure_file: context.configure_file,
    xresloader_path: context.xresloader_path,
    global_options: context.global_options,
    selected_items: context.selected_items,
    selected_nodes: context.selected_nodes,
  };
  if (includeRunSeq) {
    base.run_seq = invoke.run_seq ?? context.run_seq;
  }
  return base;
}

function eventBase(invoke: ScriptInvoke, hooks: ExecutorHooks): Record<string, unknown> {
  return {
    ...sharedContextKeys(invoke, true),
    ...makeAlerts(invoke.invocation_id, hooks),
    ...makeLoggers("CONV EVENT", invoke.invocation_id, hooks),
    require: makeRequire(invoke),
  };
}

function buttonBase(invoke: ScriptInvoke, hooks: ExecutorHooks): Record<string, unknown> {
  // No run_seq for buttons (main.js:521-565). global_options stays in the
  // legacy array form ([{name,desc,value}], main.js:525) — divergence preserved.
  // Legacy labels the module with the script name; the wire carries button_id only.
  return {
    ...sharedContextKeys(invoke, false),
    ...makeAlerts(invoke.invocation_id, hooks),
    ...makeLoggers(`CONV SCRIPT:${invoke.button_id ?? ""}`, invoke.invocation_id, hooks),
    require: makeRequire(invoke),
  };
}

/** set_name (main.js:1704-1758): sync, no vm options, no require/resolve/reject. */
function runSetName(invoke: ScriptInvoke, hooks: ExecutorHooks, script: vm.Script): ScriptResult {
  const context = invoke.context;
  // Boundary assertion: script-invoke schema documents item_data as the item object.
  const itemData = (context.item_data ?? {}) as Record<string, unknown>;
  const before = safeClone(itemData) as Record<string, unknown>;
  const sandbox = vm.createContext({
    work_dir: context.work_dir,
    configure_file: context.configure_file,
    item_data: itemData,
    data: {},
    ...makeAlerts(invoke.invocation_id, hooks),
    ...makeLoggers("CONV EVENT", invoke.invocation_id, hooks),
  });
  stripHostConsole(sandbox);
  let failure: ScriptResult["error"];
  try {
    // Bug compatibility: legacy passes NO options here (main.js:1748) — no vm
    // timeout. The worker-level wall-clock fallback lives in worker-main.
    script.runInContext(sandbox);
  } catch (err) {
    failure = { code: "SCRIPT_RUNTIME_ERROR", message: formatException(err) };
  }
  const fields = diffFields(before, itemData);
  const result: ScriptResult = {
    invocation_id: invoke.invocation_id,
    outcome: failure === undefined ? "resolved" : "error",
  };
  if (failure !== undefined) {
    result.error = failure;
  }
  if (Object.keys(fields).length > 0) {
    result.ops = [{ op: "set_fields", target: "item_data", fields }];
  }
  return result;
}

/**
 * Events (main.js:2307-2392) and buttons (main.js:593-646) share the async
 * resolve/reject protocol: first call wins, the wall-clock timer is installed
 * AFTER runInContext returns so asynchronous resolution works (B9).
 */
function runAsyncEntry(
  invoke: ScriptInvoke,
  script: vm.Script,
  base: Record<string, unknown>,
  data: Record<string, unknown>,
  exceptionPrefix: string,
): Promise<ScriptResult> {
  const { promise, resolve: settle } = Promise.withResolvers<ScriptResult>();
  let done = false;
  let timer: NodeJS.Timeout | null = null;
  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const finish = (result: ScriptResult): void => {
    if (done) {
      return;
    }
    done = true;
    clearTimer();
    settle(result);
  };
  const sandbox = vm.createContext({
    resolve: (_value?: unknown): void => {
      clearTimer();
      finish({ invocation_id: invoke.invocation_id, outcome: "resolved" });
    },
    reject: (reason?: unknown): void => {
      clearTimer();
      finish({ invocation_id: invoke.invocation_id, outcome: "rejected", reason: String(reason) });
    },
    data,
    // BD-S7: legacy vm sandboxes had no timer functions; injecting them enables
    // the documented async-resolve pattern without changing legacy behavior.
    setTimeout,
    clearTimeout,
    ...base,
  });
  stripHostConsole(sandbox);
  try {
    script.runInContext(sandbox, {
      displayErrors: true,
      timeout: invoke.timeout_ms,
      breakOnSigint: true,
    });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "ERR_SCRIPT_EXECUTION_TIMEOUT"
    ) {
      // Sync vm timeout maps to the legacy wall-clock wording (BD-S4).
      finish({
        invocation_id: invoke.invocation_id,
        outcome: "rejected",
        reason: "Run event callback timeout",
      });
    } else {
      finish({
        invocation_id: invoke.invocation_id,
        outcome: "error",
        error: {
          code: "SCRIPT_RUNTIME_ERROR",
          message: `${exceptionPrefix}\n${formatException(err)}`,
        },
      });
    }
    return promise;
  }
  // Wall-clock installed after the synchronous run returned (main.js:2360-2369).
  if (done) return promise;
  timer = setTimeout(() => {
    timer = null;
    finish({
      invocation_id: invoke.invocation_id,
      outcome: "rejected",
      reason: "Run event callback timeout",
    });
  }, invoke.timeout_ms);
  return promise;
}

/** on_append_log (main.js:166-215): sync, data is the log object, partial edits survive errors. */
function runAppendLog(invoke: ScriptInvoke, hooks: ExecutorHooks, script: vm.Script): ScriptResult {
  // Boundary assertion: script-invoke schema documents log_object as the log object.
  const logObject = (invoke.context.log_object ?? {}) as Record<string, unknown>;
  const before = safeClone(logObject) as Record<string, unknown>;
  const sandbox = vm.createContext({
    data: logObject,
    ...eventBase(invoke, hooks),
  });
  stripHostConsole(sandbox);
  let failure: ScriptResult["error"];
  try {
    script.runInContext(sandbox, {
      displayErrors: true,
      timeout: invoke.timeout_ms,
      breakOnSigint: true,
    });
  } catch (err) {
    failure = {
      code: "SCRIPT_RUNTIME_ERROR",
      message: `APPEND LOG EVENT EXCEPTION\n${formatException(err)}`,
    };
  }
  const fields = diffFields(before, logObject);
  const result: ScriptResult = {
    invocation_id: invoke.invocation_id,
    outcome: failure === undefined ? "resolved" : "error",
  };
  if (failure !== undefined) {
    result.error = failure;
  }
  if (Object.keys(fields).length > 0) {
    result.ops = [{ op: "set_log_fields", fields }];
  }
  return result;
}

/** Executes one invoke envelope payload; never throws for script-level failures. */
async function executeUnchecked(invoke: ScriptInvoke, hooks: ExecutorHooks): Promise<ScriptResult> {
  let script: vm.Script;
  try {
    script = new vm.Script(invoke.source, { filename: invoke.filename });
  } catch (err) {
    return {
      invocation_id: invoke.invocation_id,
      outcome: "error",
      error: {
        code: "SCRIPT_COMPILE_ERROR",
        message: `${invoke.filename}: ${formatException(err)}`,
      },
    };
  }
  switch (invoke.entry_kind) {
    case "set_name":
      return runSetName(invoke, hooks, script);
    case "on_before_convert":
    case "on_after_convert":
      return runAsyncEntry(invoke, script, eventBase(invoke, hooks), {}, "CONV EVENT EXCEPTION");
    case "button": {
      // Button data persists per button_id for the worker process lifetime
      // (main.js:612/771). Without a button_id there is nothing to key on, so
      // the invocation gets a throwaway object (recorded in P2-03).
      let data: Record<string, unknown>;
      if (invoke.button_id !== undefined) {
        data = buttonDataStore.get(invoke.button_id) ?? {};
        buttonDataStore.set(invoke.button_id, data);
      } else {
        data = {};
      }
      return runAsyncEntry(
        invoke,
        script,
        buttonBase(invoke, hooks),
        data,
        "CONV SCRIPT EXCEPTION",
      );
    }
    case "on_append_log":
      return runAppendLog(invoke, hooks, script);
  }
}

/** Never let non-JSON mutations prevent the worker from sending a terminal result. */
export async function executeInvocation(
  invoke: ScriptInvoke,
  hooks: ExecutorHooks,
): Promise<ScriptResult> {
  try {
    const result = await executeUnchecked(invoke, hooks);
    return JSON.parse(JSON.stringify(result)) as ScriptResult;
  } catch (error) {
    return {
      invocation_id: invoke.invocation_id,
      outcome: "error",
      error: { code: "SCRIPT_RESULT_INVALID", message: formatException(error) },
    };
  }
}
