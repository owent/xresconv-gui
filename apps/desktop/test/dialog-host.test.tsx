/**
 * DialogHost 测试（P4-05b，SC06/UI05 脚本弹框）。
 *
 * dialog_request → RAC Modal（title/content/buttons）；yes/no/ok/ESC 的
 * choice 语义（ok 与 ESC 都最终化为 null——BD-06 ESC 不回调缺陷不复活）；
 * dialog_invalidate 移出队列且不应答；多个弹框逐队展示；应答在途禁用按钮。
 */

import { invoke } from "@tauri-apps/api/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { DialogHost } from "../src/app/DialogHost";
import { resetSessionStore, useSessionStore } from "../src/app/session-store";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

const mockedInvoke = invoke as unknown as Mock<
  (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
>;

function pushDialogRequest(token: string, buttons = ["yes", "no"]): void {
  useSessionStore.getState().recordBackendEvent({
    kind: "event",
    payload: {
      source: "backend",
      type: "dialog_request",
      token,
      dialog: { token, title: `标题-${token}`, content: `内容-${token}`, buttons },
    },
  });
}

function pushDialogInvalidate(token: string): void {
  useSessionStore.getState().recordBackendEvent({
    kind: "event",
    payload: { source: "backend", type: "dialog_invalidate", token, reason: "worker died" },
  });
}

function respondCalls(): Record<string, unknown>[] {
  return mockedInvoke.mock.calls
    .filter(([cmd, args]) => cmd === "backend_rpc" && args?.method === "respondDialog")
    .map(([, args]) => args?.params as Record<string, unknown>);
}

describe("DialogHost（P4-05b，SC06）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "backend_rpc") {
        return Promise.resolve({ answered: true });
      }
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    });
  });

  it("无弹框时宿主为空；dialog_request 事件弹出标题/内容/是否按钮", async () => {
    render(<DialogHost />);
    expect(screen.queryByRole("dialog")).toBeNull();

    pushDialogRequest("t1");
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("标题-t1");
    expect(screen.getByText("内容-t1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "是" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "否" })).toBeTruthy();
  });

  it("yes → respondDialog {choice:yes} 并出队；no → choice:no", async () => {
    render(<DialogHost />);
    pushDialogRequest("t-yes");
    await screen.findByRole("dialog");
    await userEvent.setup().click(screen.getByRole("button", { name: "是" }));
    await waitFor(() => expect(respondCalls()).toHaveLength(1));
    expect(respondCalls()[0]).toEqual({ token: "t-yes", choice: "yes" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    pushDialogRequest("t-no");
    await screen.findByRole("dialog");
    await userEvent.setup().click(screen.getByRole("button", { name: "否" }));
    await waitFor(() => expect(respondCalls()).toHaveLength(2));
    expect(respondCalls()[1]).toEqual({ token: "t-no", choice: "no" });
  });

  it("ESC/关闭 → choice null（on_close 语义）；alert_error 的 ok 按钮同样 null", async () => {
    render(<DialogHost />);
    pushDialogRequest("t-esc");
    await screen.findByRole("dialog");
    await userEvent.setup().keyboard("{Escape}");
    await waitFor(() => expect(respondCalls()).toHaveLength(1));
    expect(respondCalls()[0]).toEqual({ token: "t-esc", choice: null });

    pushDialogRequest("t-ok", ["ok"]);
    await screen.findByRole("dialog");
    await userEvent.setup().click(screen.getByRole("button", { name: "好" }));
    await waitFor(() => expect(respondCalls()).toHaveLength(2));
    expect(respondCalls()[1]).toEqual({ token: "t-ok", choice: null });
  });

  it("dialog_invalidate 移出队列且不发 respondDialog（过期回调不执行）", async () => {
    render(<DialogHost />);
    pushDialogRequest("t-dead");
    await screen.findByRole("dialog");
    pushDialogInvalidate("t-dead");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(respondCalls()).toHaveLength(0);
  });

  it("多个弹框逐队展示：队首应答后下一个出现", async () => {
    render(<DialogHost />);
    pushDialogRequest("t-1");
    pushDialogRequest("t-2");
    const first = await screen.findByRole("dialog");
    expect(first.getAttribute("aria-label")).toBe("标题-t-1");

    await userEvent.setup().click(screen.getByRole("button", { name: "是" }));
    await waitFor(() => {
      const dialog = screen.queryByRole("dialog");
      expect(dialog?.getAttribute("aria-label")).toBe("标题-t-2");
    });
  });
});
