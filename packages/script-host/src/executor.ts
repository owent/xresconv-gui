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
import type { TreeSnapshot } from "@xresconv/compat-service";
import type { ScriptInvoke, ScriptResult } from "@xresconv/contracts";
import { diffFields, safeClone } from "./diff.ts";
import { buildMirror } from "./node-mirror.ts";

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
  registerDialogCallbacks(token: string, callbacks: DialogCallbacks, invocationId: string): void;
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
    const token = randomUUID();
    hooks.requestDialog(invocationId, {
      token,
      title: title == null ? "出错啦" : String(title),
      content: content == null ? "无内容，参数错误" : String(content),
      buttons: ["ok"],
    });
    // alert_error 无脚本回调（main.js:861-877），但仍登记 token：应答到达时静默
    // 最终化，避免 worker 侧报 "unknown token" 噪音（P2-06 注册表统一管理）。
    hooks.registerDialogCallbacks(token, {}, invocationId);
  };
  const alertWarning = (content?: unknown, title?: unknown, options?: DialogCallbacks): void => {
    const token = randomUUID();
    hooks.requestDialog(invocationId, {
      token,
      title: title == null ? "警告" : String(title),
      content: content == null ? "无内容，参数错误" : String(content),
      buttons: ["yes", "no"],
    });
    hooks.registerDialogCallbacks(
      token,
      {
        yes: options?.yes,
        no: options?.no,
        on_close: options?.on_close,
      },
      invocationId,
    );
  };
  return { alert_warning: alertWarning, alert_error: alertError };
}

/**
 * BD-S1: require is anchored at the configure file (createRequire), so module
 * resolution starts at the config's directory. Legacy anchored at the app's
 * src/ directory and could reach electron/jquery (main.js:564/2297).
 *
 * P2-10 兼容层：裸包名（`require("adm-zip")`）在锚定解析失败时回退到发行版
 * 捆绑模块目录（env `XRESCONV_SCRIPT_MODULE_DIRS`，path.delimiter 分隔的
 * anchor 目录列表，解析其 node_modules；由 backend 按 runtime manifest 注入，
 * P5-02 组装）。旧版行为里裸包名来自宿主 app 目录；新锚点在用户配置目录，
 * 没有该回退则发行目录下 `require("adm-zip")` 必然 MODULE_NOT_FOUND。
 * 相对/绝对/node: 说明符不回退（BD-S1 语义不变）；用户配置旁的 node_modules
 * 优先于捆绑目录（锚定解析先跑）。env 未设置时行为与之前完全一致。
 */
function makeRequire(invoke: ScriptInvoke): NodeJS.Require {
  const anchor = invoke.context.configure_file;
  const filename =
    typeof anchor === "string" && anchor.length > 0
      ? path.resolve(anchor)
      : path.join(process.cwd(), "xresconv-script-worker.cjs");
  const anchored = createRequire(filename);
  const fallbacks = fallbackRequires();
  if (fallbacks.length === 0) {
    return anchored;
  }
  const wrapped = (id: string): unknown => {
    try {
      return anchored(id);
    } catch (err) {
      if (!isBareModuleNotFound(err, id)) {
        throw err;
      }
      for (const fallback of fallbacks) {
        try {
          return fallback(id);
        } catch (fallbackErr) {
          if (!isBareModuleNotFound(fallbackErr, id)) {
            throw fallbackErr;
          }
        }
      }
      throw err;
    }
  };
  wrapped.resolve = (id: string, options?: { paths?: string[] }): string => {
    try {
      return anchored.resolve(id, options);
    } catch (err) {
      if (options?.paths !== undefined || !isBareModuleNotFound(err, id)) {
        throw err;
      }
      for (const fallback of fallbacks) {
        try {
          return fallback.resolve(id);
        } catch (fallbackErr) {
          if (!isBareModuleNotFound(fallbackErr, id)) {
            throw fallbackErr;
          }
        }
      }
      throw err;
    }
  };
  wrapped.cache = anchored.cache;
  wrapped.extensions = anchored.extensions;
  wrapped.main = anchored.main;
  return wrapped as NodeJS.Require;
}

/** 裸包名（不含路径语义的说明符）才允许回退；`./x`、`/x`、`C:\x`、`node:x` 不回退。 */
function isBareSpecifier(id: string): boolean {
  if (id.startsWith(".") || id.startsWith("node:")) {
    return false;
  }
  return !path.isAbsolute(id);
}

/**
 * 只在"找不到的就是这个说明符本身"时为真：模块已找到但其内部依赖缺失时
 * （err.code 同为 MODULE_NOT_FOUND）不得回退重试，否则会掩盖真实的坏包。
 */
function isBareModuleNotFound(err: unknown, id: string): boolean {
  return (
    isBareSpecifier(id) &&
    typeof err === "object" &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND" &&
    (err as Error).message.includes(`'${id}'`)
  );
}

let cachedFallbackRequires: NodeJS.Require[] | null = null;

/** 解析 env 回退目录列表为 createRequire 锚点（每进程缓存一次）。 */
function fallbackRequires(): NodeJS.Require[] {
  if (cachedFallbackRequires !== null) {
    return cachedFallbackRequires;
  }
  const raw = process.env.XRESCONV_SCRIPT_MODULE_DIRS;
  const dirs =
    raw === undefined
      ? []
      : raw
          .split(path.delimiter)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
  // createRequire 只需要目录内的虚拟文件名；解析从 dirname 开始向上查找
  // node_modules，覆盖 <dir>/node_modules。
  cachedFallbackRequires = dirs.map((dir) =>
    createRequire(path.join(dir, "xresconv-modules-anchor.cjs")),
  );
  return cachedFallbackRequires;
}

/**
 * Keys shared by the event/button/append-log base contexts (main.js:2253-2298).
 * on_append_log reuses the event base verbatim (append_log_context ===
 * vm_context_obj, main.js:2299), so require/selected_nodes/run_seq are present.
 *
 * P2-05：context.tree（TreeSnapshot）存在时，selected_nodes/selected_items 由
 * NodeMirror 重建（别名恒等 + 有序 ops）；不存在或为非法快照时回退为 JSON
 * 快照透传（BD-S9 降级形态）并附诊断 op。
 */
function buildSelection(invoke: ScriptInvoke): {
  mirror: import("./node-mirror.ts").MirrorHandle | null;
  selectedNodes: unknown;
  selectedItems: unknown;
  fallbackDiagnostic?: string;
} {
  const tree = invoke.context.tree;
  if (tree !== undefined && tree !== null) {
    try {
      const mirror = buildMirror(tree as TreeSnapshot, {
        readonly: invoke.entry_kind === "on_append_log",
      });
      return {
        mirror,
        selectedNodes: mirror.selectedNodes,
        selectedItems: mirror.selectedItems,
      };
    } catch (err) {
      return {
        mirror: null,
        selectedNodes: invoke.context.selected_nodes,
        selectedItems: invoke.context.selected_items,
        fallbackDiagnostic: `tree snapshot unusable, fell back to plain JSON selection: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }
  return {
    mirror: null,
    selectedNodes: invoke.context.selected_nodes,
    selectedItems: invoke.context.selected_items,
  };
}

function sharedContextKeys(
  invoke: ScriptInvoke,
  includeRunSeq: boolean,
  selection: { selectedNodes: unknown; selectedItems: unknown },
): Record<string, unknown> {
  const context = invoke.context;
  const base: Record<string, unknown> = {
    work_dir: context.work_dir,
    configure_file: context.configure_file,
    xresloader_path: context.xresloader_path,
    global_options: context.global_options,
    selected_items: selection.selectedItems,
    selected_nodes: selection.selectedNodes,
  };
  if (includeRunSeq) {
    base.run_seq = invoke.run_seq ?? context.run_seq;
  }
  return base;
}

function eventBase(
  invoke: ScriptInvoke,
  hooks: ExecutorHooks,
  selection: { selectedNodes: unknown; selectedItems: unknown },
): Record<string, unknown> {
  return {
    ...sharedContextKeys(invoke, true, selection),
    ...makeAlerts(invoke.invocation_id, hooks),
    ...makeLoggers("CONV EVENT", invoke.invocation_id, hooks),
    require: makeRequire(invoke),
  };
}

function buttonBase(
  invoke: ScriptInvoke,
  hooks: ExecutorHooks,
  selection: { selectedNodes: unknown; selectedItems: unknown },
): Record<string, unknown> {
  // No run_seq for buttons (main.js:521-565). global_options stays in the
  // legacy array form ([{name,desc,value}], main.js:525) — divergence preserved.
  // Legacy labels the module with the script name; the wire carries button_id only.
  return {
    ...sharedContextKeys(invoke, false, selection),
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
function runAppendLog(
  invoke: ScriptInvoke,
  hooks: ExecutorHooks,
  script: vm.Script,
  selection: { selectedNodes: unknown; selectedItems: unknown },
): ScriptResult {
  // Boundary assertion: script-invoke schema documents log_object as the log object.
  const logObject = (invoke.context.log_object ?? {}) as Record<string, unknown>;
  const before = safeClone(logObject) as Record<string, unknown>;
  const sandbox = vm.createContext({
    data: logObject,
    ...eventBase(invoke, hooks, selection),
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
    case "button":
    case "on_append_log":
      break;
  }
  // P2-05：事件/按钮/append_log 共用的 NodeMirror（无 tree 时回退 JSON 快照）。
  const selection = buildSelection(invoke);
  const result = await (async (): Promise<ScriptResult> => {
    switch (invoke.entry_kind) {
      case "on_before_convert":
      case "on_after_convert":
        return runAsyncEntry(
          invoke,
          script,
          eventBase(invoke, hooks, selection),
          {},
          "CONV EVENT EXCEPTION",
        );
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
          buttonBase(invoke, hooks, selection),
          data,
          "CONV SCRIPT EXCEPTION",
        );
      }
      case "on_append_log":
        return runAppendLog(invoke, hooks, script, selection);
      case "set_name":
        // 已在上方提前返回；此处只为让 TS 确认穷尽。
        throw new Error("unreachable: set_name handled above");
    }
  })();
  // 镜像 ops 在 log 字段 ops 之后追加；实时节点 ops 内部保持调用序（P2-05）。
  const mirrorOps: Record<string, unknown>[] = [];
  if (selection.fallbackDiagnostic !== undefined) {
    mirrorOps.push({
      op: "diagnostic",
      code: "MIRROR_BUILD_FAILED",
      message: selection.fallbackDiagnostic,
    });
  }
  if (selection.mirror !== null) {
    mirrorOps.push(...selection.mirror.collectOps());
  }
  if (mirrorOps.length > 0) {
    result.ops = [...(result.ops ?? []), ...mirrorOps];
  }
  return result;
}

/**
 * Never let non-JSON mutations prevent the worker from sending a terminal result.
 * BD-S17（P2-05）：ops 逐条 JSON 消毒；单条不可序列化（如脚本给 item 挂了
 * 循环引用自定义字段）降级为诊断 op，不再拖垮整个 result。
 */
export async function executeInvocation(
  invoke: ScriptInvoke,
  hooks: ExecutorHooks,
): Promise<ScriptResult> {
  try {
    const result = await executeUnchecked(invoke, hooks);
    const { ops, ...base } = result;
    const clean = JSON.parse(JSON.stringify(base)) as ScriptResult;
    if (ops !== undefined) {
      clean.ops = ops.map((op) => {
        try {
          return JSON.parse(JSON.stringify(op)) as Record<string, unknown>;
        } catch {
          return {
            op: "diagnostic",
            code: "OP_SERIALIZE_FAILED",
            message: `script op could not be serialized and was dropped (${String(op.op)})`,
          };
        }
      });
    }
    return clean;
  } catch (error) {
    return {
      invocation_id: invoke.invocation_id,
      outcome: "error",
      error: { code: "SCRIPT_RESULT_INVALID", message: formatException(error) },
    };
  }
}
