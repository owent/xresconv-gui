import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * 浏览器层 E2E（P4-08，UI08）：生产构建在三引擎的骨架渲染、明暗主题与
 * 可访问性基线。浏览器无 Tauri 桥接（isTauri=false）：适配层按设计降级
 * （事件空订阅、桥接探测失败可见），不得抛未捕获异常或白屏。
 */

/** 无桥接环境的预期降级噪声（listen/invoke 在纯浏览器中失败并被适配层捕获）。 */
const EXPECTED_DEGRADE = /__TAURI|tauri|invoke|listen/i;

test.beforeEach(async ({ page }) => {
  const unexpectedErrors: string[] = [];
  page.on("pageerror", (error) => unexpectedErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Firefox 对对象参数（适配层 .catch(console.error) 的降级 Error 对象）的
    // text() 为 "JSHandle@object"；真实未捕获异常由 pageerror 覆盖。
    if (/^JSHandle@/.test(text) || EXPECTED_DEGRADE.test(text)) return;
    unexpectedErrors.push(`console.error: ${text}`);
  });
  // 供 afterEach 断言（闭包持有）。
  (page as Page & { __unexpectedErrors?: string[] }).__unexpectedErrors = unexpectedErrors;
  await page.goto("/");
});

test.afterEach(async ({ page }) => {
  const errors = (page as Page & { __unexpectedErrors?: string[] }).__unexpectedErrors ?? [];
  expect(errors, `unexpected errors: ${errors.join(" | ")}`).toEqual([]);
});

test("UI08-1 骨架渲染：全部主区域可见，无白屏/未捕获异常", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "转换列表" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "运行日志" })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始转换" })).toBeVisible();
  await expect(page.getByRole("button", { name: "预览" })).toBeVisible();
  // 空态可读（未加载配置），非崩溃页。
  await expect(page.getByText("尚未加载配置；加载后在此显示")).toBeVisible();
  // 无桥接降级：环境状态区域仍渲染（不假装后端在线）。
  await expect(page.getByRole("status").or(page.getByText(/环境|后端/)).first()).toBeVisible();
});

test("UI08-2 明暗主题：prefers-color-scheme 切换令牌", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  const lightBg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(),
  );
  await page.emulateMedia({ colorScheme: "dark" });
  const darkBg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(),
  );
  expect(lightBg, "亮色主题令牌").not.toBe("");
  expect(darkBg, "暗色主题令牌").not.toBe("");
  expect(lightBg, "明暗主题令牌必须不同").not.toBe(darkBg);
  // color-scheme 元数据生效（滚动条/表单控件随主题）。
  const scheme = await page.evaluate(() =>
    getComputedStyle(document.documentElement).colorScheme,
  );
  expect(scheme).toContain("dark");
});

test("UI08-3 无外部资源依赖：页面只加载同源资源（不依赖 CDN）", async ({ page }) => {
  const sources: string[] = [];
  page.on("request", (request) => sources.push(request.url()));
  await page.reload();
  await expect(page.getByRole("heading", { name: "转换列表" })).toBeVisible();
  const foreign = sources.filter(
    (url) => !url.startsWith("http://127.0.0.1:4173") && !url.startsWith("data:"),
  );
  expect(foreign, `外部资源请求: ${foreign.join(" | ")}`).toEqual([]);
});

test("UI08-4 可访问性基线：axe 无 serious/critical 违规", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "转换列表" })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag21a", "wcag2aa"])
    .analyze();
  const blocking = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(
    blocking.map((violation) => `${violation.id}: ${violation.nodes.length}`),
    JSON.stringify(
      blocking.map((violation) => ({
        id: violation.id,
        help: violation.help,
        target: violation.nodes[0]?.target,
      })),
      null,
      1,
    ),
  ).toEqual([]);
});

test("UI08-5 高 DPI 与窄窗口：布局不崩溃（200% 缩放、小视口）", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await expect(page.getByRole("heading", { name: "转换列表" })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始转换" })).toBeVisible();
  // 主区域无横向溢出导致的整页滚动（面板内滚动属预期）。
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
});
