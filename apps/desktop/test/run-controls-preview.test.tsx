import { invoke } from "@tauri-apps/api/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { BackendSnapshot, PreviewResult } from "../src/adapters/backend";
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

describe("RunControls 预览（P4-04b，UI04）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    mockedInvoke.mockReset();
  });

  it("未加载配置时预览禁用；开始/取消/重置保持禁用（P4-06）", () => {
    render(<RunControls />);
    for (const name of ["预览", "开始转换", "取消", "重置"]) {
      expect(screen.getByRole("button", { name })).toHaveProperty("disabled", true);
    }
    expect(screen.getByRole("status", { name: "运行状态" }).textContent).toContain("未加载配置");
  });

  it("预览成功：展示任务数/选中数/执行目录与任务 display 列表", async () => {
    await loadFixture();
    routeRpc({ preview: () => makePreviewResult(2) });
    render(<RunControls />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "预览" }));

    const panel = await screen.findByRole("region", { name: "预览结果" });
    expect(panel.textContent).toContain("任务数：2");
    expect(panel.textContent).toContain("选中条目：2");
    expect(panel.textContent).toContain("D:/conf");
    expect(panel.textContent).toContain('t "bin"');
    expect(useSessionStore.getState().preview.status).toBe("ok");
  });

  it("输出冲突醒目列出（outputDir + rename 组与涉及条目）", async () => {
    await loadFixture();
    const result = makePreviewResult(2);
    result.conflicts = [
      { outputDir: "same-out", rename: "/(?i)\\.bin$/.lua/", items: ["one", "two"] },
    ];
    routeRpc({ preview: () => result });
    render(<RunControls />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "预览" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("输出冲突");
    expect(alert.textContent).toContain("same-out");
    expect(alert.textContent).toContain("/(?i)\\.bin$/.lua/");
    expect(alert.textContent).toContain("one、two");
  });

  it("预览失败：显示可读错误，XRESLOADER_NOT_FOUND 提示配置 JAR 路径", async () => {
    await loadFixture();
    routeRpc({
      preview: () => {
        throw new Error("XRESLOADER_NOT_FOUND: [D:/conf]  not exists");
      },
    });
    render(<RunControls />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "预览" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("XRESLOADER_NOT_FOUND");
    expect(alert.textContent).toContain("xresloader JAR");
    expect(useSessionStore.getState().preview.status).toBe("error");
  });

  it("任务列表有界展示：前 200 条 + 总数提示", async () => {
    await loadFixture();
    routeRpc({ preview: () => makePreviewResult(201) });
    render(<RunControls />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "预览" }));

    const panel = await screen.findByRole("region", { name: "预览结果" });
    const items = panel.querySelectorAll(".preview-tasks li");
    expect(items).toHaveLength(200);
    expect(panel.textContent).toContain("共 201 条");
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
    render(<RunControls />);
    const user = userEvent.setup();

    const button = screen.getByRole("button", { name: "预览" });
    await user.click(button);
    expect(useSessionStore.getState().preview.status).toBe("loading");
    expect(button).toHaveProperty("disabled", true);
    release(makePreviewResult(1));
    await screen.findByRole("region", { name: "预览结果" });
    expect(button).toHaveProperty("disabled", false);

    // 运行中禁用
    act(() => {
      useSessionStore.setState((state) =>
        state.snapshot === null ? {} : { snapshot: { ...state.snapshot, state: "converting" } },
      );
    });
    await waitFor(() => expect(button).toHaveProperty("disabled", true));
  });
});
