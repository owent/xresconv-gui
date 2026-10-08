import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.isTauri = true;
    const callbacks = new Map<number, (value: unknown) => void>();
    const calls: string[] = [];
    let callbackId = 0;
    let messageIndex = 0;
    w.__resourceCalls = calls;
    w.__TAURI_INTERNALS__ = {
      transformCallback(callback: (value: unknown) => void) {
        callbacks.set(++callbackId, callback);
        return callbackId;
      },
      unregisterCallback(id: number) { callbacks.delete(id); },
      invoke(command: string, args: { onProgress: { id: number } }) {
        calls.push(command);
        if (command !== "prepare_app_resources") return Promise.reject(`unexpected ${command}`);
        const channelId = args.onProgress.id;
        messageIndex = 0;
        w.__resourceProgress = (phase: string, completedBytes: number) => callbacks.get(channelId)?.({
          index: messageIndex++,
          message: { phase, completedBytes, totalBytes: 100, completedFiles: completedBytes === 50 ? 2 : 0, totalFiles: 4 },
        });
        return new Promise((_resolve, reject) => { w.__resourceFail = () => reject("cache file is locked"); });
      },
    };
  });
  await page.goto("/");
  await page.waitForFunction(() => typeof (window as unknown as { __resourceProgress?: unknown }).__resourceProgress === "function");
});

test("shows accessible extraction progress before any backend command", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "准备应用资源" })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __resourceProgress: (phase: string, bytes: number) => void }).__resourceProgress("extracting", 50));
  await expect(page.getByRole("progressbar", { name: "资源解压进度" })).toHaveAttribute("value", "50");
  await expect(page.getByText("50% · 已完成 2 / 4 个文件")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始转换" })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __resourceCalls: string[] }).__resourceCalls)).toEqual(["prepare_app_resources"]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("shows cleanup as indeterminate and exposes a retry after failure", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "准备应用资源" })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __resourceProgress: (phase: string, bytes: number) => void }).__resourceProgress("cleaning", 0));
  await expect(page.getByRole("status")).toHaveText("正在清理旧版本资源缓存…");
  await expect(page.getByRole("progressbar")).not.toHaveAttribute("value");
  await page.evaluate(() => (window as unknown as { __resourceFail: () => void }).__resourceFail());
  await expect(page.getByRole("alert")).toContainText("cache file is locked");
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __resourceCalls: string[] }).__resourceCalls)).toEqual(["prepare_app_resources", "prepare_app_resources"]);
});
