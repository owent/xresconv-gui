import { invoke } from "@tauri-apps/api/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { BackendSnapshot, PreviewResult } from "../src/adapters/backend";
import { LogPanel } from "../src/app/LogPanel";
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

function makeSnapshot(state = "ready"): BackendSnapshot {
  return {
    state,
    runSeq: 0,
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

function makePreviewResult(taskCount = 2): PreviewResult {
  return {
    plan: {
      workDir: "D:/conf",
      xresloaderPath: "xresloader.jar",
      taskCount,
      tasks: Array.from({ length: taskCount }, (_, index) => ({
        itemKey: `item${index}`,
        outputDir: "out",
        display: `-t "bin" -o "out" -s "f${index}" -m "s${index}"`,
      })),
    },
    selectionCount: 2,
    conflicts: [],
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
  routeRpc({ loadConfig: () => snapshot });
  await expect(useSessionStore.getState().loadConfig("D:/conf/convert_list.xml")).resolves.toBe(
    true,
  );
}

/** 日志聚合文本（预览结果 2026-09-26 四轮起只写入运行日志）。 */
async function logText(): Promise<string> {
  const log = await screen.findByRole("log", { name: "日志列表" });
  return log.textContent ?? "";
}

describe("RunControls 预览（P4-04b，UI04）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    mockedInvoke.mockReset();
  });

  it("未加载配置时预览禁用；开始/取消/重置保持禁用（P4-06）", () => {
    render(
      <>
        <RunControls />
        <LogPanel />
      </>,
    );
    for (const name of ["预览", "开始转换", "取消", "重置"]) {
      expect(screen.getByRole("button", { name })).toHaveProperty("disabled", true);
    }
    expect(screen.getByRole("status", { name: "运行状态" }).textContent).toContain("未加载配置");
  });

  it("预览成功：任务数/选中数/执行目录与任务清单只写入运行日志", async () => {
    await loadFixture();
    routeRpc({ preview: () => makePreviewResult(2) });
    render(
      <>
        <RunControls />
        <LogPanel />
      </>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "预览" }));

    const text = await waitFor(async () => {
      const t = await logText();
      expect(t).toContain("预览：2 个任务（选中 2 条目）");
      return t;
    });
    expect(text).toContain("D:/conf");
    expect(text).toContain("预览任务：");
    expect(text).toContain('t "bin"');
    // 不再有独立预览结果面板（2026-09-26 四轮）。
    expect(screen.queryByRole("region", { name: "预览结果" })).toBeNull();
    expect(useSessionStore.getState().preview.status).toBe("ok");
  });

  it("真实重复发射（同条目同类型/目录/重命名）以 warning 写入运行日志", async () => {
    await loadFixture();
    const result = makePreviewResult(2);
    result.conflicts = [
      { outputDir: "same-out", rename: "/(?i)\\.bin$/.lua/", items: ["one", "one"] },
    ];
    routeRpc({ preview: () => result });
    render(
      <>
        <RunControls />
        <LogPanel />
      </>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "预览" }));

    const text = await waitFor(async () => {
      const t = await logText();
      expect(t).toContain("重复输出");
      return t;
    });
    expect(text).toContain("same-out");
    expect(text).toContain("/(?i)\\.bin$/.lua/");
  });

  it("预览失败：错误写入运行日志，XRESLOADER_NOT_FOUND 提示配置 JAR 路径", async () => {
    await loadFixture();
    routeRpc({
      preview: () => {
        throw new Error("XRESLOADER_NOT_FOUND: [D:/conf]  not exists");
      },
    });
    render(
      <>
        <RunControls />
        <LogPanel />
      </>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "预览" }));

    const text = await waitFor(async () => {
      const t = await logText();
      expect(t).toContain("预览失败：XRESLOADER_NOT_FOUND");
      return t;
    });
    expect(text).toContain("xresloader JAR");
    expect(useSessionStore.getState().preview.status).toBe("error");
  });

  it("任务清单有界写入日志：前 50 条 + 总数提示", async () => {
    await loadFixture();
    routeRpc({ preview: () => makePreviewResult(51) });
    render(
      <>
        <RunControls />
        <LogPanel />
      </>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "预览" }));

    // 虚拟窗口在 jsdom 只渲染可视行——断言走 store 全量条目（DOM 行有界由
    // conversion-tree/log-panel 虚拟化用例覆盖）。
    await waitFor(() => {
      const entries = useSessionStore.getState().logs.entries;
      expect(entries.some((entry) => entry.message.includes("仅列出前 50 条，共 51 条"))).toBe(
        true,
      );
      expect(entries.filter((entry) => entry.message.startsWith("预览任务："))).toHaveLength(50);
    });
  });

  it("在途期间预览按钮禁用；运行中禁用预览", async () => {
    await loadFixture();
    let release: (value: PreviewResult) => void = () => {};
    routeRpc({
      preview: () =>
        new Promise<PreviewResult>((done) => {
          release = done;
        }),
    });
    render(
      <>
        <RunControls />
        <LogPanel />
      </>,
    );
    const user = userEvent.setup();

    const button = screen.getByRole("button", { name: "预览" });
    await user.click(button);
    expect(useSessionStore.getState().preview.status).toBe("loading");
    expect(button).toHaveProperty("disabled", true);
    release(makePreviewResult(1));
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    await waitFor(async () => {
      expect(await logText()).toContain("预览：1 个任务");
    });

    // 运行中禁用
    act(() => {
      useSessionStore.setState((state) =>
        state.snapshot === null ? {} : { snapshot: { ...state.snapshot, state: "converting" } },
      );
    });
    await waitFor(() => expect(button).toHaveProperty("disabled", true));
  });
});
