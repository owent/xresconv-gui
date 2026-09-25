import { defineConfig, devices } from "@playwright/test";

/**
 * 三引擎浏览器 E2E（P4-08，UI08；docs/plan/06-testing-acceptance.md 浏览器层）。
 *
 * - 目标：生产构建（`vite preview`，非开发服务器；UI08：不依赖 CDN/开发服务器）
 *   在 Chromium / WebKit / Firefox 的渲染、主题与可访问性基线。
 * - 浏览器层不替代真实桌面（WDIO Tauri WebView2 属 tests/desktop）。
 * - 浏览器安装：`PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/
 *   corepack yarn playwright install chromium webkit firefox`（国内镜像）。
 */
export default defineConfig({
  testDir: "../../tests/browser",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    // 显式绑 127.0.0.1：本机 localhost 仅解析 IPv6 时 127.0.0.1 探测会失败。
    command: "corepack yarn preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
