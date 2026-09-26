import { create } from "zustand";
import {
  type AppliedOpsReport,
  type BackendSnapshot,
  backendRpc,
  type DialogPayloadLike,
  type GetLogsResult,
  type GuardianDeadPayload,
  getBackendSnapshot,
  type HookGroup,
  invalidateBackendSnapshot,
  type LogEntryLike,
  type LogLevelLike,
  type NodeStateChange,
  type PreviewResult,
  RUN_TERMINAL_STATES,
  type RunSummaryLike,
  type SettingsFields,
  type SettingsViewLike,
  type TreeNodeKey,
  type TreeNodeSnap,
  type XresconvEvent,
} from "../adapters/backend";
import { exportTextFile, pickSavePath } from "../adapters/tauri";
import { writeClipboardText } from "./clipboard";
import { rememberLoadedConfig } from "./display-settings";

/**
 * 会话 store（docs/plan/04-ui.md §状态分层）：后端快照缓存 + 事件水位 + UI 状态。
 *
 * - 选择权威在 backend；UI 只发 ops（带版本闸），按 AppliedOpsReport.stateChanges
 *   增量套用并推进版本；版本失配自动 getSnapshot 重同步并以 lastError 可见提示
 *   （不悄悄吞）。
 * - 事件存计数、最近 state_change、脚本弹框队列与有界日志窗口（P4-07）；
 *   日志按 seq 幂等对齐（getLogs 初始页 + 事件流），guardian 死亡复位游标。
 * - 选择 ops 串行执行（selectionChain）：连续快速操作总是读到最新版本，
 *   避免自造的 stale 拒绝。
 * - 不在任何 useEffect 里以状态就绪为触发自动执行转换。
 */

export type ConnectionState = "idle" | "ok" | "degraded";

/**
 * 待应答脚本弹框（P4-05b，SC06）：dialog_request 进队，应答/失效出队。
 * answering=true 表示应答在途（UI 禁用按钮，已应答不可再点，P2-06 遗留项）。
 */
export interface PendingDialog {
  token: string;
  title: string;
  content: string;
  buttons: string[];
  answering: boolean;
}

/** setHookEnabled 的 group → 快照 config.gui 数组键。 */
const HOOK_GROUP_KEYS: Record<HookGroup, string> = {
  before: "onBeforeConvert",
  after: "onAfterConvert",
  append_log: "onAppendLog",
};

/** 预览面板状态（P4-04b）：idle=未预览/已失效；loading=在途；ok/error=最近一次结果。 */
export interface PreviewState {
  status: "idle" | "loading" | "ok" | "error";
  result: PreviewResult | null;
  /** 可读错误（壳侧 "CODE: message" 原样保留，UI 按 code 前缀给提示）。 */
  error: string | null;
}

/**
 * 最近一次运行的终态记录（P4-06，UI06）：run_end 摘要 + 终态迁移来源阶段。
 * endPhase 取 state_change.previous（事件按序先于 run_end 到达）；事件缺失时为
 * null，文案退化为通用描述，不猜测阶段。
 */
export interface RunRecord {
  runSeq: number;
  state: RunSummaryLike["state"];
  failedCount: number;
  taskCount: number;
  durationMs: number;
  endPhase: string | null;
}

/** UI 日志窗口条目（P4-07）：backend 条目 + 本地稳定键（无 seq 时本地计数器补）。 */
export type UiLogEntry = LogEntryLike & { localId: number };

export type LogLevelFilter = "all" | LogLevelLike;

/** 日志筛选（UI 状态；不影响落盘日志与脚本 hook）。 */
export interface LogFilterState {
  level: LogLevelFilter;
  text: string;
}

/** 日志窗口状态（P4-07，UI07）：有界缓冲 + 游标 + 丢弃计数。 */
export interface LogWindowState {
  entries: UiLogEntry[];
  /** 已完成初始 getLogs 拉取（防重试风暴；guardian 死亡复位）。 */
  initialized: boolean;
  /** backend 内存队列溢出丢弃数（getLogs 返回）。 */
  backendDroppedCount: number;
  /** UI 窗口淘汰的最老条目数。 */
  localDroppedCount: number;
  /** 已见最大 backend seq（事件幂等去重；guardian 死亡复位）。 */
  maxSeq: number;
  loadingOlder: boolean;
  /** 最近一次加载更早返回空（backend 窗口尽头）。 */
  noMoreOlder: boolean;
  readonly windowCapacity: number;
}

/** UI 日志窗口容量（backend 内存队列为 10000；此为其内的可管理窗口）。 */
const LOG_WINDOW_CAPACITY = 2000;
/** getLogs 单页条数。 */
const LOG_PAGE_SIZE = 1000;

/** 日志条目防御性窄化（backend 序列化漂移由 backend 测试拦截；畸形跳过不崩溃）。 */
function normalizeLogEntry(value: unknown): LogEntryLike | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.message !== "string") return null;
  const moduleName = typeof raw.moduleName === "string" ? raw.moduleName : "";
  const level = raw.level;
  return {
    message: raw.message,
    rawMessage: typeof raw.rawMessage === "string" ? raw.rawMessage : raw.message,
    moduleName,
    style: typeof raw.style === "string" ? raw.style : "",
    level:
      level === "info" || level === "notice" || level === "warning" || level === "error"
        ? level
        : "info",
    text:
      typeof raw.text === "string"
        ? raw.text
        : moduleName === ""
          ? raw.message
          : `[${moduleName}]: ${raw.message}`,
    ...(typeof raw.seq === "number" ? { seq: raw.seq } : {}),
  };
}

/** 按筛选条件过滤日志窗口（纯显示层；复制/导出同样使用筛选后集合）。 */
export function filterLogEntries(
  entries: readonly UiLogEntry[],
  filter: LogFilterState,
): UiLogEntry[] {
  const needle = filter.text.trim().toLowerCase();
  if (filter.level === "all" && needle === "") return [...entries];
  return entries.filter((entry) => {
    if (filter.level !== "all" && entry.level !== filter.level) return false;
    if (needle !== "" && !entry.text.toLowerCase().includes(needle)) return false;
    return true;
  });
}

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
  /** UI：预览状态（P4-04b）；loadConfig/reload 成功时重置为 idle（旧预览随配置失效）。 */
  preview: PreviewState;
  /** 待应答脚本弹框队列（P4-05b；dialog_request 进队、应答/失效出队）。 */
  pendingDialogs: PendingDialog[];
  /** P4-06：run RPC 在途（双击防护）。 */
  runStarting: boolean;
  /** P4-06：已请求取消、等待后端清理（终态事件清除；EX03 重复取消幂等）。 */
  cancelRequested: boolean;
  /** P4-06：reset RPC 在途。 */
  resetting: boolean;
  /** 最近一次运行终态记录（P4-06，UI06）；新 run 成功启动时清除。 */
  lastRun: RunRecord | null;
  /** 终态 state_change 的 previous；由同一次运行的 run_end 消费。 */
  pendingEndPhase: string | null;
  /** 日志窗口（P4-07，UI07）。 */
  logs: LogWindowState;
  /** 日志筛选（P4-07 UI 状态；不影响落盘日志与脚本 hook）。 */
  logFilter: LogFilterState;
}

interface SessionActions {
  loadConfig: (path: string) => Promise<boolean>;
  reload: () => Promise<boolean>;
  refreshSnapshot: () => Promise<boolean>;
  /**
   * 合并式写入表单覆盖/会话级并发数（P4-04b）。成功用返回的 SettingsView 整体
   * 替换 snapshot.settings（受控回写）；失败写 lastError。并行多次提交以请求
   * 序号防乱序覆盖（后端合并语义，最后一次响应即全量）。
   */
  updateSettings: (fields: SettingsFields) => Promise<boolean>;
  /** 预览（P4-04b，UI04）：在途 loading；错误（含 XRESLOADER_NOT_FOUND）进 error。 */
  runPreview: () => Promise<boolean>;
  /**
   * 开始转换（P4-06）：run RPC 立即返回 {runSeq}，进度/结果经事件流；成功后
   * 重同步快照（状态权威来自 backend，防事件迟到窗口）并清除上次运行记录。
   */
  startRun: () => Promise<boolean>;
  /** 取消当前运行（P4-06，EX03）：置 cancelRequested 直到终态事件（重复取消幂等）。 */
  cancelRun: () => Promise<boolean>;
  /** 业务重置（P4-06，EX03）：有活动运行先取消等清理；完成后重同步快照。 */
  resetSession: () => Promise<boolean>;
  /** 初始拉取日志窗口（P4-07）：getLogs 最新页；幂等（initialized 闸）。 */
  initLogs: () => Promise<void>;
  /** 加载更早日志（P4-07）：beforeSeq 向后分页并前插；无更早置 noMoreOlder。 */
  loadOlderLogs: () => Promise<void>;
  /** 复制筛选后日志到剪贴板（P4-07）：纯文本（entry.text 行）。 */
  copyLogs: () => Promise<boolean>;
  /** 导出筛选后日志（P4-07）：原生保存对话框 + 壳层 export_text_file。 */
  exportLogs: () => Promise<boolean>;
  /** 设置日志筛选（P4-07 UI 状态）。 */
  setLogFilter: (patch: Partial<LogFilterState>) => void;
  /** 事件 hook 开关（P4-05b，F09）：成功就地改写快照 config.gui；失败写 lastError。 */
  setHookEnabled: (group: HookGroup, index: number, enabled: boolean) => Promise<boolean>;
  /** 设置/重读自定义选择器文件（P4-05b）：成功后重同步快照（default_selected 已改树）。 */
  setCustomSelectors: (files: string[]) => Promise<boolean>;
  /** 自定义按钮点击（P4-05b）：按钮可改树/设置，成功后重同步快照；{ok:false} 写 lastError。 */
  invokeCustomButton: (name: string) => Promise<boolean>;
  /**
   * 应答脚本弹框（P4-05b，SC06）：yes/no/on_close(choice=null) 语义；
   * 应答在途标记 answering（禁用按钮），结算后本地出队（迟到应答后端丢弃）。
   */
  respondDialog: (token: string, choice: "yes" | "no" | null) => Promise<void>;
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

const initialPreview = (): PreviewState => ({ status: "idle", result: null, error: null });

/** run_end 摘要防御性窄化（backend 序列化漂移由 backend 测试拦截；畸形不崩溃）。 */
function parseRunSummary(value: unknown): RunSummaryLike | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.runSeq !== "number" ||
    (raw.state !== "succeeded" && raw.state !== "failed" && raw.state !== "cancelled") ||
    typeof raw.failedCount !== "number" ||
    typeof raw.taskCount !== "number" ||
    typeof raw.durationMs !== "number"
  ) {
    return null;
  }
  return {
    runSeq: raw.runSeq,
    state: raw.state,
    failedCount: raw.failedCount,
    taskCount: raw.taskCount,
    durationMs: raw.durationMs,
  };
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
  preview: initialPreview(),
  pendingDialogs: [],
  runStarting: false,
  cancelRequested: false,
  resetting: false,
  lastRun: null,
  pendingEndPhase: null,
  logs: {
    entries: [],
    initialized: false,
    backendDroppedCount: 0,
    localDroppedCount: 0,
    maxSeq: -1,
    loadingOlder: false,
    noMoreOlder: false,
    windowCapacity: LOG_WINDOW_CAPACITY,
  },
  logFilter: { level: "all", text: "" },
};

let sessionEpoch = 0;
let snapshotRequest = 0;
let settingsRequest = 0;
let previewRequest = 0;
let loadingConfig = false;
/** 日志条目本地稳定键计数器（backend seq 缺失的直发诊断用）。 */
let logLocalSeq = 0;

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
              // 配置变了旧预览失效（P4-04b）：loadConfig/reload 成功重置 preview。
              preview: initialPreview(),
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
        // 显示设置：记住上次转换列表（下次启动自动加载；无桥接时静默跳过）。
        void rememberLoadedConfig(path);
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

    updateSettings: async (fields) => {
      if (loadingConfig) return false;
      const epoch = sessionEpoch;
      const request = ++settingsRequest;
      try {
        const settings = await backendRpc<SettingsViewLike>("updateSettings", { fields });
        if (epoch !== sessionEpoch || request !== settingsRequest) return false;
        set((state) => {
          if (state.snapshot === null) return {};
          return { snapshot: { ...state.snapshot, settings }, lastError: null };
        });
        return true;
      } catch (error) {
        if (epoch === sessionEpoch && request === settingsRequest)
          set({ lastError: describeError(error) });
        return false;
      }
    },

    runPreview: async () => {
      if (loadingConfig) return false;
      const epoch = sessionEpoch;
      const request = ++previewRequest;
      set({ preview: { status: "loading", result: null, error: null } });
      try {
        const result = await backendRpc<PreviewResult>("preview");
        if (epoch !== sessionEpoch || request !== previewRequest) return false;
        set({ preview: { status: "ok", result, error: null } });
        return true;
      } catch (error) {
        if (epoch === sessionEpoch && request === previewRequest) {
          set({ preview: { status: "error", result: null, error: describeError(error) } });
        }
        return false;
      }
    },

    startRun: async () => {
      if (loadingConfig || get().runStarting) return false;
      const epoch = sessionEpoch;
      set({ runStarting: true });
      try {
        await backendRpc<{ runSeq: number }>("run");
        if (epoch !== sessionEpoch) return false;
        // 新运行开始：上次终态记录与取消标记失效（run_end 只针对当前运行）。
        set({ lastRun: null, pendingEndPhase: null, cancelRequested: false });
        // 状态权威同步（runConversion 首个 await 前已迁移 before_hooks）。
        await get().refreshSnapshot();
        return true;
      } catch (error) {
        if (epoch === sessionEpoch) set({ lastError: describeError(error) });
        return false;
      } finally {
        if (epoch === sessionEpoch) set({ runStarting: false });
      }
    },

    cancelRun: async () => {
      const epoch = sessionEpoch;
      try {
        await backendRpc<{ state: string }>("cancel");
        if (epoch !== sessionEpoch) return false;
        // 等待清理标记：终态 state_change / run_end / 新 run 启动时清除。
        set({ cancelRequested: true });
        return true;
      } catch (error) {
        if (epoch === sessionEpoch) set({ lastError: describeError(error) });
        return false;
      }
    },

    resetSession: async () => {
      if (loadingConfig || get().resetting) return false;
      const epoch = sessionEpoch;
      set({ resetting: true });
      try {
        await backendRpc<{ cancelledRun: boolean }>("reset");
        if (epoch !== sessionEpoch) return false;
        set({ cancelRequested: false });
        await get().refreshSnapshot();
        return true;
      } catch (error) {
        if (epoch === sessionEpoch) set({ lastError: describeError(error) });
        return false;
      } finally {
        if (epoch === sessionEpoch) set({ resetting: false });
      }
    },

    initLogs: async () => {
      if (get().logs.initialized) return;
      const epoch = sessionEpoch;
      try {
        const result = await backendRpc<GetLogsResult>("getLogs", { limit: LOG_PAGE_SIZE });
        if (epoch !== sessionEpoch) return;
        const fetched = (Array.isArray(result?.entries) ? result.entries : [])
          .map(normalizeLogEntry)
          .filter((entry): entry is LogEntryLike => entry !== null);
        set((state) => ({
          logs: {
            ...state.logs,
            entries: fetched.map((entry) => ({ ...entry, localId: ++logLocalSeq })),
            initialized: true,
            backendDroppedCount: typeof result?.droppedCount === "number" ? result.droppedCount : 0,
            maxSeq: fetched.reduce(
              (max, entry) => (entry.seq !== undefined && entry.seq > max ? entry.seq : max),
              state.logs.maxSeq,
            ),
          },
        }));
      } catch (error) {
        // 初始拉取失败：置 initialized 防渲染期重试风暴；事件流仍可继续补充，
        // guardian 死亡复位后会重新拉取。错误可见。
        if (epoch === sessionEpoch) {
          set((state) => ({
            logs: { ...state.logs, initialized: true },
            lastError: describeError(error),
          }));
        }
      }
    },

    loadOlderLogs: async () => {
      const logs = get().logs;
      if (!logs.initialized || logs.loadingOlder || logs.noMoreOlder) return;
      const firstSeq = logs.entries.find((entry) => entry.seq !== undefined)?.seq;
      if (firstSeq === undefined) return;
      const epoch = sessionEpoch;
      set((state) => ({ logs: { ...state.logs, loadingOlder: true } }));
      try {
        const result = await backendRpc<GetLogsResult>("getLogs", {
          limit: LOG_PAGE_SIZE,
          beforeSeq: firstSeq,
        });
        if (epoch !== sessionEpoch) return;
        const fetched = (Array.isArray(result?.entries) ? result.entries : [])
          .map(normalizeLogEntry)
          .filter((entry): entry is LogEntryLike => entry !== null);
        const have = new Set(
          get()
            .logs.entries.filter((entry) => entry.seq !== undefined)
            .map((entry) => entry.seq),
        );
        const older = fetched
          .filter((entry) => entry.seq === undefined || !have.has(entry.seq))
          .map((entry) => ({ ...entry, localId: ++logLocalSeq }));
        set((state) => ({
          logs: {
            ...state.logs,
            // 加载历史不主动驱逐（用户显式请求）；后续事件追加才淘汰最老。
            entries: [...older, ...state.logs.entries],
            loadingOlder: false,
            noMoreOlder: fetched.length === 0,
            backendDroppedCount:
              typeof result?.droppedCount === "number"
                ? result.droppedCount
                : state.logs.backendDroppedCount,
          },
        }));
      } catch (error) {
        if (epoch === sessionEpoch) {
          set((state) => ({ logs: { ...state.logs, loadingOlder: false } }));
          set({ lastError: describeError(error) });
        }
      }
    },

    copyLogs: async () => {
      const state = get();
      const filtered = filterLogEntries(state.logs.entries, state.logFilter);
      if (filtered.length === 0) {
        set({ lastError: "无日志可复制" });
        return false;
      }
      try {
        await writeClipboardText(`${filtered.map((entry) => entry.text).join("\n")}\n`);
        return true;
      } catch (error) {
        set({ lastError: describeError(error) });
        return false;
      }
    },

    exportLogs: async () => {
      const state = get();
      const filtered = filterLogEntries(state.logs.entries, state.logFilter);
      if (filtered.length === 0) {
        set({ lastError: "无日志可导出" });
        return false;
      }
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
      const path = await pickSavePath(`xresconv-gui-logs-${stamp}.log`);
      if (path === null) return false; // 用户取消，非错误
      const epoch = sessionEpoch;
      try {
        await exportTextFile(path, `${filtered.map((entry) => entry.text).join("\n")}\n`);
        return true;
      } catch (error) {
        if (epoch === sessionEpoch) set({ lastError: describeError(error) });
        return false;
      }
    },

    setLogFilter: (patch) => {
      set((state) => ({ logFilter: { ...state.logFilter, ...patch } }));
    },

    setHookEnabled: async (group, index, enabled) => {
      const epoch = sessionEpoch;
      try {
        await backendRpc("setHookEnabled", { group, index, enabled });
      } catch (error) {
        if (epoch === sessionEpoch) set({ lastError: describeError(error) });
        return false;
      }
      if (epoch !== sessionEpoch) return false;
      // 就地改写快照 config.gui（后端已生效，无需整树重同步）。
      set((state) => {
        const config = state.snapshot?.config;
        if (state.snapshot === null || config == null) return {};
        const gui = config.gui;
        if (typeof gui !== "object" || gui === null) return {};
        const key = HOOK_GROUP_KEYS[group];
        const hooks = (gui as Record<string, unknown>)[key];
        if (!Array.isArray(hooks) || hooks[index] === undefined) return {};
        const nextHooks = (hooks as Record<string, unknown>[]).map((hook, i) =>
          i === index ? { ...hook, enabled } : hook,
        );
        return {
          snapshot: {
            ...state.snapshot,
            config: { ...config, gui: { ...(gui as Record<string, unknown>), [key]: nextHooks } },
          },
          lastError: null,
        };
      });
      return true;
    },

    setCustomSelectors: async (files) => {
      if (loadingConfig) return false;
      const epoch = sessionEpoch;
      try {
        await backendRpc("setCustomSelectors", { files });
      } catch (error) {
        if (epoch === sessionEpoch) set({ lastError: describeError(error) });
        return false;
      }
      if (epoch !== sessionEpoch) return false;
      // default_selected 可能已改树；视图也随快照回来。
      await get().refreshSnapshot();
      return true;
    },

    invokeCustomButton: async (name) => {
      if (loadingConfig) return false;
      const epoch = sessionEpoch;
      let result: { ok: boolean; error?: string };
      try {
        result = await backendRpc<{ ok: boolean; error?: string }>("invokeCustomButton", { name });
      } catch (error) {
        if (epoch === sessionEpoch) set({ lastError: describeError(error) });
        return false;
      }
      if (epoch !== sessionEpoch) return false;
      // 按钮动作（匹配切换/脚本 ops/select_all…）在 backend 改树：重同步快照。
      await get().refreshSnapshot();
      if (!result.ok) {
        // 动作链失败 backend 已记 CUSTOM SELECTOR 日志；此处让错误在 UI 同样可见。
        set({ lastError: result.error ?? "自定义按钮动作失败" });
        return false;
      }
      return true;
    },

    respondDialog: async (token, choice) => {
      // 已应答按钮立即禁用（P2-06 遗留：UI 侧防重复应答）。
      set((state) => ({
        pendingDialogs: state.pendingDialogs.map((dialog) =>
          dialog.token === token ? { ...dialog, answering: true } : dialog,
        ),
      }));
      try {
        await backendRpc("respondDialog", { token, choice });
      } catch (error) {
        set({ lastError: describeError(error) });
      } finally {
        // 已应答/已失效（answered:false）都出队；迟到应答由后端按 SC06 丢弃。
        set((state) => ({
          pendingDialogs: state.pendingDialogs.filter((dialog) => dialog.token !== token),
        }));
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
          const payload = event.payload as {
            type?: string;
            state?: string;
            previous?: string;
            token?: string;
            dialog?: DialogPayloadLike;
            summary?: unknown;
          };
          if (payload?.type === "state_change") {
            next.lastStateChange = { state: payload.state, previous: payload.previous };
            if (state.snapshot !== null && typeof payload.state === "string") {
              next.snapshot = { ...state.snapshot, state: payload.state };
            }
            if (typeof payload.state === "string" && RUN_TERMINAL_STATES.has(payload.state)) {
              // 记录终态来源阶段（同一次运行的 run_end 消费）；清理标记无论
              // run_end 是否到达都不能卡住（EX03：终态只发布一次）。
              next.pendingEndPhase = typeof payload.previous === "string" ? payload.previous : null;
              next.cancelRequested = false;
            }
          }
          const summary = parseRunSummary(payload?.summary);
          if (payload?.type === "run_end" && summary !== null) {
            next.lastRun = { ...summary, endPhase: state.pendingEndPhase };
            next.pendingEndPhase = null;
            next.cancelRequested = false;
          }
          if (payload?.type === "log") {
            const entry = normalizeLogEntry((payload as { entry?: unknown }).entry ?? payload);
            if (entry !== null) {
              // seq 幂等去重：getLogs 初始页与事件流重叠、迟到重复事件跳过。
              if (entry.seq === undefined || entry.seq > state.logs.maxSeq) {
                const appended: UiLogEntry = { ...entry, localId: ++logLocalSeq };
                const entries = [...state.logs.entries, appended];
                let localDroppedCount = state.logs.localDroppedCount;
                const overflow = entries.length - state.logs.windowCapacity;
                if (overflow > 0) {
                  entries.splice(0, overflow);
                  localDroppedCount += overflow;
                }
                next.logs = {
                  ...state.logs,
                  entries,
                  localDroppedCount,
                  maxSeq:
                    entry.seq !== undefined && entry.seq > state.logs.maxSeq
                      ? entry.seq
                      : state.logs.maxSeq,
                };
              }
            }
          }
          if (payload?.type === "dialog_request" && typeof payload.token === "string") {
            // 脚本弹框进队（P4-05b，SC06）；同 token 重发不重复入队。
            if (!state.pendingDialogs.some((dialog) => dialog.token === payload.token)) {
              const dialog = payload.dialog ?? {};
              next.pendingDialogs = [
                ...state.pendingDialogs,
                {
                  token: payload.token,
                  title: typeof dialog.title === "string" ? dialog.title : "",
                  content: typeof dialog.content === "string" ? dialog.content : "",
                  buttons: Array.isArray(dialog.buttons)
                    ? dialog.buttons.filter(
                        (button): button is string => typeof button === "string",
                      )
                    : ["ok"],
                  answering: false,
                },
              ];
            }
          }
          if (payload?.type === "dialog_invalidate" && typeof payload.token === "string") {
            // worker 死亡/TTL/显式 dismiss：关闭弹框且不应答（过期回调不执行）。
            next.pendingDialogs = state.pendingDialogs.filter(
              (dialog) => dialog.token !== payload.token,
            );
          }
        }
        return next;
      });
    },

    markGuardianDead: (payload) => {
      sessionEpoch++;
      loadingConfig = false;
      invalidateBackendSnapshot();
      // 在途动作的 finally 因 epoch 失配跳过清理，这里统一复位（否则按钮永久禁用）。
      set((state) => ({
        connection: "degraded",
        lastError: `后端进程已退出${payload.reason ? `：${payload.reason}` : ""}`,
        runStarting: false,
        cancelRequested: false,
        resetting: false,
        // 新一代 backend 的 seq 从 1 重新开始：复位游标与初始化标记，
        // 避免旧 maxSeq 误杀新一代事件；既有条目保留可见（历史）。
        logs: {
          ...state.logs,
          initialized: false,
          maxSeq: -1,
          loadingOlder: false,
          noMoreOlder: false,
        },
      }));
    },
  };
});

/** 测试隔离：重置数据字段，保留 actions。 */
export function resetSessionStore(): void {
  sessionEpoch++;
  loadingConfig = false;
  invalidateBackendSnapshot();
  useSessionStore.setState({
    ...initialData,
    expandedKeys: new Set<TreeNodeKey>(),
    preview: initialPreview(),
    pendingDialogs: [],
    runStarting: false,
    cancelRequested: false,
    resetting: false,
    lastRun: null,
    pendingEndPhase: null,
    logs: { ...initialData.logs },
    logFilter: { ...initialData.logFilter },
  });
}
