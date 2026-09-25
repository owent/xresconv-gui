import { invoke } from "@tauri-apps/api/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { BackendSnapshot, RunSummaryLike } from "../src/adapters/backend";
import { RunControls } from "../src/app/RunControls";
import { resetSessionStore, useSessionStore } from "../src/app/session-store";

// jsdom 无 WebView 桥接；mock Tauri 层。
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

const mockedInvoke = invoke as unknown as Mock<
  (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
>;

function makeSnapshot(state = "ready", runSeq = 0): BackendSnapshot {
  return {
    state,
    runSeq,
    config: { path: "D:/conf/convert_list.xml" },
    tree: null,
    selectedItems: [],
    settings: {
      overrides: {},
      effective: {
        workDir: "D:/conf",
        xresloaderPath: "xresloader.jar",
        proto: "protobuf",
        dataVersion: "",
        outputDir: "out",
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
  routeRpc({ loadConfig: () => snapshot, getSnapshot: () => snapshot });
  await expect(useSessionStore.getState().loadConfig("D:/conf/convert_list.xml")).resolves.toBe(
    true,
  );
}

function recordEvent(payload: Record<string, unknown>): void {
  act(() => {
    useSessionStore.getState().recordBackendEvent({ kind: "event", payload });
  });
}

function recordTerminalState(state: string, previous: string): void {
  recordEvent({ source: "backend", type: "state_change", state, previous });
}

function recordRunEnd(summary: RunSummaryLike): void {
  recordEvent({ source: "backend", type: "run_end", summary });
}

function buttonEnabled(name: string): boolean {
  return (screen.getByRole("button", { name }) as HTMLButtonElement).disabled === false;
}

function summaryText(summary: Partial<RunSummaryLike>): RunSummaryLike {
  return {
    runSeq: 1,
    state: "failed",
    failedCount: 1,
    taskCount: 0,
    durationMs: 500,
    ...summary,
  };
}

describe("RunControls 运行控制门禁（P4-06）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    mockedInvoke.mockReset();
  });

  it("ready：预览/开始可用，取消/重置禁用", async () => {
    await loadFixture();
    render(<RunControls />);
    expect(buttonEnabled("预览")).toBe(true);
    expect(buttonEnabled("开始转换")).toBe(true);
    expect(buttonEnabled("取消")).toBe(false);
    expect(buttonEnabled("重置")).toBe(false);
  });

  it("运行中（before_hooks/converting/after_hooks）：取消/重置可用，开始/预览禁用", async () => {
    await loadFixture();
    render(<RunControls />);
    for (const state of ["before_hooks", "converting", "after_hooks"]) {
      act(() => {
        const snapshot = useSessionStore.getState().snapshot;
        useSessionStore.setState((prev) =>
          prev.snapshot === null || snapshot === null ? {} : { snapshot: { ...snapshot, state } },
        );
      });
      await waitFor(() => expect(buttonEnabled("取消")).toBe(true));
      expect(buttonEnabled("重置")).toBe(true);
      expect(buttonEnabled("开始转换")).toBe(false);
      expect(buttonEnabled("预览")).toBe(false);
    }
  });

  it("终态（failed/succeeded/cancelled）：开始/预览/重置可用，取消禁用", async () => {
    await loadFixture();
    render(<RunControls />);
    for (const state of ["failed", "succeeded", "cancelled"]) {
      act(() => {
        const snapshot = useSessionStore.getState().snapshot;
        useSessionStore.setState((prev) =>
          prev.snapshot === null || snapshot === null ? {} : { snapshot: { ...snapshot, state } },
        );
      });
      await waitFor(() => expect(buttonEnabled("开始转换")).toBe(true));
      expect(buttonEnabled("取消")).toBe(false);
      expect(buttonEnabled("重置")).toBe(true);
      expect(buttonEnabled("预览")).toBe(true);
    }
  });

  it("加载中（loading）：全部业务按钮禁用", async () => {
    await loadFixture();
    render(<RunControls />);
    act(() => {
      const snapshot = useSessionStore.getState().snapshot;
      useSessionStore.setState((prev) =>
        prev.snapshot === null || snapshot === null
          ? {}
          : { snapshot: { ...snapshot, state: "loading" } },
      );
    });
    await waitFor(() => expect(buttonEnabled("开始转换")).toBe(false));
    expect(buttonEnabled("取消")).toBe(false);
    expect(buttonEnabled("重置")).toBe(false);
    expect(buttonEnabled("预览")).toBe(false);
  });
});

describe("RunControls 开始/取消/重置 RPC 流程（P4-06，EX03 前端侧）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    mockedInvoke.mockReset();
  });

  it("开始转换：发 run RPC，成功后重同步快照", async () => {
    await loadFixture();
    let rpcCount = 0;
    routeRpc({
      run: () => {
        rpcCount++;
        return { runSeq: 7 };
      },
      getSnapshot: () => makeSnapshot("before_hooks", 7),
    });
    render(<RunControls />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "开始转换" }));

    await waitFor(() => {
      expect(rpcCount).toBe(1);
      expect(mockedInvoke).toHaveBeenCalledWith("backend_rpc", { method: "run", params: {} });
    });
    // run 返回后重同步：状态权威来自 getSnapshot（防事件迟到窗口）。
    await waitFor(() => expect(useSessionStore.getState().snapshot?.state).toBe("before_hooks"));
    expect(useSessionStore.getState().snapshot?.runSeq).toBe(7);
    expect(useSessionStore.getState().runStarting).toBe(false);
  });

  it("开始转换在途：按钮禁用（双击不并发）", async () => {
    await loadFixture();
    let release: (value: { runSeq: number }) => void = () => {};
    routeRpc({
      run: () =>
        new Promise<{ runSeq: number }>((done) => {
          release = done;
        }),
      getSnapshot: () => makeSnapshot("before_hooks", 7),
    });
    render(<RunControls />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "开始转换" }));
    await waitFor(() => expect(useSessionStore.getState().runStarting).toBe(true));
    expect(buttonEnabled("开始转换")).toBe(false);
    release({ runSeq: 7 });
    await waitFor(() => expect(useSessionStore.getState().runStarting).toBe(false));
    expect(buttonEnabled("开始转换")).toBe(false); // 快照已 before_hooks：仍禁用
  });

  it("开始失败：错误可见，按钮回可用", async () => {
    await loadFixture();
    routeRpc({
      run: () => {
        throw new Error('INVALID_STATE: cannot start a run from state "loading"');
      },
    });
    render(<RunControls />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "开始转换" }));

    await waitFor(() => expect(useSessionStore.getState().lastError).toContain("INVALID_STATE"));
    expect(buttonEnabled("开始转换")).toBe(true);
  });

  it("取消：cancel RPC 后显示等待清理；终态事件清除", async () => {
    await loadFixture(makeSnapshot("converting", 3));
    routeRpc({
      cancel: () => ({ state: "converting" }),
      getSnapshot: () => makeSnapshot("cancelled", 3),
    });
    render(<RunControls />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(mockedInvoke).toHaveBeenCalledWith("backend_rpc", { method: "cancel", params: {} });
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "运行状态" }).textContent).toContain("等待清理"),
    );

    // backend 清理完成：终态 state_change + run_end。
    recordTerminalState("cancelled", "converting");
    recordRunEnd(summaryText({ state: "cancelled" }));

    await waitFor(() =>
      expect(screen.getByRole("status", { name: "运行状态" }).textContent).not.toContain(
        "等待清理",
      ),
    );
    expect(useSessionStore.getState().cancelRequested).toBe(false);
  });

  it("重置：reset RPC 后重同步快照；在途禁用", async () => {
    await loadFixture(makeSnapshot("failed", 3));
    let release: (value: { cancelledRun: boolean }) => void = () => {};
    routeRpc({
      reset: () =>
        new Promise<{ cancelledRun: boolean }>((done) => {
          release = done;
        }),
      getSnapshot: () => makeSnapshot("ready", 3),
    });
    render(<RunControls />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "重置" }));
    expect(mockedInvoke).toHaveBeenCalledWith("backend_rpc", { method: "reset", params: {} });
    await waitFor(() => expect(useSessionStore.getState().resetting).toBe(true));
    expect(buttonEnabled("重置")).toBe(false);

    release({ cancelledRun: false });
    await waitFor(() => expect(useSessionStore.getState().snapshot?.state).toBe("ready"));
    expect(useSessionStore.getState().resetting).toBe(false);
  });
});

describe("运行结果文案（P4-06，UI06：区分实际阶段与已发生副作用）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    mockedInvoke.mockReset();
  });

  async function renderWithResult(
    terminalFrom: string,
    summary: RunSummaryLike,
  ): Promise<HTMLElement> {
    await loadFixture(makeSnapshot(terminalFrom));
    render(<RunControls />);
    recordTerminalState(summary.state, terminalFrom);
    recordRunEnd(summary);
    return await screen.findByRole("status", { name: "运行结果" });
  }

  it("before 失败：明确未启动转换", async () => {
    const region = await renderWithResult(
      "before_hooks",
      summaryText({ state: "failed", failedCount: 1, taskCount: 0 }),
    );
    expect(region.textContent).toContain("前置事件");
    expect(region.textContent).toContain("未启动转换");
  });

  it("计划构建失败（converting 且任务数为 0）：未启动转换", async () => {
    const region = await renderWithResult(
      "converting",
      summaryText({ state: "failed", failedCount: 2, taskCount: 0 }),
    );
    expect(region.textContent).toContain("计划构建失败");
    expect(region.textContent).toContain("未启动转换");
  });

  it("Java 批次失败：失败计数 + 提交数，不伪造条目级明细", async () => {
    const region = await renderWithResult(
      "converting",
      summaryText({ state: "failed", failedCount: 2, taskCount: 5 }),
    );
    expect(region.textContent).toContain("失败计数 2");
    expect(region.textContent).toContain("5 个任务");
    expect(region.textContent).toContain("条目级");
    expect(region.textContent).toContain("日志");
  });

  it("after 失败：转换已完成并生成输出，后处理失败不伪装成功", async () => {
    const region = await renderWithResult(
      "after_hooks",
      summaryText({ state: "failed", failedCount: 1, taskCount: 5 }),
    );
    expect(region.textContent).toContain("转换已完成");
    expect(region.textContent).toContain("输出");
    expect(region.textContent).toContain("on_after_convert");
  });

  it("取消自 converting：任务中止且已生成输出保留", async () => {
    const region = await renderWithResult(
      "converting",
      summaryText({ state: "cancelled", taskCount: 5 }),
    );
    expect(region.textContent).toContain("已取消");
    expect(region.textContent).toContain("输出保留");
  });

  it("成功：提交数与耗时，不宣称逐条校验", async () => {
    const region = await renderWithResult(
      "after_hooks",
      summaryText({ state: "succeeded", failedCount: 0, taskCount: 5, durationMs: 1234 }),
    );
    expect(region.textContent).toContain("已完成");
    expect(region.textContent).toContain("5 个任务");
    expect(region.textContent).not.toContain("条目级");
  });

  it("终态事件缺失（run_end 无前置 state_change）：退化为通用文案，不猜测阶段", async () => {
    await loadFixture();
    render(<RunControls />);
    recordRunEnd(summaryText({ state: "failed", failedCount: 2, taskCount: 5 }));
    const region = await screen.findByRole("status", { name: "运行结果" });
    expect(region.textContent).toContain("失败");
    expect(region.textContent).toContain("失败计数 2");
    expect(region.textContent).not.toContain("前置事件");
    expect(region.textContent).not.toContain("计划构建失败");
    expect(region.textContent).not.toContain("on_after_convert");
  });
});

describe("store 运行语义（P4-06）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    mockedInvoke.mockReset();
  });

  it("run_end 摘要畸形（缺字段/错类型）：忽略不崩溃", async () => {
    await loadFixture();
    const store = useSessionStore.getState();
    expect(() => {
      store.recordBackendEvent({ kind: "event", payload: { source: "backend", type: "run_end" } });
      store.recordBackendEvent({
        kind: "event",
        payload: {
          source: "backend",
          type: "run_end",
          summary: { runSeq: "x", state: "failed", failedCount: 1, taskCount: 0, durationMs: 5 },
        },
      });
    }).not.toThrow();
    expect(useSessionStore.getState().lastRun).toBeNull();
  });

  it("startRun 在途重复调用：只发一次 run RPC", async () => {
    await loadFixture();
    let release: (value: { runSeq: number }) => void = () => {};
    let rpcCount = 0;
    routeRpc({
      run: () => {
        rpcCount++;
        return new Promise<{ runSeq: number }>((done) => {
          release = done;
        });
      },
    });
    const first = useSessionStore.getState().startRun();
    const second = await useSessionStore.getState().startRun();
    expect(second).toBe(false);
    expect(rpcCount).toBe(1);
    release({ runSeq: 1 });
    await expect(first).resolves.toBe(true);
  });

  it("startRun 成功清除上次运行结果与取消标记", async () => {
    await loadFixture(makeSnapshot("failed", 1));
    recordRunEnd(summaryText({ state: "failed", runSeq: 1 }));
    expect(useSessionStore.getState().lastRun).not.toBeNull();
    useSessionStore.setState({ cancelRequested: true });

    routeRpc({
      run: () => ({ runSeq: 2 }),
      getSnapshot: () => makeSnapshot("before_hooks", 2),
    });
    await expect(useSessionStore.getState().startRun()).resolves.toBe(true);

    expect(useSessionStore.getState().lastRun).toBeNull();
    expect(useSessionStore.getState().cancelRequested).toBe(false);
  });

  it("cancelRequested 由终态 state_change 清除（run_end 缺失也不卡显示）", async () => {
    await loadFixture(makeSnapshot("converting", 1));
    routeRpc({ cancel: () => ({ state: "converting" }) });
    await useSessionStore.getState().cancelRun();
    expect(useSessionStore.getState().cancelRequested).toBe(true);

    recordTerminalState("cancelled", "converting");
    expect(useSessionStore.getState().cancelRequested).toBe(false);
  });

  it("loadConfig 失败的 failed 迁移不设置 endPhase（loadConfig 不产生 run_end）", async () => {
    await loadFixture();
    recordTerminalState("failed", "loading");
    // 之后真实运行结束：startRun 已清 pendingEndPhase，run_end 无阶段可归属时退化为通用文案。
    routeRpc({
      run: () => ({ runSeq: 4 }),
      getSnapshot: () => makeSnapshot("before_hooks", 4),
    });
    await useSessionStore.getState().startRun();
    recordRunEnd(summaryText({ state: "failed", runSeq: 4, failedCount: 1, taskCount: 2 }));
    expect(useSessionStore.getState().lastRun?.endPhase).toBeNull();
  });

  it("guardian 死亡于 run 在途：在途标记复位，按钮不永久禁用", async () => {
    await loadFixture();
    routeRpc({
      // 真实通道死亡时 invoke 会 reject；此处挂起模拟"响应永远不会来"。
      run: () => new Promise<{ runSeq: number }>(() => {}),
    });
    void useSessionStore.getState().startRun();
    await waitFor(() => expect(useSessionStore.getState().runStarting).toBe(true));

    act(() => {
      useSessionStore.getState().markGuardianDead({ reason: "channel EOF" });
    });

    const state = useSessionStore.getState();
    expect(state.runStarting).toBe(false);
    expect(state.cancelRequested).toBe(false);
    expect(state.resetting).toBe(false);
    expect(state.connection).toBe("degraded");
  });
});
