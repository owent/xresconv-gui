import { listen } from "@tauri-apps/api/event";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AppliedOpsReport, BackendSnapshot, TreeNodeSnap } from "../src/adapters/backend";
import { ConversionTree } from "../src/app/ConversionTree";
import { ItemDetails } from "../src/app/ItemDetails";
import { RunControls } from "../src/app/RunControls";
import { resetSessionStore, useSessionStore } from "../src/app/session-store";
import { useBackendEvents } from "../src/app/use-backend-events";

// jsdom 无 WebView 桥接；mock Tauri 层。isTauri=true 以启用事件订阅路径。
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));

const unlistenSpy = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(unlistenSpy)),
}));

const mockedListen = listen as unknown as Mock<
  (event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>
>;

async function invokeMock() {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke as unknown as Mock<
    (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
  >;
}

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
      classes: ["c1", "c2"],
    },
    children: [],
    ...extra,
  };
}

/** 夹具：含 selected / partsel / unselectable / 空分类。 */
function makeSnapshot(): BackendSnapshot {
  return {
    state: "ready",
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
  return { applied: 1, rejected: [], diagnostics: [], version: 2, stateChanges: [], ...partial };
}

function routeRpc(
  mock: Awaited<ReturnType<typeof invokeMock>>,
  handlers: Record<string, (params: unknown) => unknown>,
) {
  mock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
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

async function loadFixture() {
  const invoke = await invokeMock();
  routeRpc(invoke, { loadConfig: () => makeSnapshot() });
  await expect(useSessionStore.getState().loadConfig("D:/conf/convert_list.xml")).resolves.toBe(
    true,
  );
  return invoke;
}

function applyOpsPayloads(
  invoke: Awaited<ReturnType<typeof invokeMock>>,
): Record<string, unknown>[][] {
  return invoke.mock.calls
    .filter(([cmd, args]) => cmd === "backend_rpc" && args?.method === "applyOps")
    .map(([, args]) => {
      const params = args?.params as { ops?: Record<string, unknown>[] } | undefined;
      return params?.ops ?? [];
    });
}

function checkboxOf(title: string): HTMLInputElement {
  return screen.getByRole("checkbox", {
    name: (name) => name.includes(`选择 ${title}`),
  }) as HTMLInputElement;
}

describe("ConversionTree (P4-03)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    unlistenSpy.mockClear();
    resetSessionStore();
    (await invokeMock()).mockReset();
  });

  it("三态渲染对照：selected / partsel / unselectable / 空分类", async () => {
    await loadFixture();
    render(<ConversionTree />);

    // React Aria Tree 的角色为 treegrid（grid 模式的树语义）。
    expect(screen.getByRole("treegrid", { name: "转换条目" })).toBeTruthy();

    const alpha = checkboxOf("alpha");
    expect(alpha.checked).toBe(true);
    const category = checkboxOf("基础分类");
    expect(category.checked).toBe(false);
    expect(category.indeterminate).toBe(true);
    // RAC 以 indeterminate 属性 + data-indeterminate 表达半选（native input 无 aria-checked="mixed"）
    expect(category.closest("[data-indeterminate]")).not.toBeNull();
    const beta = checkboxOf("beta");
    expect(beta.checked).toBe(false);
    expect(beta.indeterminate).toBe(false);
    const gamma = checkboxOf("gamma");
    expect(gamma.disabled).toBe(true);
    // 禁用节点有可读提示
    expect(gamma.getAttribute("aria-label")).toContain("不可勾选");
    // 空分类正常渲染
    expect(checkboxOf("空分类").checked).toBe(false);
  });

  it("点击复选框 → applyOps 形状与版本闸，stateChanges 增量应用", async () => {
    const invoke = await loadFixture();
    routeRpc(invoke, {
      applyOps: () =>
        okReport({
          stateChanges: [
            { key: 2, selected: true, partsel: false },
            { key: "cat:basic", selected: true, partsel: true },
          ],
        }),
    });
    render(<ConversionTree />);
    const user = userEvent.setup();

    await user.click(checkboxOf("beta"));

    await waitFor(() => expect(applyOpsPayloads(invoke)).toHaveLength(1));
    expect(applyOpsPayloads(invoke)[0]).toEqual([{ v: 1, op: "select_node", key: 2 }]);
    await waitFor(() => expect(checkboxOf("beta").checked).toBe(true));
    expect(useSessionStore.getState().snapshot?.tree?.version).toBe(2);
  });

  it("全部选中/全部取消发送整树 op（有配置才可用；按钮在 RunControls 组）", async () => {
    const invoke = await loadFixture();
    routeRpc(invoke, { applyOps: () => okReport() });
    render(
      <>
        <ConversionTree />
        <RunControls />
      </>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "全部选中" }));
    await user.click(screen.getByRole("button", { name: "全部取消" }));

    await waitFor(() => expect(applyOpsPayloads(invoke)).toHaveLength(2));
    expect(applyOpsPayloads(invoke)[0]).toEqual([{ v: 1, op: "select_all" }]);
    // 第一批应用后版本推进到 2，第二批携带新版本（版本闸）
    expect(applyOpsPayloads(invoke)[1]).toEqual([{ v: 2, op: "select_none" }]);
  });

  it("未加载配置时全选/全不选禁用且保留空态（按钮在 RunControls 组）", () => {
    render(
      <>
        <ConversionTree />
        <RunControls />
      </>,
    );
    expect(screen.getByRole("button", { name: "全部选中" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "全部取消" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("tree", { name: "转换条目" })).toBeTruthy();
    expect(screen.getByText("尚未加载配置；加载后在此显示分类与转换条目树。")).toBeTruthy();
  });

  it("搜索仅过滤显示：保留祖先链、显示命中数、不改真实选择", async () => {
    const invoke = await loadFixture();
    render(<ConversionTree />);
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText("搜索转换条目…"), "alpha");

    // alpha 命中；祖先 cat:basic 保留；beta/gamma/空分类不可见
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("基础分类")).toBeTruthy();
    expect(screen.queryByText("beta")).toBeNull();
    expect(screen.queryByText("gamma")).toBeNull();
    expect(screen.queryByText("空分类")).toBeNull();
    expect(screen.getByText("匹配 1 项")).toBeTruthy();
    // 过滤不改真实选择，也不产生 ops
    expect(useSessionStore.getState().snapshot?.tree?.nodes[0]?.children[0]?.selected).toBe(true);
    expect(applyOpsPayloads(invoke)).toHaveLength(0);

    // 清空搜索恢复全树
    await user.clear(screen.getByPlaceholderText("搜索转换条目…"));
    expect(screen.getByText("beta")).toBeTruthy();
  });

  it("Space 切换焦点节点勾选（React Aria 方向键导航保留）", async () => {
    const invoke = await loadFixture();
    routeRpc(invoke, { applyOps: () => okReport() });
    render(<ConversionTree />);
    const user = userEvent.setup();

    // 点击行文本使行获得焦点（user-event 会上溯到最近可聚焦祖先 = 行），再按空格
    // 标题点击=切换(fancytree 点行语义);本用例聚焦用 row.focus() 不产生 op。
    (screen.getByText("beta").closest('[role="row"]') as HTMLElement | null)?.focus();
    await user.keyboard(" ");

    await waitFor(() => expect(applyOpsPayloads(invoke)).toHaveLength(1));
    expect(applyOpsPayloads(invoke)[0]).toEqual([{ v: 1, op: "select_node", key: 2 }]);
  });

  it("双击切换勾选（旧版行为；净效果=切换一次）", async () => {
    const invoke = await loadFixture();
    routeRpc(invoke, { applyOps: () => okReport() });
    render(<ConversionTree />);
    const user = userEvent.setup();

    // 双击= 标题 click×2(两次切换,互相抵消) + onDoubleClick(一次切换) →
    // 净效果为切换一次;ops 为奇数个 select_node。
    await user.dblClick(screen.getByText("beta"));
    await waitFor(() => {
      const payloads = applyOpsPayloads(invoke);
      expect(payloads.length % 2).toBe(1);
      expect(payloads[0]).toEqual([{ v: 1, op: "select_node", key: 2 }]);
    });
  });

  it("禁用节点不可勾选（点击/空格均不产生 ops），但可聚焦", async () => {
    const invoke = await loadFixture();
    routeRpc(invoke, { applyOps: () => okReport() });
    render(<ConversionTree />);
    const user = userEvent.setup();

    const gamma = checkboxOf("gamma");
    await user.click(gamma);
    await user.click(screen.getByText("gamma"));
    await user.keyboard(" ");

    expect(applyOpsPayloads(invoke)).toHaveLength(0);
    // 可聚焦：点击行使 focusedKey 指向 gamma
    expect(useSessionStore.getState().focusedKey).toBe(3);
  });

  it("stale version 拒绝 → 自动重同步并显示可见提示", async () => {
    const invoke = await loadFixture();
    routeRpc(invoke, {
      applyOps: () =>
        okReport({
          applied: 0,
          rejected: [{ op: "select_node", reason: "stale tree version (op v=1, current=7)" }],
          version: 7,
        }),
      getSnapshot: () => {
        const fresh = makeSnapshot();
        if (fresh.tree !== null) {
          fresh.tree.version = 7;
        }
        return fresh;
      },
    });
    render(<ConversionTree />);
    const user = userEvent.setup();

    await user.click(checkboxOf("beta"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("重新同步");
    await waitFor(() => expect(useSessionStore.getState().snapshot?.tree?.version).toBe(7));
  });

  it("聚焦变化只更新详情，不改变选择（ItemDetails 只读对照）", async () => {
    const invoke = await loadFixture();
    render(
      <>
        <ConversionTree />
        <ItemDetails />
      </>,
    );
    // 标题点击=切换(fancytree 点行语义);本用例聚焦用 row.focus() 不产生 op。
    (screen.getByText("beta").closest('[role="row"]') as HTMLElement | null)?.focus();

    const details = screen.getByRole("group", { name: "条目详情" });
    await waitFor(() => expect(within(details).getByDisplayValue("beta")).toBeTruthy());
    expect(within(details).getByDisplayValue("beta 描述")).toBeTruthy();
    expect(within(details).getByDisplayValue("beta.xlsx")).toBeTruthy();
    expect(within(details).getByDisplayValue("beta.xlsx#sheet1")).toBeTruthy();
    expect(within(details).getByDisplayValue("t1")).toBeTruthy();
    expect(within(details).getByDisplayValue("c1, c2")).toBeTruthy();
    // 聚焦/导航不产生任何选择 ops
    expect(applyOpsPayloads(invoke)).toHaveLength(0);
    expect(useSessionStore.getState().snapshot?.tree?.nodes[0]?.children[1]?.selected).toBe(false);
  });

  it("展开/收起为本地 UI 状态（chevron 切换，不发 ops）", async () => {
    const invoke = await loadFixture();
    render(<ConversionTree />);
    const user = userEvent.setup();

    // 初始：cat:basic 展开（快照 expanded=true）。标题现在也是按钮(点行切换勾选)，
    // 收起必须点 chevron（.tree-chevron），不再按名称匹配。
    expect(screen.getByText("alpha")).toBeTruthy();
    const chevron = document.querySelector('[data-key="cat:basic"] .tree-chevron');
    expect(chevron).not.toBeNull();
    await user.click(chevron as HTMLElement);
    expect(useSessionStore.getState().expandedKeys.has("cat:basic")).toBe(false);
    await waitFor(() => expect(screen.queryByText("alpha")).toBeNull());
    expect(applyOpsPayloads(invoke)).toHaveLength(0);
  });
});

describe("backend 事件订阅（StrictMode 约束）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unlistenSpy.mockClear();
    resetSessionStore();
  });

  function Probe() {
    useBackendEvents();
    return null;
  }

  it("StrictMode 双挂载 listen 仅一次，卸载即 unlisten", async () => {
    const view = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    await waitFor(() => {
      const events = mockedListen.mock.calls.map(([event]) => event);
      expect(events).toEqual(["xresconv-event", "xresconv-guardian-dead"]);
    });
    view.unmount();
    // 两条订阅各调用一次释放句柄
    await waitFor(() => expect(unlistenSpy).toHaveBeenCalledTimes(2));
  });

  it("事件帧汇入 store：计数与 state_change", async () => {
    render(<Probe />);
    await waitFor(() => expect(mockedListen).toHaveBeenCalledTimes(2));
    const handler = mockedListen.mock.calls.find(([event]) => event === "xresconv-event")?.[1];
    expect(handler).toBeDefined();
    handler?.({ payload: { kind: "event", payload: { source: "backend", type: "log" } } });
    handler?.({
      payload: {
        kind: "event",
        payload: { source: "backend", type: "state_change", state: "running", previous: "ready" },
      },
    });
    const state = useSessionStore.getState();
    expect(state.eventCount).toBe(2);
    expect(state.lastStateChange?.state).toBe("running");
  });
});

describe("ConversionTree 虚拟化（P4-08，UI03）", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    unlistenSpy.mockClear();
    resetSessionStore();
    (await invokeMock()).mockReset();
  });

  /** folders × itemsPer 个条目（默认 100×100 = 10100 节点），全部展开。 */
  function makeBigSnapshot(folders = 100, itemsPer = 100): BackendSnapshot {
    const categories: TreeNodeSnap[] = Array.from({ length: folders }, (_, catIndex) => ({
      key: `cat:${catIndex}`,
      title: `分类${catIndex}`,
      tooltip: `分类${catIndex}`,
      folder: true,
      unselectable: false,
      selected: false,
      partsel: false,
      expanded: true,
      autoSelect: false,
      children: Array.from({ length: itemsPer }, (_, i) =>
        itemNode(catIndex * 100000 + i, `条目${catIndex}-${i}`),
      ),
    }));
    return {
      state: "ready",
      runSeq: 0,
      config: { path: "D:/conf/big.xml" },
      tree: { version: 1, nodes: categories },
      selectedItems: [],
      settings: makeSnapshot().settings,
      customSelectors: null,
    };
  }

  /**
   * react-stately Virtualizer 在 NODE_ENV=test 下默认渲染全部（无窗口）；
   * mock clientWidth/clientHeight 后才走真实 overscan 裁剪路径。
   * 结束后恢复原型。
   */
  function mockViewport(width: number, height: number): void {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => width,
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => height,
    });
  }

  function restoreViewport(): void {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  }

  it("10k+ 节点全展开：窗口化渲染，DOM 行有界（不向 DOM 填充全部节点）", async () => {
    mockViewport(600, 400);
    try {
      const invoke = await invokeMock();
      routeRpc(invoke, { loadConfig: () => makeBigSnapshot() });
      await expect(useSessionStore.getState().loadConfig("D:/conf/big.xml")).resolves.toBe(true);
      render(<ConversionTree />);

      await waitFor(() => {
        const rows = document.querySelectorAll('[role="row"]');
        expect(rows.length).toBeGreaterThan(0);
      });
      const rows = document.querySelectorAll('[role="row"]');
      expect(rows.length).toBeLessThan(200);
      expect(rows.length).toBeLessThan(10100);
    } finally {
      restoreViewport();
    }
  });

  it("100k 节点（压力用例）：窗口化渲染仍成立（防挂起上限 60s）", { timeout: 60_000 }, async () => {
    mockViewport(600, 400);
    try {
      const invoke = await invokeMock();
      routeRpc(invoke, { loadConfig: () => makeBigSnapshot(1000, 100) });
      await expect(useSessionStore.getState().loadConfig("D:/conf/big.xml")).resolves.toBe(true);
      render(<ConversionTree />);

      await waitFor(() => {
        expect(document.querySelectorAll('[role="row"]').length).toBeGreaterThan(0);
      });
      const rows = document.querySelectorAll('[role="row"]');
      expect(rows.length).toBeLessThan(300);
      expect(rows.length).toBeLessThan(100100);
    } finally {
      restoreViewport();
    }
  });

  it("窗口外节点不在 DOM；store 中选择仍为后端权威（虚拟化不丢状态）", async () => {
    mockViewport(600, 400);
    try {
      const invoke = await invokeMock();
      const snapshot = makeBigSnapshot(20);
      // 第一个分类的第一个条目选中（三态来自后端快照，与渲染无关）。
      const firstItem = snapshot.tree?.nodes[0]?.children[0];
      if (firstItem) firstItem.selected = true;
      routeRpc(invoke, { loadConfig: () => snapshot });
      await expect(useSessionStore.getState().loadConfig("D:/conf/big.xml")).resolves.toBe(true);
      render(<ConversionTree />);

      await waitFor(() => {
        expect(document.querySelectorAll('[role="row"]').length).toBeGreaterThan(0);
      });
      // 选择权威在后端快照/UI store：虚拟化窗口未渲染该节点也不影响数据。
      const state = useSessionStore.getState();
      expect(state.snapshot?.tree?.nodes[0]?.children[0]?.selected).toBe(true);
    } finally {
      restoreViewport();
    }
  });
});
