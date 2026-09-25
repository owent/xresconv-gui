/**
 * HookControls 测试（P4-05b，UI05 hook checked/mutable；F09）。
 *
 * 命名 hook 渲染复选框（匿名不渲染）、mutable=false 禁用、切换经
 * setHookEnabled RPC 生效并就地回写快照；RPC 失败进 store.lastError。
 */

import { invoke } from "@tauri-apps/api/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { BackendSnapshot } from "../src/adapters/backend";
import { HookControls } from "../src/app/HookControls";
import { resetSessionStore, useSessionStore } from "../src/app/session-store";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

const mockedInvoke = invoke as unknown as Mock<
  (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
>;

interface HookSpec {
  enabled: boolean;
  toggle?: { name: string; checked: boolean; mutable: boolean };
}

function makeSnapshot(gui: Record<string, HookSpec[]> | null): BackendSnapshot {
  return {
    state: "ready",
    runSeq: 0,
    config: gui === null ? { path: "D:/conf/c.xml" } : { path: "D:/conf/c.xml", gui },
    tree: null,
    selectedItems: [],
    settings: { overrides: {}, effective: null, parallelism: 2 },
    customSelectors: null,
  };
}

const NAMED_HOOKS: Record<string, HookSpec[]> = {
  onBeforeConvert: [
    { enabled: true, toggle: { name: "前置可关", checked: true, mutable: true } },
    { enabled: true, toggle: { name: "前置锁定", checked: true, mutable: false } },
  ],
  onAfterConvert: [{ enabled: true }],
  onAppendLog: [{ enabled: false, toggle: { name: "日志可关", checked: false, mutable: true } }],
};

function loadSnapshot(snapshot: BackendSnapshot): void {
  act(() => useSessionStore.setState({ snapshot, configPath: "D:/conf/c.xml", connection: "ok" }));
}

function setHookEnabledCalls(): Record<string, unknown>[] {
  return mockedInvoke.mock.calls
    .filter(([cmd, args]) => cmd === "backend_rpc" && args?.method === "setHookEnabled")
    .map(([, args]) => args?.params as Record<string, unknown>);
}

describe("HookControls（P4-05b）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
  });

  it("未加载配置 → 空态提示；配置无命名 hook → 无开关提示", () => {
    render(<HookControls />);
    expect(screen.getByText("加载配置后在此显示可开关的转换事件。")).toBeTruthy();

    act(() =>
      useSessionStore.setState({
        snapshot: makeSnapshot({
          onBeforeConvert: [{ enabled: true }],
          onAfterConvert: [],
          onAppendLog: [],
        }),
      }),
    );
    expect(screen.getByText("当前配置没有可开关的命名事件。")).toBeTruthy();
  });

  it("命名 hook 按组渲染（匿名不渲染）；mutable=false 禁用", () => {
    loadSnapshot(makeSnapshot(NAMED_HOOKS));
    render(<HookControls />);

    const mutableBox = screen.getByRole("checkbox", { name: "前置可关" });
    expect(mutableBox).toHaveProperty("disabled", false);
    expect(mutableBox).toHaveProperty("checked", true);

    const lockedBox = screen.getByRole("checkbox", { name: "前置锁定" });
    expect(lockedBox).toHaveProperty("disabled", true);

    const logBox = screen.getByRole("checkbox", { name: "日志可关" });
    expect(logBox).toHaveProperty("checked", false);

    // 匿名 onAfterConvert[0] 不渲染复选框
    expect(screen.queryByRole("checkbox", { name: /on_after/ })).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    // 组标签可见
    expect(screen.getByText("转表前事件（on_before_convert）")).toBeTruthy();
    expect(screen.getByText("日志事件（on_append_log）")).toBeTruthy();
  });

  it("切换命名 hook → setHookEnabled RPC（group/index/enabled），成功就地回写快照", async () => {
    loadSnapshot(makeSnapshot(NAMED_HOOKS));
    mockedInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "backend_rpc" && args?.method === "setHookEnabled") {
        return Promise.resolve({ enabled: (args.params as { enabled: boolean }).enabled });
      }
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
    render(<HookControls />);

    await userEvent.setup().click(screen.getByRole("checkbox", { name: "前置可关" }));
    await waitFor(() => expect(setHookEnabledCalls()).toHaveLength(1));
    expect(setHookEnabledCalls()[0]).toEqual({ group: "before", index: 0, enabled: false });

    // 快照就地回写：enabled=false
    const gui = useSessionStore.getState().snapshot?.config?.gui as {
      onBeforeConvert: { enabled: boolean }[];
    };
    expect(gui.onBeforeConvert[0]?.enabled).toBe(false);
    // 复选框反映新状态
    expect(screen.getByRole("checkbox", { name: "前置可关" })).toHaveProperty("checked", false);

    // append_log 组 index 语义
    await userEvent.setup().click(screen.getByRole("checkbox", { name: "日志可关" }));
    await waitFor(() => expect(setHookEnabledCalls()).toHaveLength(2));
    expect(setHookEnabledCalls()[1]).toEqual({ group: "append_log", index: 0, enabled: true });
  });

  it("RPC 失败（如 immutable/越界竞态）→ lastError 可见，快照不改写", async () => {
    loadSnapshot(makeSnapshot(NAMED_HOOKS));
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "backend_rpc") {
        return Promise.reject("INVALID_PARAMS: hook before[0] is immutable");
      }
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
    render(<HookControls />);

    await userEvent.setup().click(screen.getByRole("checkbox", { name: "前置可关" }));
    await waitFor(() => expect(useSessionStore.getState().lastError).toContain("INVALID_PARAMS"));
    const gui = useSessionStore.getState().snapshot?.config?.gui as {
      onBeforeConvert: { enabled: boolean }[];
    };
    expect(gui.onBeforeConvert[0]?.enabled).toBe(true);
  });
});
