/**
 * CustomActionBar 测试（P4-05b，UI05 按钮链；F04/F05）。
 *
 * 快照 customSelectors 渲染按钮；错误条目不渲染（旧版仅记日志）；样式
 * 白名单映射与缺省回退（main.js:775-792，B6 不复活）；点击经
 * invokeCustomButton RPC 并随后重同步快照；{ok:false} 进 lastError。
 */

import { invoke } from "@tauri-apps/api/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { BackendSnapshot, CustomSelectorViewLike } from "../src/adapters/backend";
import { CustomActionBar } from "../src/app/CustomActionBar";
import { resetSessionStore, useSessionStore } from "../src/app/session-store";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

const mockedInvoke = invoke as unknown as Mock<
  (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
>;

function makeSnapshot(customSelectors: CustomSelectorViewLike[] | null): BackendSnapshot {
  return {
    state: "ready",
    runSeq: 0,
    config: { path: "D:/conf/c.xml" },
    tree: null,
    selectedItems: [],
    settings: { overrides: {}, effective: null, parallelism: 2 },
    customSelectors,
  };
}

const SELECTORS: CustomSelectorViewLike[] = [
  { name: "proto选择", hasAction: false, defaultSelected: true, style: null },
  { name: "计数按钮", hasAction: true, defaultSelected: false, style: "outline-danger" },
  { name: "脏样式", hasAction: true, defaultSelected: false, style: "btn-evil" },
  { name: null, error: "自定义选择器 空规则 的规则无效" },
];

function rpcCalls(method: string): Record<string, unknown>[] {
  return mockedInvoke.mock.calls
    .filter(([cmd, args]) => cmd === "backend_rpc" && args?.method === method)
    .map(([, args]) => args?.params as Record<string, unknown>);
}

describe("CustomActionBar（P4-05b）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
  });

  it("自适应：未设置选择器/空数组 → 整个区域不渲染（2026-09-26 用户需求）", () => {
    const view = render(<CustomActionBar />);
    expect(view.container.firstChild).toBeNull();

    act(() => useSessionStore.setState({ snapshot: makeSnapshot([]) }));
    expect(view.container.firstChild).toBeNull();
  });

  it("渲染命名条目为按钮；错误条目不渲染；样式白名单映射与缺省回退", () => {
    act(() => useSessionStore.setState({ snapshot: makeSnapshot(SELECTORS) }));
    render(<CustomActionBar />);

    const selector = screen.getByRole("button", { name: "proto选择" });
    // 无 action + 无 style → outline-secondary 缺省
    expect(selector.className).toContain("custom-btn--outline-secondary");

    const actionBtn = screen.getByRole("button", { name: "计数按钮" });
    // 白名单内 style 原样映射
    expect(actionBtn.className).toContain("custom-btn--outline-danger");

    const dirty = screen.getByRole("button", { name: "脏样式" });
    // 未知 style 不进 class（B6 不复活），按有 action 回退 outline-dark
    expect(dirty.className).toContain("custom-btn--outline-dark");
    expect(dirty.className).not.toContain("btn-evil");

    // 错误条目不渲染按钮
    expect(screen.queryByRole("button", { name: /空规则/ })).toBeNull();
  });

  it("点击按钮 → invokeCustomButton RPC + 重同步快照；ok:false 写 lastError", async () => {
    act(() => useSessionStore.setState({ snapshot: makeSnapshot(SELECTORS), connection: "ok" }));
    mockedInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "backend_rpc" && args?.method === "invokeCustomButton") {
        return Promise.resolve({ ok: true });
      }
      if (cmd === "backend_rpc" && args?.method === "getSnapshot") {
        return Promise.resolve(makeSnapshot(SELECTORS));
      }
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
    render(<CustomActionBar />);

    await userEvent.setup().click(screen.getByRole("button", { name: "计数按钮" }));
    await waitFor(() => expect(rpcCalls("invokeCustomButton")).toHaveLength(1));
    expect(rpcCalls("invokeCustomButton")[0]).toEqual({ name: "计数按钮" });
    // 按钮动作在 backend 改树：点击后重同步
    await waitFor(() => expect(rpcCalls("getSnapshot")).toHaveLength(1));
    expect(useSessionStore.getState().lastError).toBeNull();

    // 链失败：ok:false → lastError 可见
    mockedInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "backend_rpc" && args?.method === "invokeCustomButton") {
        return Promise.resolve({ ok: false, error: "script missing not found." });
      }
      if (cmd === "backend_rpc" && args?.method === "getSnapshot") {
        return Promise.resolve(makeSnapshot(SELECTORS));
      }
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
    await userEvent.setup().click(screen.getByRole("button", { name: "proto选择" }));
    await waitFor(() =>
      expect(useSessionStore.getState().lastError).toBe("script missing not found."),
    );
  });
});
