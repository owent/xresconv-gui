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

export interface BackendSnapshot {
  state: string;
  runSeq: number;
  config: Record<string, unknown> | null;
  tree: TreeSnap | null;
  selectedItems: unknown[];
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
