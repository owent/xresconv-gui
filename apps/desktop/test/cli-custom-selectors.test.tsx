/**
 * CLI 自定义选择器接线测试（P4-05b，F11）。
 *
 * collectCustomSelectorFiles：--custom-selector/--custom-button 值形态归一
 * （string | string[] | 缺失/非法过滤）；useCliCustomSelectors：启动时一次性
 * setCustomSelectors（模块闸防 StrictMode 双挂载重复），空列表不发 RPC。
 */

import { invoke } from "@tauri-apps/api/core";
import { render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { resetSessionStore, useSessionStore } from "../src/app/session-store";
import {
  collectCustomSelectorFiles,
  resetCliCustomSelectorsWiring,
  useCliCustomSelectors,
} from "../src/app/use-cli-custom-selectors";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

const mockedInvoke = invoke as unknown as Mock<
  (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
>;

function Probe() {
  useCliCustomSelectors();
  return null;
}

function setCustomSelectorsCalls(): Record<string, unknown>[] {
  return mockedInvoke.mock.calls
    .filter(([cmd, args]) => cmd === "backend_rpc" && args?.method === "setCustomSelectors")
    .map(([, args]) => args?.params as Record<string, unknown>);
}

describe("collectCustomSelectorFiles", () => {
  it("归一 string/string[]/缺失/非法值；custom-selector 与 custom-button 合并", () => {
    expect(collectCustomSelectorFiles({})).toEqual([]);
    expect(
      collectCustomSelectorFiles({
        "custom-selector": { value: "a.json" },
        "custom-button": { value: ["b.json", "c.json"] },
      }),
    ).toEqual(["a.json", "b.json", "c.json"]);
    // 非法形态（null/数字/混入非字符串）全部过滤
    expect(
      collectCustomSelectorFiles({
        "custom-selector": { value: null },
        "custom-button": { value: ["x.json", 42, null] },
        input: { value: "conf.xml" },
      }),
    ).toEqual(["x.json"]);
  });
});

describe("useCliCustomSelectors（P4-05b）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    resetCliCustomSelectorsWiring();
  });

  it("有 CLI 选择器文件 → 一次性 setCustomSelectors（StrictMode 双挂载不重复）", async () => {
    mockedInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_cli_matches") {
        return Promise.resolve({
          "custom-selector": { value: ["s1.json", "s2.json"] },
          "custom-button": { value: "b.json" },
        });
      }
      if (cmd === "backend_rpc" && args?.method === "setCustomSelectors") {
        return Promise.resolve({ selectors: [] });
      }
      if (cmd === "backend_rpc" && args?.method === "getSnapshot") {
        return Promise.reject("INVALID_STATE: no config");
      }
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    await waitFor(() => expect(setCustomSelectorsCalls()).toHaveLength(1));
    expect(setCustomSelectorsCalls()[0]).toEqual({ files: ["s1.json", "s2.json", "b.json"] });
  });

  it("无 CLI 选择器文件 → 不发 setCustomSelectors", async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_cli_matches") {
        return Promise.resolve({ input: { value: "conf.xml" } });
      }
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
    render(<Probe />);
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalled());
    expect(setCustomSelectorsCalls()).toHaveLength(0);
    expect(useSessionStore.getState().lastError).toBeNull();
  });

  it("setCustomSelectors 失败 → lastError 可见", async () => {
    mockedInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "get_cli_matches") {
        return Promise.resolve({ "custom-selector": { value: "missing.json" } });
      }
      if (cmd === "backend_rpc" && args?.method === "setCustomSelectors") {
        return Promise.reject("BACKEND_NOT_READY: no ready backend");
      }
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
    render(<Probe />);
    await waitFor(() =>
      expect(useSessionStore.getState().lastError).toContain("BACKEND_NOT_READY"),
    );
  });
});
