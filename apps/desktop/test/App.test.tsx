import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { App } from "../src/App";
import { resetEnvironmentDiagnostics } from "../src/app/environment-diagnostics";
import { resetSessionStore } from "../src/app/session-store";

// The WebView bridge is not present under jsdom; mock the Tauri API layer.
vi.mock("@tauri-apps/api/core", () => ({
  // isTauri=false：事件订阅（backend adapter）降级为空订阅，本文件不覆盖事件流。
  isTauri: () => false,
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "get_app_info") {
      return { name: "xresconv-gui", version: "3.0.0-dev.0", protocol_version: 1 };
    }
    if (cmd === "get_cli_matches") {
      return { input: { value: "tests/fixtures/config/basic.xml" } };
    }
    if (cmd === "get_backend_health") {
      return {
        ok: true,
        role: "guardian",
        pid: 1234,
        node: "v24.21.0",
        backend: { state: "ready", pid: 1235, generation: 1 },
      };
    }
    throw new Error(`unexpected command: ${cmd}`);
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

const mockedInvoke = invoke as unknown as Mock<(cmd: string, args?: unknown) => Promise<unknown>>;
const mockedOpen = open as unknown as Mock<(options?: unknown) => Promise<string | null>>;

const JAVA_OK = {
  ok: true,
  versionText: 'openjdk version "17.0.9" 2023-10-17',
  versions: [17, 0, 9],
  bit64: true,
  executable: { command: "java", source: "path" },
  problem: null,
  downloadHints: [],
};

function defaultInvokeImpl(cmd: string, args?: unknown): Promise<unknown> {
  if (cmd === "backend_rpc") {
    const method = (args as { method?: string } | undefined)?.method;
    if (method === "getLogs") {
      return Promise.resolve({ entries: [], droppedCount: 0, capacity: 10000 });
    }
    if (method === "checkJava") {
      return Promise.resolve(JAVA_OK);
    }
    if (method === "applyOps") {
      return Promise.resolve({
        applied: 0,
        rejected: [],
        diagnostics: [],
        version: 1,
        stateChanges: [],
      });
    }
    return Promise.resolve({
      state: "ready",
      runSeq: 0,
      config: { path: "D:/conf/convert_list.xml" },
      tree: null,
      selectedItems: [],
    });
  }
  if (cmd === "get_app_info") {
    return Promise.resolve({ name: "xresconv-gui", version: "3.0.0-dev.0", protocol_version: 1 });
  }
  if (cmd === "get_cli_matches") {
    return Promise.resolve({ input: { value: "tests/fixtures/config/basic.xml" } });
  }
  if (cmd === "get_backend_health") {
    return Promise.resolve({
      ok: true,
      role: "guardian",
      pid: 1234,
      node: "v24.21.0",
      backend: { state: "ready", pid: 1235, generation: 1 },
    });
  }
  if (cmd === "read_display_settings") {
    // null：不触发自动加载链（display-settings 引导读到 null 即止）。
    return Promise.resolve(null);
  }
  if (cmd === "write_display_settings") {
    return Promise.resolve(null);
  }
  return Promise.reject(new Error(`unexpected command: ${cmd}`));
}

function invokeCallCount(cmd: string): number {
  return mockedInvoke.mock.calls.filter(([called]) => called === cmd).length;
}

/** 渲染并等待诊断信息写入运行日志（2026-09-26 三轮改版：调试信息进日志）。 */
async function renderAndSettle() {
  render(<App />);
  const log = await screen.findByRole("log", { name: "日志列表" });
  await waitFor(() => {
    const text = log.textContent ?? "";
    expect(text).toContain("xresconv-gui v3.0.0-dev.0 · protocol v1");
    expect(text).toContain("guardian ok · node v24.21.0");
    expect(text).toContain('Java 环境：openjdk version "17.0.9" 2023-10-17');
  });
  return log;
}

describe("App shell (P4-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    resetEnvironmentDiagnostics();
    mockedInvoke.mockImplementation(defaultInvokeImpl);
    mockedOpen.mockResolvedValue(null);
  });

  it("renders every UI region with its accessible name", async () => {
    await renderAndSettle();

    // 顶部环境状态条已移除（调试信息进运行日志；2026-09-26 用户反馈）。
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.getByRole("button", { name: "转换列表文件" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重载配置" })).toBeTruthy();

    // 左侧转换树与工具栏（ConversionTree / TreeToolbar）
    expect(screen.getByRole("complementary", { name: "转换列表" })).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "转换树工具栏" })).toBeTruthy();
    expect(screen.getByRole("tree", { name: "转换条目" })).toBeTruthy();
    expect(screen.getByPlaceholderText("搜索转换条目…")).toBeTruthy();

    // 右侧主区（ConversionSettings：文件行+详情/显示设置按钮同排）
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("form", { name: "转换参数" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "详情…" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "⚙ 显示设置" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "并发数" })).toBeTruthy();
    // 自适应（2026-09-26）：无选择器定义时自定义按钮区不渲染。
    expect(screen.queryByRole("region", { name: "自定义按钮" })).toBeNull();

    // 底部运行控制与日志（RunControls / RunSummary / LogPanel / DialogHost）
    expect(screen.getByRole("group", { name: "运行控制" })).toBeTruthy();
    for (const name of ["预览", "开始转换", "取消", "重置"]) {
      expect(screen.getByRole("button", { name })).toHaveProperty("disabled", true);
    }
    expect(screen.getByRole("status", { name: "运行状态" }).textContent).toContain("未加载配置");
    expect(screen.getByRole("region", { name: "运行日志" })).toBeTruthy();
    expect(screen.getByTestId("dialog-host")).toBeTruthy();
  });

  it("routes handshake info from the shell into the run log", async () => {
    const log = await renderAndSettle();
    const text = log.textContent ?? "";
    expect(text).toContain("xresconv-gui v3.0.0-dev.0 · protocol v1");
    expect(text).toContain("backend ready · pid 1235 · generation 1");
    // 主面板不再有常驻状态行（版本/健康/Java 都只在日志里）。
    expect(screen.queryByTestId("backend-health")).toBeNull();
    expect(screen.queryByTestId("java-status")).toBeNull();
  });

  it("lists CLI args returned by the shell in the run log", async () => {
    const log = await renderAndSettle();
    expect(log.textContent ?? "").toContain("tests/fixtures/config/basic.xml");
  });

  it("keeps the empty config state when the file picker is cancelled", async () => {
    mockedOpen.mockResolvedValue(null);
    await renderAndSettle();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "转换列表文件" }));
    await waitFor(() => expect(mockedOpen).toHaveBeenCalledTimes(1));
    expect((screen.getByTestId("picked-path") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "重载配置" })).toHaveProperty("disabled", true);
  });

  it("shows the picked config path and lets reload re-probe the backend", async () => {
    mockedOpen.mockResolvedValue("D:/conf/convert_list.xml");
    await renderAndSettle();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "转换列表文件" }));
    const picked = await screen.findByTestId("picked-path");
    expect((picked as HTMLInputElement).value).toBe("D:/conf/convert_list.xml");

    // 2026-09-26 五轮：加载成功重置日志后补写 Java 环境与输出矩阵概要。
    await waitFor(() => {
      const text = screen.getByRole("log", { name: "日志列表" }).textContent ?? "";
      expect(text).toContain("Java 环境：openjdk version");
      expect(text).toContain("输出矩阵：");
    });

    const reload = screen.getByRole("button", { name: "重载配置" });
    expect(reload).toHaveProperty("disabled", false);
    await user.click(reload);
    // 重载=配置层 RPC(健康刷新由 backend 事件驱动,不再耦合按钮)
    await waitFor(() => expect(invokeCallCount("backend_rpc")).toBeGreaterThanOrEqual(2));
  });

  it("logs a warning instead of a blocking alert when the health probe fails", async () => {
    mockedInvoke.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "get_backend_health") {
        return Promise.reject(new Error("guardian unreachable"));
      }
      return defaultInvokeImpl(cmd, args);
    });
    render(<App />);
    const log = await screen.findByRole("log", { name: "日志列表" });
    await waitFor(() => expect(log.textContent ?? "").toContain("后端状态检查失败"));
    const row = log.textContent ?? "";
    expect(row).toContain("guardian unreachable");
    // 壳仍可用：无环境状态条/横幅，表单与按钮照常渲染。
    expect(screen.getByRole("form", { name: "转换参数" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "开始转换" })).toBeTruthy();
  });

  it("does not duplicate bridge fetches under StrictMode double-mount", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await waitFor(() =>
      expect(screen.getByRole("log", { name: "日志列表" }).textContent ?? "").toContain(
        "xresconv-gui v3.0.0-dev.0",
      ),
    );
    expect(invokeCallCount("get_app_info")).toBe(1);
    expect(invokeCallCount("get_cli_matches")).toBe(1);
    expect(invokeCallCount("get_backend_health")).toBe(1);
  });

  it("opens the display settings dialog from the config bar with visible theme radios", async () => {
    await renderAndSettle();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "⚙ 显示设置" }));
    const dialog = await screen.findByRole("dialog", { name: "显示设置" });
    const radios = within(dialog).getAllByRole("radio");
    expect(radios.length).toBe(3);
    expect(within(dialog).getByText("跟随系统")).toBeTruthy();
    expect(within(dialog).getByText("亮色")).toBeTruthy();
    expect(within(dialog).getByText("暗色")).toBeTruthy();
    expect(within(dialog).getByTestId("last-config-file")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "显示设置" })).toBeNull());
  });
});
