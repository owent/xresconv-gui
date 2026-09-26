import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AppliedOpsReport, BackendSnapshot, TreeNodeSnap } from "../src/adapters/backend";
import { resetSessionStore, useSessionStore } from "../src/app/session-store";

// jsdom 无 WebView 桥接；mock Tauri 层（isTauri=false → 事件订阅降级为空订阅）。
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

const mockedInvoke = invoke as unknown as Mock<
  (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
>;

function itemNode(id: number, title: string, extra: Partial<TreeNodeSnap> = {}): TreeNodeSnap {
  return {
    key: id,
    title,
    tooltip: `${title} 描述`,
    folder: false,
    unselectable: false,
    selected: false,
    partsel: false,
    expanded: false,
    autoSelect: false,
    item: {
      id,
      file: `${title}.xlsx`,
      scheme: `${title}.xlsx#sheet1`,
      name: title,
      desc: `${title} 描述`,
      tags: ["t1"],
      classes: ["c1"],
    },
    children: [],
    ...extra,
  };
}

/** 夹具：含 selected / partsel / unselectable / 空分类 / 展开标记。 */
function makeSnapshot(state = "ready"): BackendSnapshot {
  return {
    state: state as BackendSnapshot["state"],
    runSeq: 0,
    config: { path: "D:/conf/convert_list.xml" },
    tree: {
      version: 1,
      nodes: [
        {
          key: "cat:basic",
          title: "基础分类",
          tooltip: "基础分类",
          folder: true,
          unselectable: false,
          selected: false,
          partsel: true,
          expanded: true,
          autoSelect: false,
          children: [
            itemNode(1, "alpha", { selected: true }),
            itemNode(2, "beta"),
            itemNode(3, "gamma", { unselectable: true }),
          ],
        },
        {
          key: "cat:empty",
          title: "空分类",
          tooltip: "空分类",
          folder: true,
          unselectable: false,
          selected: false,
          partsel: false,
          expanded: false,
          autoSelect: false,
          children: [],
        },
      ],
    },
    selectedItems: [{ id: 1, name: "alpha" }],
    settings: {
      overrides: {},
      effective: {
        workDir: "",
        xresloaderPath: "",
        proto: "",
        dataVersion: "",
        outputDir: "",
        rename: "",
        type: "bin",
        protoFile: [],
        dataSrcDir: [],
        matrix: [],
      },
      parallelism: 2,
    },
    customSelectors: null,
  };
}

function okReport(partial: Partial<AppliedOpsReport> = {}): AppliedOpsReport {
  return {
    applied: 1,
    rejected: [],
    diagnostics: [],
    version: 2,
    stateChanges: [],
    ...partial,
  };
}

/** 路由 backend_rpc 调用：applyOps/getSnapshot 由用例注入，其余报错。 */
function routeRpc(handlers: Record<string, (params: unknown) => unknown>) {
  mockedInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    if (cmd !== "backend_rpc") {
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    }
    const method = String(args?.method);
    const handler = handlers[method];
    if (handler === undefined) {
      return Promise.reject(`INVALID_STATE: unexpected method ${method}`);
    }
    try {
      return Promise.resolve(handler(args?.params));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error.message : String(error));
    }
  });
}

async function loadFixture(snapshot: BackendSnapshot = makeSnapshot()): Promise<void> {
  routeRpc({ loadConfig: () => snapshot });
  await expect(useSessionStore.getState().loadConfig("D:/conf/convert_list.xml")).resolves.toBe(
    true,
  );
}

function rpcCalls(method: string): { params: { ops?: Record<string, unknown>[] } }[] {
  return mockedInvoke.mock.calls
    .filter(([cmd, args]) => cmd === "backend_rpc" && args?.method === method)
    .map(([, args]) => ({ params: (args?.params ?? {}) as { ops?: Record<string, unknown>[] } }));
}

describe("session store (P4-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
  });

  it("loadConfig 入快照并初始化展开集合/连接态", async () => {
    await loadFixture();
    const state = useSessionStore.getState();
    expect(state.snapshot?.tree?.version).toBe(1);
    expect(state.configPath).toBe("D:/conf/convert_list.xml");
    expect(state.connection).toBe("ok");
    expect(state.lastError).toBeNull();
    // 快照中 cat:basic expanded=true
    expect([...state.expandedKeys]).toEqual(["cat:basic"]);
  });

  it("loadConfig 失败写入可见错误且快照保持为空", async () => {
    routeRpc({
      loadConfig: () => {
        throw new Error("CONFIG_ERROR: bad xml");
      },
    });
    await expect(useSessionStore.getState().loadConfig("bad.xml")).resolves.toBe(false);
    const state = useSessionStore.getState();
    expect(state.snapshot).toBeNull();
    expect(state.lastError).toBe("CONFIG_ERROR: bad xml");
    expect(state.connection).toBe("degraded");
  });

  it("toggleNode 发 select_node（缺省 selected = toggle），应用 stateChanges 并推进版本", async () => {
    await loadFixture();
    routeRpc({
      applyOps: () =>
        okReport({
          stateChanges: [
            { key: 2, selected: true, partsel: false },
            { key: "cat:basic", selected: true, partsel: true },
          ],
        }),
    });
    await useSessionStore.getState().toggleNode(2);

    const calls = rpcCalls("applyOps");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params.ops).toEqual([{ v: 1, op: "select_node", key: 2 }]);

    const tree = useSessionStore.getState().snapshot?.tree;
    expect(tree?.version).toBe(2);
    const beta = tree?.nodes[0]?.children[1];
    expect(beta?.selected).toBe(true);
    // 未变化的节点保持引用/状态
    expect(tree?.nodes[0]?.children[0]?.selected).toBe(true);
  });

  it("setNodeSelected 发显式 selected", async () => {
    await loadFixture();
    routeRpc({ applyOps: () => okReport() });
    await useSessionStore.getState().setNodeSelected(1, false);
    expect(rpcCalls("applyOps")[0]?.params.ops).toEqual([
      { v: 1, op: "select_node", key: 1, selected: false },
    ]);
  });

  it("selectAll/selectNone 发整树 op", async () => {
    await loadFixture();
    routeRpc({ applyOps: () => okReport() });
    await useSessionStore.getState().selectAll();
    await useSessionStore.getState().selectNone();
    const ops = rpcCalls("applyOps").map((call) => call.params.ops?.[0]?.op);
    expect(ops).toEqual(["select_all", "select_none"]);
    // 版本随每次成功应用推进（1 → 2），第二批携带新版本
    expect(rpcCalls("applyOps").map((call) => call.params.ops?.[0]?.v)).toEqual([1, 2]);
  });

  it("版本失配整批拒绝 → 自动 getSnapshot 重同步 + 可见提示", async () => {
    await loadFixture();
    const fresh = makeSnapshot();
    if (fresh.tree !== null) {
      fresh.tree.version = 5;
      const alpha = fresh.tree.nodes[0]?.children[0];
      if (alpha !== undefined) {
        alpha.selected = false;
      }
    }
    routeRpc({
      applyOps: () =>
        okReport({
          applied: 0,
          rejected: [{ op: "select_node", reason: "stale tree version (op v=1, current=5)" }],
          version: 5,
        }),
      getSnapshot: () => fresh,
    });
    await useSessionStore.getState().toggleNode(2);
    const state = useSessionStore.getState();
    expect(rpcCalls("getSnapshot")).toHaveLength(1);
    expect(state.snapshot?.tree?.version).toBe(5);
    expect(state.snapshot?.tree?.nodes[0]?.children[0]?.selected).toBe(false);
    expect(state.lastError).toContain("重新同步");
  });

  it("unselectable 节点本地 no-op，不发 RPC", async () => {
    await loadFixture();
    await useSessionStore.getState().toggleNode(3);
    await useSessionStore.getState().setNodeSelected(3, true);
    expect(rpcCalls("applyOps")).toHaveLength(0);
  });

  it("applyOps 传输层失败写入 lastError，树保持原状", async () => {
    await loadFixture();
    routeRpc({
      applyOps: () => {
        throw new Error("BACKEND_TIMEOUT: deadline exceeded");
      },
    });
    await useSessionStore.getState().toggleNode(2);
    const state = useSessionStore.getState();
    expect(state.lastError).toBe("BACKEND_TIMEOUT: deadline exceeded");
    expect(state.snapshot?.tree?.version).toBe(1);
    expect(state.snapshot?.tree?.nodes[0]?.children[1]?.selected).toBe(false);
  });

  it("事件水位：计数累计，state_change 同步快照 state", async () => {
    await loadFixture();
    const store = useSessionStore.getState();
    store.recordBackendEvent({ kind: "event", payload: { source: "backend", type: "log" } });
    store.recordBackendEvent({
      kind: "event",
      payload: { source: "backend", type: "state_change", state: "running", previous: "ready" },
    });
    const state = useSessionStore.getState();
    expect(state.eventCount).toBe(2);
    expect(state.lastStateChange).toEqual({ state: "running", previous: "ready" });
    expect(state.snapshot?.state).toBe("running");
  });

  it("guardian 死亡 → 连接降级 + 可见错误", async () => {
    await loadFixture();
    useSessionStore.getState().markGuardianDead({ reason: "channel EOF" });
    const state = useSessionStore.getState();
    expect(state.connection).toBe("degraded");
    expect(state.lastError).toContain("channel EOF");
  });

  // 2026-09-26 四轮：加载配置/开始转换即重置运行日志显示面（同首次启动）。
  it("loadConfig 成功后日志窗口清空且不再重拉历史（保留 seq 水位）", async () => {
    await loadFixture();
    // 先注入带 seq 的后端事件（推进水位）与本地行，模拟旧会话累积的日志。
    useSessionStore.getState().recordBackendEvent({
      kind: "event",
      payload: { type: "log", entry: { message: "旧后端日志", level: "info", seq: 5 } },
    });
    useSessionStore.getState().appendLocalLog("旧会话的日志行", "info");
    routeRpc({ loadConfig: () => makeSnapshot() });
    await expect(useSessionStore.getState().loadConfig("D:/conf/other.xml")).resolves.toBe(true);
    const logs = useSessionStore.getState().logs;
    expect(logs.entries).toHaveLength(0);
    expect(logs.initialized).toBe(true);
    expect(logs.noMoreOlder).toBe(true);
    // 水位保留：旧 seq 的事件不会灌回新窗口，新 seq 正常追加。
    useSessionStore.getState().recordBackendEvent({
      kind: "event",
      payload: { type: "log", entry: { message: "旧事件", level: "info", seq: 5 } },
    });
    expect(useSessionStore.getState().logs.entries).toHaveLength(0);
    useSessionStore.getState().recordBackendEvent({
      kind: "event",
      payload: { type: "log", entry: { message: "新会话日志", level: "info", seq: 6 } },
    });
    expect(useSessionStore.getState().logs.entries).toHaveLength(1);
  });

  it("configLoadSeq 仅在 loadConfig/reload 成功时递增（ops/run 重同步不动）", async () => {
    await loadFixture();
    expect(useSessionStore.getState().configLoadSeq).toBe(1);
    routeRpc({ getSnapshot: () => makeSnapshot() });
    await useSessionStore.getState().refreshSnapshot();
    expect(useSessionStore.getState().configLoadSeq).toBe(1);
    routeRpc({ loadConfig: () => makeSnapshot() });
    await useSessionStore.getState().loadConfig("D:/conf/again.xml");
    expect(useSessionStore.getState().configLoadSeq).toBe(2);
  });

  it("startRun 成功后日志窗口清空（运行从干净日志追加）", async () => {
    await loadFixture();
    useSessionStore.getState().appendLocalLog("加载期的诊断行", "notice");
    routeRpc({
      run: () => ({ runSeq: 1 }),
      getSnapshot: () => makeSnapshot("before_hooks"),
    });
    await expect(useSessionStore.getState().startRun()).resolves.toBe(true);
    expect(useSessionStore.getState().logs.entries).toHaveLength(0);
    expect(useSessionStore.getState().logs.initialized).toBe(true);
  });

  it("search/toggleExpanded 只改 UI 状态", async () => {
    await loadFixture();
    useSessionStore.getState().search("alp");
    useSessionStore.getState().toggleExpanded("cat:empty");
    const state = useSessionStore.getState();
    expect(state.searchTerm).toBe("alp");
    expect(state.expandedKeys.has("cat:empty")).toBe(true);
    useSessionStore.getState().toggleExpanded("cat:basic");
    expect(useSessionStore.getState().expandedKeys.has("cat:basic")).toBe(false);
    expect(rpcCalls("applyOps")).toHaveLength(0);
  });

  // 2026-09-26 用户反馈回归：启动期 getLogs 撞上 BACKEND_NOT_READY 不应把
  // "guardian protocol violation" 卡成持久告警，也不应让日志永远拉不出来。
  it("initLogs 启动瞬态失败静默重试，就绪后成功且 lastError 保持干净", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      routeRpc({
        getLogs: () => {
          calls++;
          if (calls < 3) {
            throw new Error("BACKEND_NOT_READY: backend not ready (state: starting)");
          }
          return { entries: [], droppedCount: 0, capacity: 10000 };
        },
      });
      void useSessionStore.getState().initLogs();
      await vi.advanceTimersByTimeAsync(601); // 第 2 次仍瞬态失败
      expect(useSessionStore.getState().lastError).toBeNull();
      expect(useSessionStore.getState().logs.initialized).toBe(false);
      await vi.advanceTimersByTimeAsync(601); // 第 3 次成功
      expect(useSessionStore.getState().logs.initialized).toBe(true);
      expect(useSessionStore.getState().lastError).toBeNull();
      expect(calls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("initLogs 非瞬态失败立即可见：initialized 置位 + lastError", async () => {
    routeRpc({
      getLogs: () => {
        throw new Error("INVALID_STATE: no session");
      },
    });
    await useSessionStore.getState().initLogs();
    const state = useSessionStore.getState();
    expect(state.logs.initialized).toBe(true);
    expect(state.lastError).toBe("INVALID_STATE: no session");
  });
});
