import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { BackendRpc } from "@xresconv/contracts";

/**
 * 业务 RPC 与事件适配层（P4-02 壳通道 ↔ backend，P4-03 前端接线）。
 *
 * 冻结契约（docs/plan/records/P4-02.md + packages/contracts/schema/backend-rpc.json）：
 * - 命令 `backend_rpc({method, params, timeout_ms?})`：resolve 为方法 result payload；
 *   reject 为字符串 "CODE: message"（INVALID_PARAMS/INVALID_STATE/CONFIG_ERROR/
 *   BACKEND_NOT_READY/BACKEND_DIED/BACKEND_TIMEOUT 等）。
 * - 事件 `xresconv-event`：payload = {kind, payload}；kind="event" 时 payload 为
 *   backend 事件（source:"backend"，type: log/state_change/dialog_request/
 *   dialog_invalidate/run_end/diagnostic）。
 * - 事件 `xresconv-guardian-dead`：payload = {reason}。
 *
 * 快照/树形状镜像 backend SessionTreeState 输出（packages/backend/src/service/
 * tree-state.ts 与 rpc-app.ts 的冻结形状；desktop 不依赖 compat-service 包，
 * 此处类型即前端侧合同，契约漂移由 backend 测试与 P4-02 通道用例拦截）。
 */

export type TreeNodeKey = string | number;

/** TreeNodeSnap：category key 为 "cat:<id>" 字符串，item key 为 number 运行时 id。 */
export interface TreeNodeSnap {
  key: TreeNodeKey;
  title: string;
  tooltip: string;
  folder: boolean;
  unselectable: boolean;
  selected: boolean;
  partsel: boolean;
  expanded: boolean;
  autoSelect: boolean;
  /** item 节点载荷（旧版 item_data 字段形状；category 节点缺省）。 */
  item?: Record<string, unknown>;
  children: TreeNodeSnap[];
}

export interface TreeSnap {
  version: number;
  nodes: TreeNodeSnap[];
}

/** 输出矩阵规则（镜像 backend config/model.ts OutputMatrixRule；tags/classes 必有数组）。 */
export interface OutputMatrixRuleLike {
  type?: string;
  rename?: string;
  outputDir?: string;
  tags: string[];
  classes: string[];
}

/**
 * 表单有效值（镜像 backend plan-builder.ts EffectiveSettings，P4-04a）：
 * 配置默认 ⊕ overrides 的全量字段；字符串字段无配置无覆盖时为 ""。
 */
export interface EffectiveSettingsLike {
  workDir: string;
  xresloaderPath: string;
  proto: string;
  dataVersion: string;
  outputDir: string;
  rename: string;
  type: string;
  protoFile: string[];
  dataSrcDir: string[];
  matrix: OutputMatrixRuleLike[];
}

/**
 * 转换参数覆盖（镜像 backend plan-builder.ts ConversionOverrides，P4-04a）：
 * undefined = 配置默认；空串/空数组 = 用户清空生效。
 */
export interface ConversionOverridesLike {
  workDir?: string;
  xresloaderPath?: string;
  proto?: string;
  dataVersion?: string;
  outputDir?: string;
  rename?: string;
  type?: string;
  protoFile?: string[];
  dataSrcDir?: string[];
  matrix?: OutputMatrixRuleLike[];
}

/** updateSettings 的 fields（P4-04b）：overrides 字段 + 会话级 parallelism（number, 1..16）。 */
export type SettingsFields = ConversionOverridesLike & { parallelism?: number };

/** 表单设置视图（镜像 backend rpc-app.ts SettingsView；P4-04b 起含 parallelism）。 */
export interface SettingsViewLike {
  overrides: ConversionOverridesLike;
  effective: EffectiveSettingsLike | null;
  parallelism: number;
}

/** preview 任务/冲突/结果（镜像 backend rpc-app.ts PreviewResult，P4-04a）。 */
export interface PreviewTaskLike {
  itemKey?: string;
  outputDir?: string;
  display: string;
}
export interface PreviewConflictLike {
  outputDir: string;
  rename: string;
  items: string[];
}

export interface PreviewResult {
  plan: {
    workDir: string;
    xresloaderPath: string;
    taskCount: number;
    tasks: PreviewTaskLike[];
  };
  selectionCount: number;
  conflicts: PreviewConflictLike[];
}

/**
 * 运行状态词表（镜像 backend domain/run-state.ts RunState）。
 * 活动运行三态（before_hooks/converting/after_hooks）允许 cancel/重复 cancel；
 * 终态三态（succeeded/failed/cancelled）允许再次 run/reset。
 */
export type RunStateLike =
  | "idle"
  | "loading"
  | "ready"
  | "before_hooks"
  | "converting"
  | "after_hooks"
  | "succeeded"
  | "failed"
  | "cancelled";

/** 活动运行状态（backend session.cancel 仅在这些状态下生效）。 */
export const RUN_ACTIVE_STATES: ReadonlySet<string> = new Set([
  "before_hooks",
  "converting",
  "after_hooks",
]);

/** 终态（run 允许自终态再次启动；reset 自终态重新武装）。 */
export const RUN_TERMINAL_STATES: ReadonlySet<string> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

/** run_end 事件摘要（镜像 backend service/run.ts RunSummary，P4-06 消费）。 */
export interface RunSummaryLike {
  runSeq: number;
  state: "succeeded" | "failed" | "cancelled";
  /** 失败计数（事件 reject/超时/异常各 +1；java 累加退出码；不承诺条目精确归因）。 */
  failedCount: number;
  /** 本次计划的任务总数（计划构建失败时为 0）。 */
  taskCount: number;
  durationMs: number;
}

/** 日志级别（镜像 backend log-pipeline.ts LogLevel）。 */
export type LogLevelLike = "info" | "notice" | "warning" | "error";

/** 日志条目（镜像 backend log-pipeline.ts LogEntry，P4-07 消费）。 */
export interface LogEntryLike {
  message: string;
  rawMessage: string;
  moduleName: string;
  /** 旧版样式类名（alert-*；hook 可改写），UI 映射为语义色。 */
  style: string;
  level: LogLevelLike;
  /** 渲染形态 `[module]: message`；复制/导出用同一文本。 */
  text: string;
  /** 队列内单调游标（getLogs 与事件流幂等对齐）；直发诊断无 seq。 */
  seq?: number;
}

/** getLogs 结果（镜像 backend rpc-app.ts rpcGetLogs，P4-07）。 */
export interface GetLogsResult {
  entries: LogEntryLike[];
  droppedCount: number;
  capacity: number;
}

/** 自定义选择器/按钮视图（镜像 backend custom-selector.ts CustomSelectorView，P4-05a）。 */
export type CustomSelectorViewLike =
  | { name: string; hasAction: boolean; defaultSelected: boolean; style: string | null }
  | { name: null; error: string };

/** 事件 hook 的 UI 开关（镜像 backend config/model.ts EventToggle，P4-05b 消费）。 */
export interface HookToggleLike {
  name: string;
  checked: boolean;
  mutable: boolean;
}

/** 事件 hook（镜像 backend config/model.ts Hook；UI 只用 enabled/toggle）。 */
export interface HookLike {
  enabled: boolean;
  toggle?: HookToggleLike;
}

/** gui 块的三组事件 hook（setHookEnabled 的 group 词表同名）。 */
export type HookGroup = "before" | "after" | "append_log";

export interface GuiHooksLike {
  onBeforeConvert: HookLike[];
  onAfterConvert: HookLike[];
  onAppendLog: HookLike[];
}

/**
 * 从快照 config（Record 形态）窄化出三组 hook。结构不符时返回 null
 * （config 由 backend 序列化而来，漂移由 backend 测试拦截；此处防御性解析）。
 */
export function guiHooksOf(config: Record<string, unknown> | null): GuiHooksLike | null {
  const gui = config?.gui;
  if (typeof gui !== "object" || gui === null) {
    return null;
  }
  const record = gui as Record<string, unknown>;
  const asHooks = (value: unknown): HookLike[] =>
    Array.isArray(value) ? (value as HookLike[]) : [];
  return {
    onBeforeConvert: asHooks(record.onBeforeConvert),
    onAfterConvert: asHooks(record.onAfterConvert),
    onAppendLog: asHooks(record.onAppendLog),
  };
}

/** gui hooks 三组与 setHookEnabled group 的对照（渲染顺序固定）。 */
export const HOOK_GROUPS: readonly { group: HookGroup; key: keyof GuiHooksLike; label: string }[] =
  [
    { group: "before", key: "onBeforeConvert", label: "转表前事件（on_before_convert）" },
    { group: "after", key: "onAfterConvert", label: "转表后事件（on_after_convert）" },
    { group: "append_log", key: "onAppendLog", label: "日志事件（on_append_log）" },
  ];

/** 脚本弹框载荷（镜像 script-host executor DialogRequestPayload，P2-06/P4-05b）。 */
export interface DialogPayloadLike {
  title?: string;
  content?: string;
  buttons?: string[];
}

export interface BackendSnapshot {
  state: string;
  runSeq: number;
  config: Record<string, unknown> | null;
  tree: TreeSnap | null;
  selectedItems: unknown[];
  settings: SettingsViewLike;
  /** P4-05a：自定义选择器/按钮视图（未 setCustomSelectors 时为 null）。 */
  customSelectors: CustomSelectorViewLike[] | null;
}

export type BackendRpcMethod = Extract<BackendRpc, { type: "request" }>["method"];

export interface NodeStateChange {
  key: TreeNodeKey;
  selected: boolean;
  partsel: boolean;
}

export interface AppliedOpsReport {
  applied: number;
  rejected: { op: string; reason: string }[];
  diagnostics: { code: string; message: string }[];
  /** 应用后的当前版本（失配整批拒绝时同样携带，供重同步）。 */
  version: number;
  /** select_* 级联变更全集（应用顺序），据此增量更新本地树。 */
  stateChanges: NodeStateChange[];
}

/** 壳透传的 xresconv-event 帧（kind="event" 时 payload 为 backend 事件）。 */
export interface XresconvEvent {
  kind: string;
  payload: unknown;
}

export interface GuardianDeadPayload {
  reason?: string;
}

/**
 * 业务 RPC 透传。mutating 方法不做在途去重（两次相同 toggle 语义上不是一次）；
 * 只读快照去重见 getBackendSnapshot。
 */
export function backendRpc<T>(
  method: BackendRpcMethod,
  params: Record<string, unknown> = {},
  timeoutMs?: number,
): Promise<T> {
  if (method !== "getSnapshot") invalidateBackendSnapshot();
  const args: Record<string, unknown> = { method, params };
  if (timeoutMs !== undefined) {
    args.timeoutMs = timeoutMs;
  }
  return invoke<T>("backend_rpc", args);
}

/** 同 tauri.ts 的在途去重：StrictMode 双挂载/并发刷新不放大成重复 RPC。 */
const inflight = new Map<string, Promise<unknown>>();

function dedupeInflight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key);
  if (pending) {
    return pending as Promise<T>;
  }
  const promise = run().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

/** getSnapshot 为幂等只读：在途去重安全。 */
export function getBackendSnapshot(): Promise<BackendSnapshot> {
  return dedupeInflight("backend_rpc:getSnapshot", () =>
    backendRpc<BackendSnapshot>("getSnapshot"),
  );
}

export function invalidateBackendSnapshot(): void {
  inflight.delete("backend_rpc:getSnapshot");
}

type EventHandler = (payload: never) => void;

interface EventHub {
  listeners: Set<EventHandler>;
  unlisten: (() => void) | null;
  attaching: boolean;
}

/**
 * 每个事件名一条底层 listen，引用计数共享：React StrictMode 的 setup→cleanup→setup
 * 同步重放期间 listen Promise 尚未结算，第二个订阅复用同一 hub，整次双挂载只产生
 * 一次真实 listen；最后一个订阅者释放时调用 unlisten（docs/plan/04-ui.md §状态分层：
 * 重复挂载不能建立重复订阅，所有监听有释放句柄）。
 */
const hubs = new Map<string, EventHub>();

function ensureAttached(event: string, hub: EventHub): void {
  if (hub.attaching || hub.unlisten !== null) {
    return;
  }
  hub.attaching = true;
  listen<unknown>(event, (e) => {
    for (const handler of [...hub.listeners]) {
      handler(e.payload as never);
    }
  })
    .then((unlisten) => {
      hub.attaching = false;
      if (hub.listeners.size === 0) {
        unlisten();
      } else {
        hub.unlisten = unlisten;
      }
    })
    .catch((error: unknown) => {
      hub.attaching = false;
      console.error(`listen ${event} failed`, error);
    });
}

function subscribe(event: string, handler: EventHandler): () => void {
  if (!isTauri()) {
    // 桌面预览/普通浏览器无桥接：空订阅（与 tauri.ts 探测失败降级同约定）。
    return () => {};
  }
  let hub = hubs.get(event);
  if (hub === undefined) {
    hub = { listeners: new Set(), unlisten: null, attaching: false };
    hubs.set(event, hub);
  }
  hub.listeners.add(handler);
  ensureAttached(event, hub);
  return () => {
    hub.listeners.delete(handler);
    if (hub.listeners.size === 0 && hub.unlisten !== null) {
      hub.unlisten();
      hub.unlisten = null;
    }
  };
}

/** 订阅 backend/guardian 事件流；返回释放句柄。 */
export function onBackendEvent(handler: (event: XresconvEvent) => void): () => void {
  return subscribe("xresconv-event", handler as EventHandler);
}

/** 订阅 guardian 死亡通知；返回释放句柄。 */
export function onGuardianDead(handler: (payload: GuardianDeadPayload) => void): () => void {
  return subscribe("xresconv-guardian-dead", handler as EventHandler);
}
