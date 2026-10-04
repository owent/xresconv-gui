/** 执行五类脚本入口，为调用重建明确上下文，保持按钮 data、模块解析、树镜像和回调约定。接口见 docs/user/scripts.md。 */
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

/** Worker-lifetime button data store (data persists per button). */
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

/** 脚本上下文显式移除默认 console，统一使用 log_* 记录日志。 */
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
  // 缺省弹窗标题与内容保持明确提示。
  const alertError = (content?: unknown, title?: unknown): void => {
    const token = randomUUID();
    hooks.requestDialog(invocationId, {
      token,
      title: title == null ? "出错啦" : String(title),
      content: content == null ? "无内容，参数错误" : String(content),
      buttons: ["ok"],
    });
    // alert_error 无脚本回调，但仍登记 token：应答到达时静默
    // 最终化，避免 worker 侧报 "unknown token" 噪音（ 注册表统一管理）。
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

/** require 以配置文件为锚点，配置模块优先。裸包名解析失败时查 XRESCONV_SCRIPT_MODULE_DIRS 提供的发行模块目录；已找到模块的内部错误直接报告。 */
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
 * Keys shared by the event/button/append-log base contexts.
 * on_append_log reuses the event base verbatim (append_log_context ===
 * vm_context_obj), so require/selected_nodes/run_seq are present.
 *
 * context.tree（TreeSnapshot）存在时，selected_nodes/selected_items 由
 * NodeMirror 重建（别名恒等 + 有序 ops）；不存在或为非法快照时回退为 JSON
 * 快照透传（ 降级形态）并附诊断 op。
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
  // No run_seq for buttons. global_options stays in the
  // 按钮 global_options 使用数组形式。
  // 按钮日志模块名使用脚本名称，调用通过 button_id 关联。
  return {
    ...sharedContextKeys(invoke, false, selection),
    ...makeAlerts(invoke.invocation_id, hooks),
    ...makeLoggers(`CONV SCRIPT:${invoke.button_id ?? ""}`, invoke.invocation_id, hooks),
    require: makeRequire(invoke),
  };
}

/** set_name: sync, no vm options, no require/resolve/reject. */
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
    // 同步 VM 执行不传 timeout，外部 worker 监督负责切断事件循环阻塞。
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
 * Events and buttons share the async
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
    // 异步入口提供计时器以支持显式 resolve/reject 完成。
    // 异步调用仍需遵守外部截止和会话清理。
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
      // 调用未完成时等待墙钟截止。
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
  // Wall-clock installed after the synchronous run returned.
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

/** on_append_log: sync, data is the log object, partial edits survive errors. */
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
  // 事件/按钮/append_log 共用的 NodeMirror（无 tree 时回退 JSON 快照）。
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
        //. Without a button_id there is nothing to key on, so
        // 缺少有效按钮身份时，data 只用于本次调用。
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
  // 镜像 ops 在 log 字段 ops 之后追加；实时节点 ops 内部保持调用序。
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
 *  *ops 逐条 JSON 消毒；单条不可序列化（如脚本给 item 挂了
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
