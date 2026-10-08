import { type Channel, invoke } from "@tauri-apps/api/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ResourceProgress } from "../src/adapters/tauri";
import { ResourceStartup } from "../src/app/ResourceStartup";
import { resetResourceStartup } from "../src/app/resource-startup";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(),
  Channel: class {
    onmessage = (_value: unknown) => {};
  },
}));
const call = vi.mocked(invoke);
beforeEach(() => {
  call.mockReset();
  resetResourceStartup();
});

it("shows byte progress and mounts the workspace only after preparation completes", async () => {
  let finish: () => void = () => {};
  let channel: Channel<ResourceProgress> | null = null;
  call.mockImplementation((_command, args) => {
    channel = (args as { onProgress: Channel<ResourceProgress> }).onProgress;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  render(
    <StrictMode>
      <ResourceStartup>
        <p>业务界面</p>
      </ResourceStartup>
    </StrictMode>,
  );
  expect(screen.queryByText("业务界面")).toBeNull();
  await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  act(() => {
    channel?.onmessage({
      phase: "extracting",
      completedBytes: 50,
      totalBytes: 100,
      completedFiles: 2,
      totalFiles: 4,
    });
  });
  expect(screen.getByRole("progressbar", { name: "资源解压进度" }).getAttribute("value")).toBe(
    "50",
  );
  expect(screen.getByText("50% · 已完成 2 / 4 个文件")).toBeTruthy();
  act(() => finish());
  expect(await screen.findByText("业务界面")).toBeTruthy();
});

it("keeps errors visible and retries without mounting the workspace prematurely", async () => {
  call.mockRejectedValueOnce("resource cache is in use").mockResolvedValueOnce(undefined);
  render(
    <ResourceStartup>
      <p>业务界面</p>
    </ResourceStartup>,
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "应用资源准备失败：resource cache is in use",
  );
  expect(screen.queryByText("业务界面")).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByText("业务界面")).toBeTruthy();
  expect(call).toHaveBeenCalledTimes(2);
});
