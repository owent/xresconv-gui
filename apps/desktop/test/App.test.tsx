import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { App } from "../src/App";
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

const mockedInvoke = invoke as unknown as Mock<(cmd: string) => Promise<unknown>>;
const mockedOpen = open as unknown as Mock<(options?: unknown) => Promise<string | null>>;

function defaultInvokeImpl(cmd: string): Promise<unknown> {
  if (cmd === "backend_rpc")
    return Promise.resolve({
      state: "ready",
      runSeq: 0,
      config: { path: "D:/conf/convert_list.xml" },
      tree: null,
      selectedItems: [],
    });
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
  return Promise.reject(new Error(`unexpected command: ${cmd}`));
}

function invokeCallCount(cmd: string): number {
  return mockedInvoke.mock.calls.filter(([called]) => called === cmd).length;
}

/** 渲染并等待全部桥接探测结算，保证 adapter 的在途去重表清空、用例间隔离。 */
async function renderAndSettle() {
  render(<App />);
  await screen.findByText(/xresconv-gui v3\.0\.0-dev\.0 · protocol v1/);
  await screen.findByTestId("backend-health");
}

describe("App shell (P4-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    mockedInvoke.mockImplementation(defaultInvokeImpl);
    mockedOpen.mockResolvedValue(null);
  });

  it("renders every UI region with its accessible name", async () => {
    await renderAndSettle();

    // 顶部环境状态（AppShell / EnvironmentStatus）
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("button", { name: "选择 XML 配置…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重载配置" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "后端状态" })).toBeTruthy();

    // 左侧转换树与工具栏（ConversionTree / TreeToolbar）
    expect(screen.getByRole("complementary", { name: "转换列表" })).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "转换树工具栏" })).toBeTruthy();
    expect(screen.getByRole("tree", { name: "转换条目" })).toBeTruthy();
    expect(screen.getByPlaceholderText("搜索转换条目…")).toBeTruthy();
    for (const name of ["全部选中", "全部取消"]) {
      expect(screen.getByRole("button", { name })).toHaveProperty("disabled", true);
    }

    // 右侧主区（ConversionSettings / ItemDetails / OutputMatrixEditor / HookControls / CustomActionBar）
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("form", { name: "转换参数" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "条目详情" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "输出矩阵" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "转换事件" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "自定义按钮" })).toBeTruthy();

    // 底部运行控制与日志（RunControls / RunSummary / LogPanel / DialogHost）
    expect(screen.getByRole("group", { name: "运行控制" })).toBeTruthy();
    for (const name of ["预览", "开始转换", "取消", "重置"]) {
      expect(screen.getByRole("button", { name })).toHaveProperty("disabled", true);
    }
    expect(screen.getByRole("status", { name: "运行状态" }).textContent).toContain("未加载配置");
    expect(screen.getByRole("region", { name: "运行日志" })).toBeTruthy();
    expect(screen.getByRole("log", { name: "日志列表" })).toBeTruthy();
    expect(screen.getByTestId("dialog-host")).toBeTruthy();
  });

  it("shows handshake info from the shell", async () => {
    await renderAndSettle();
    expect(screen.getByText(/xresconv-gui v3\.0\.0-dev\.0 · protocol v1/)).toBeTruthy();
  });

  it("lists CLI args returned by the shell", async () => {
    await renderAndSettle();
    expect(screen.getByText(/tests\/fixtures\/config\/basic\.xml/)).toBeTruthy();
  });

  it("shows the guardian and backend handshake", async () => {
    await renderAndSettle();
    const text = screen.getByTestId("backend-health").textContent ?? "";
    expect(text).toContain("guardian ok · node v24.21.0");
    expect(text).toContain("backend ready · pid 1235 · generation 1");
  });

  it("shows an error state when the health probe fails but keeps the shell usable", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_backend_health") {
        return Promise.reject(new Error("guardian unreachable"));
      }
      return defaultInvokeImpl(cmd);
    });
    render(<App />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("guardian unreachable");
    expect(screen.getByTestId("backend-health-error")).toBeTruthy();
    // backend 失联时壳仍可显示故障并展示版本信息
    await screen.findByText(/xresconv-gui v3\.0\.0-dev\.0 · protocol v1/);
    expect(screen.getByRole("banner")).toBeTruthy();
  });

  it("keeps the empty config state when the file picker is cancelled", async () => {
    mockedOpen.mockResolvedValue(null);
    await renderAndSettle();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "选择 XML 配置…" }));
    await waitFor(() => expect(mockedOpen).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("picked-path")).toBeNull();
    expect(screen.getByText("尚未加载配置文件")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重载配置" })).toHaveProperty("disabled", true);
  });

  it("shows the picked config path and lets reload re-probe the backend", async () => {
    mockedOpen.mockResolvedValue("D:/conf/convert_list.xml");
    await renderAndSettle();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "选择 XML 配置…" }));
    const picked = await screen.findByTestId("picked-path");
    expect(picked.textContent).toBe("D:/conf/convert_list.xml");

    const reload = screen.getByRole("button", { name: "重载配置" });
    expect(reload).toHaveProperty("disabled", false);
    await user.click(reload);
    await waitFor(() => expect(invokeCallCount("get_backend_health")).toBe(2));
  });

  it("does not duplicate bridge fetches under StrictMode double-mount", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByText(/xresconv-gui v3\.0\.0-dev\.0 · protocol v1/);
    await screen.findByTestId("backend-health");
    expect(invokeCallCount("get_app_info")).toBe(1);
    expect(invokeCallCount("get_cli_matches")).toBe(1);
    expect(invokeCallCount("get_backend_health")).toBe(1);
  });
});
