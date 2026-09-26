import { invoke } from "@tauri-apps/api/core";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { App } from "../src/App";
import { resetEnvironmentDiagnostics } from "../src/app/environment-diagnostics";
import { resetSessionStore } from "../src/app/session-store";

/**
 * 2026-09-26 用户反馈回归：dev 启动自动加载上次配置时，后端仍在 starting 的
 * 瞬态失败（BACKEND_NOT_READY）不得以 "guardian protocol violation" 弹在树上；
 * 应静默重试直到就绪，并在日志里给出等待提示。
 */
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

const mockedInvoke = invoke as unknown as Mock<
  (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
>;

const SNAPSHOT = {
  state: "ready",
  runSeq: 0,
  config: { path: "D:/demo/convert_list.xml" },
  tree: {
    version: 1,
    nodes: [
      {
        key: "cat:demo",
        title: "演示分类",
        tooltip: "演示分类",
        folder: true,
        unselectable: false,
        selected: false,
        partsel: false,
        expanded: true,
        autoSelect: false,
        children: [
          {
            key: 1,
            title: "role_cfg.xlsx",
            tooltip: "roles",
            folder: false,
            unselectable: false,
            selected: false,
            partsel: false,
            expanded: false,
            autoSelect: false,
            children: [],
          },
        ],
      },
    ],
  },
  selectedItems: [],
  settings: { overrides: {}, effective: null, parallelism: 2 },
};

describe("display settings bootstrap (auto-load retry)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    resetEnvironmentDiagnostics();
    document.documentElement.removeAttribute("data-theme");
  });

  it("swallows transient BACKEND_NOT_READY during auto-load and retries to success", async () => {
    let loadCalls = 0;
    let logCalls = 0;
    mockedInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "read_display_settings":
          return Promise.resolve({
            theme: "dark",
            lastConfigFile: "D:/demo/convert_list.xml",
            fonts: null,
          });
        case "write_display_settings":
          return Promise.resolve(null);
        case "get_app_info":
          return Promise.resolve({
            name: "xresconv-gui",
            version: "3.0.0-dev.0",
            protocol_version: 1,
          });
        case "get_cli_matches":
          return Promise.resolve({});
        case "get_backend_health":
          return Promise.resolve({
            ok: true,
            pid: 1,
            node: "v24.0.0",
            backend: { state: "ready", pid: 2, generation: 1 },
          });
        case "backend_rpc": {
          const method = String(args?.method);
          if (method === "loadConfig") {
            loadCalls++;
            if (loadCalls < 3) {
              return Promise.reject("BACKEND_NOT_READY: backend not ready (state: starting)");
            }
            return Promise.resolve(SNAPSHOT);
          }
          if (method === "getLogs") {
            logCalls++;
            if (logCalls < 3) {
              return Promise.reject("BACKEND_NOT_READY: backend not ready (state: starting)");
            }
            return Promise.resolve({ entries: [], droppedCount: 0, capacity: 10000 });
          }
          if (method === "checkJava") {
            return Promise.resolve({
              ok: true,
              versionText: 'openjdk version "17.0.9" 2023-10-17',
              versions: [17, 0, 9],
              bit64: true,
              executable: { command: "java", source: "path" },
              problem: null,
              downloadHints: [],
            });
          }
          return Promise.resolve(SNAPSHOT);
        }
        default:
          return Promise.reject(new Error(`unexpected command: ${cmd}`));
      }
    });

    render(<App />);

    // 瞬态错误绝不进入可见告警区（树上 alert 不出现 guardian/BACKEND 字样）。
    await waitFor(
      () => {
        const alerts = screen.queryAllByRole("alert");
        for (const alert of alerts) {
          expect(alert.textContent ?? "").not.toMatch(/BACKEND_NOT_READY|guardian/);
        }
        // 重试成功：配置路径与树条目出现。
        expect((screen.getByTestId("picked-path") as HTMLInputElement).value).toBe(
          "D:/demo/convert_list.xml",
        );
        expect(screen.getByText("role_cfg.xlsx")).toBeTruthy();
      },
      { timeout: 5000 },
    );

    // 日志无任何 BACKEND_NOT_READY 错误行。重试期的“后端启动中”提示属旧会话
    // 显示面——loadConfig 成功即被四轮新增的日志重置清掉（同首次启动）。
    const logText = screen.getByRole("log", { name: "日志列表" }).textContent ?? "";
    expect(logText).not.toContain("BACKEND_NOT_READY");

    // 主题从显示设置应用（模块级 bootstrap 不再被 StrictMode 取消）。
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(loadCalls).toBeGreaterThanOrEqual(3);
  });
});
