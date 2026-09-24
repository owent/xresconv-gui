import { create } from "zustand";
import {
  type AppliedOpsReport,
  type BackendSnapshot,
  backendRpc,
  type GuardianDeadPayload,
  getBackendSnapshot,
  invalidateBackendSnapshot,
  type NodeStateChange,
  type TreeNodeKey,
  type TreeNodeSnap,
  type XresconvEvent,
} from "../adapters/backend";

/**
 * 会话 store（docs/plan/04-ui.md §状态分层）：后端快照缓存 + 事件水位 + UI 状态。
 *
 * - 选择权威在 backend；UI 只发 ops（带版本闸），按 AppliedOpsReport.stateChanges
 *   增量套用并推进版本；版本失配自动 getSnapshot 重同步并以 lastError 可见提示
 *   （不悄悄吞）。
 * - 事件只存计数与最近 state_change；日志详情缓冲属 P4-07。
 * - 选择 ops 串行执行（selectionChain）：连续快速操作总是读到最新版本，
 *   避免自造的 stale 拒绝。
 * - 不在任何 useEffect 里以状态就绪为触发自动执行转换。
 */

export type ConnectionState = "idle" | "ok" | "degraded";

interface SessionData {
  /** 最近一次 loadConfig/reload/getSnapshot 的快照；未加载为 null。 */
  snapshot: BackendSnapshot | null;
  connection: ConnectionState;
  /** 最近一次可见错误（加载失败/ops 拒绝/guardian 死亡/版本重同步提示）。 */
  lastError: string | null;
  /** 当前已成功加载的配置路径。 */
  configPath: string | null;
  /** 事件水位：累计收到的 xresconv-event 帧数。 */
  eventCount: number;
  /** 最近一次 state_change 事件的 state/previous。 */
  lastStateChange: { state?: string; previous?: string } | null;
  /** UI：搜索词（仅过滤显示，不改变真实选择）。 */
  searchTerm: string;
  /** UI：展开集合（加载时取快照 expanded，之后为本地状态）。 */
  expandedKeys: ReadonlySet<TreeNodeKey>;
  /** UI：聚焦节点 key；聚焦变化绝不影响选择。 */
  focusedKey: TreeNodeKey | null;
}

interface SessionActions {
  loadConfig: (path: string) => Promise<boolean>;
  reload: () => Promise<boolean>;
  refreshSnapshot: () => Promise<boolean>;
  /** Space/双击语义（selected 缺省 = toggle）；unselectable 节点本地 no-op。 */
  toggleNode: (key: TreeNodeKey) => Promise<void>;
  setNodeSelected: (key: TreeNodeKey, selected: boolean) => Promise<void>;
  selectAll: () => Promise<void>;
  selectNone: () => Promise<void>;
  search: (term: string) => void;
  toggleExpanded: (key: TreeNodeKey) => void;
  setExpandedKeys: (keys: ReadonlySet<TreeNodeKey>) => void;
  setFocusedKey: (key: TreeNodeKey | null) => void;
  recordBackendEvent: (event: XresconvEvent) => void;
  markGuardianDead: (payload: GuardianDeadPayload) => void;
}

export type SessionStore = SessionData & SessionActions;

function describeError(error: unknown): string {
  if (typeof error === "string") {
    return error; // 壳侧 Err(String)："CODE: message"
  }
  return error instanceof Error ? error.message : String(error);
}

function findNode(nodes: readonly TreeNodeSnap[], key: TreeNodeKey): TreeNodeSnap | null {
  for (const node of nodes) {
    if (node.key === key) {
      return node;
    }
    const found = findNode(node.children, key);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function collectExpandedKeys(nodes: readonly TreeNodeSnap[], out: Set<TreeNodeKey>): void {
  for (const node of nodes) {
    if (node.expanded) {
      out.add(node.key);
    }
    collectExpandedKeys(node.children, out);
  }
}

/** 按 stateChanges 增量套用（不可变更新，未命中分支保持引用）。 */
function applyStateChanges(
  nodes: readonly TreeNodeSnap[],
  changes: ReadonlyMap<TreeNodeKey, NodeStateChange>,
): { nodes: TreeNodeSnap[]; changed: boolean } {
  let changed = false;
  const next = nodes.map((node) => {
    const change = changes.get(node.key);
    const sub =
      node.children.length > 0
        ? applyStateChanges(node.children, changes)
        : { nodes: node.children, changed: false };
    if (change === undefined && !sub.changed) {
      return node;
    }
    changed = true;
    return {
      ...node,
      selected: change?.selected ?? node.selected,
      partsel: change?.partsel ?? node.partsel,
      children: sub.nodes,
    };
  });
  return { nodes: changed ? next : (nodes as TreeNodeSnap[]), changed };
}

const initialData: SessionData = {
  snapshot: null,
  connection: "idle",
  lastError: null,
  configPath: null,
  eventCount: 0,
  lastStateChange: null,
  searchTerm: "",
  expandedKeys: new Set<TreeNodeKey>(),
  focusedKey: null,
};

let sessionEpoch = 0;
let snapshotRequest = 0;
let loadingConfig = false;

export const useSessionStore = create<SessionStore>()((set, get) => {
  /** 选择 ops 串行链：任一环节失败不断链（错误已写入 lastError）。 */
  let selectionChain: Promise<void> = Promise.resolve();

  const applySelectionOps = (ops: Record<string, unknown>[]): Promise<void> => {
    const epoch = sessionEpoch;
    if (loadingConfig) return Promise.resolve();
    selectionChain = selectionChain
      .catch(() => {})
      .then(async () => {
        if (epoch !== sessionEpoch) return;
        snapshotRequest++;
        const tree = get().snapshot?.tree;
        if (tree == null) {
          return;
        }
        const versioned = ops.map((op) => ({ v: tree.version, ...op }));
        let report: AppliedOpsReport;
        try {
          report = await backendRpc<AppliedOpsReport>("applyOps", { ops: versioned });
        } catch (error) {
          if (epoch === sessionEpoch) set({ lastError: describeError(error) });
          return;
        }
        if (epoch !== sessionEpoch) return;
        if (report.rejected.some((entry) => entry.reason.includes("stale tree version"))) {
          // 版本闸拒绝：整批未生效；自动重同步并给出可见提示（04-ui §状态分层）。
          const ok = await get().refreshSnapshot();
          if (epoch !== sessionEpoch) return;
          set({
            lastError: ok
              ? "树状态已被并发更新，已重新同步最新选择，请重试操作"
              : (get().lastError ?? "树状态已过期且重同步失败"),
          });
          return;
        }
        const changes = new Map<TreeNodeKey, NodeStateChange>();
        for (const change of report.stateChanges) {
          changes.set(change.key, change);
        }
        set((state) => {
          if (state.snapshot?.tree == null || state.snapshot.tree.version !== tree.version) {
            return {};
          }
          return {
            snapshot: {
              ...state.snapshot,
              tree: {
                version: report.version,
                nodes: applyStateChanges(state.snapshot.tree.nodes, changes).nodes,
              },
            },
            lastError:
              report.rejected.length > 0
                ? report.rejected.map((entry) => `${entry.op}: ${entry.reason}`).join("；")
                : null,
          };
        });
      })
      .catch((error: unknown) => {
        if (epoch === sessionEpoch) set({ lastError: describeError(error) });
      });
    return selectionChain;
  };

  const storeSnapshot = (snapshot: BackendSnapshot, resetUi: boolean): void => {
    set((state) => {
      let focusedKey = state.focusedKey;
      // 重同步保留既有 UI 状态；聚焦节点可能已不存在，校验后清空。
      if (
        resetUi ||
        (focusedKey !== null && findNode(snapshot.tree?.nodes ?? [], focusedKey) === null)
      ) {
        focusedKey = null;
      }
      return {
        snapshot,
        configPath:
          typeof snapshot.config?.path === "string" ? snapshot.config.path : state.configPath,
        connection: "ok",
        lastError: null,
        focusedKey,
        ...(resetUi
          ? {
              searchTerm: "",
              expandedKeys: (() => {
                const keys = new Set<TreeNodeKey>();
                collectExpandedKeys(snapshot.tree?.nodes ?? [], keys);
                return keys;
              })(),
            }
          : {}),
      };
    });
  };

  return {
    ...initialData,

    loadConfig: async (path) => {
      if (loadingConfig) {
        set({ lastError: "配置正在加载，请完成后重试" });
        return false;
      }
      const epoch = ++sessionEpoch;
      snapshotRequest++;
      loadingConfig = true;
      try {
        const snapshot = await backendRpc<BackendSnapshot>("loadConfig", { path });
        if (epoch !== sessionEpoch) return false;
        storeSnapshot(snapshot, true);
        return true;
      } catch (error) {
        if (epoch === sessionEpoch)
          set({ lastError: describeError(error), connection: "degraded" });
        return false;
      } finally {
        if (epoch === sessionEpoch) loadingConfig = false;
      }
    },

    reload: async () => {
      if (loadingConfig) {
        set({ lastError: "配置正在加载，请完成后重试" });
        return false;
      }
      const epoch = ++sessionEpoch;
      snapshotRequest++;
      loadingConfig = true;
      try {
        const snapshot = await backendRpc<BackendSnapshot>("reload");
        if (epoch !== sessionEpoch) return false;
        storeSnapshot(snapshot, true);
        return true;
      } catch (error) {
        if (epoch === sessionEpoch)
          set({ lastError: describeError(error), connection: "degraded" });
        return false;
      } finally {
        if (epoch === sessionEpoch) loadingConfig = false;
      }
    },

    refreshSnapshot: async () => {
      if (loadingConfig) return false;
      const epoch = sessionEpoch;
      const request = ++snapshotRequest;
      try {
        const snapshot = await getBackendSnapshot();
        if (epoch !== sessionEpoch || request !== snapshotRequest) return false;
        storeSnapshot(snapshot, false);
        return true;
      } catch (error) {
        if (epoch === sessionEpoch && request === snapshotRequest)
          set({ lastError: describeError(error), connection: "degraded" });
        return false;
      }
    },

    toggleNode: (key) => {
      const node = findNode(get().snapshot?.tree?.nodes ?? [], key);
      if (node === null || node.unselectable) {
        // unselectable 直调 no-op（fancytree 语义；backend 侧同样 no-op）。
        return Promise.resolve();
      }
      return applySelectionOps([{ op: "select_node", key }]);
    },

    setNodeSelected: (key, selected) => {
      const node = findNode(get().snapshot?.tree?.nodes ?? [], key);
      if (node === null || node.unselectable) {
        return Promise.resolve();
      }
      return applySelectionOps([{ op: "select_node", key, selected }]);
    },

    selectAll: () => applySelectionOps([{ op: "select_all" }]),
    selectNone: () => applySelectionOps([{ op: "select_none" }]),

    search: (term) => set({ searchTerm: term }),

    toggleExpanded: (key) => {
      set((state) => {
        const next = new Set(state.expandedKeys);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return { expandedKeys: next };
      });
    },

    setExpandedKeys: (keys) => set({ expandedKeys: new Set(keys) }),

    setFocusedKey: (key) => set({ focusedKey: key }),

    recordBackendEvent: (event) => {
      const payload = event.payload as { source?: string; type?: string; message?: string } | null;
      if (
        event.kind === "event" &&
        payload?.source === "backend-supervisor" &&
        payload.type === "died"
      ) {
        get().markGuardianDead({ reason: payload.message });
      }
      set((state) => {
        const next: Partial<SessionData> = { eventCount: state.eventCount + 1 };
        if (event.kind === "event") {
          const payload = event.payload as { type?: string; state?: string; previous?: string };
          if (payload?.type === "state_change") {
            next.lastStateChange = { state: payload.state, previous: payload.previous };
            if (state.snapshot !== null && typeof payload.state === "string") {
              next.snapshot = { ...state.snapshot, state: payload.state };
            }
          }
        }
        return next;
      });
    },

    markGuardianDead: (payload) => {
      sessionEpoch++;
      loadingConfig = false;
      invalidateBackendSnapshot();
      set({
        connection: "degraded",
        lastError: `后端进程已退出${payload.reason ? `：${payload.reason}` : ""}`,
      });
    },
  };
});

/** 测试隔离：重置数据字段，保留 actions。 */
export function resetSessionStore(): void {
  sessionEpoch++;
  loadingConfig = false;
  invalidateBackendSnapshot();
  useSessionStore.setState({ ...initialData, expandedKeys: new Set<TreeNodeKey>() });
}
