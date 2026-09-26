import assert from "node:assert";


const withEmptyState = process.env.XRESCONV_E2E_INPUT ? describe.skip : describe;

/** 运行日志聚合文本（.log-row 行拼接）。
 *  经 browser.execute 在页面内读取：WebdriverIO 的 $$ 在 WebKitGTK 驱动下
 *  返回不可迭代对象（CI 实证 "object is not iterable"），execute 对所有驱动一致。 */
async function logText() {
  return browser.execute(() =>
    Array.from(document.querySelectorAll(".log-row"))
      .map((row) => row.textContent ?? "")
      .join("\n"),
  );
}

withEmptyState("xresconv-gui desktop skeleton", () => {
  before(async () => {
    // Explicit window selection uses the external WebDriver protocol and keeps
    // the service from probing the optional in-app focus plugin before each command.
    const handles = await browser.getWindowHandles();
    assert.strictEqual(handles.length, 1);
    await browser.switchToWindow(handles[0]);
  });
  it("creates the main window with the app title", async () => {
    const title = await browser.getTitle();
    assert.strictEqual(title, "xresconv-gui");
  });

  // 2026-09-26 三轮改版：顶部状态条移除，环境/版本/Java 调试信息进运行日志
  // （[GUI] 前缀本地行）；握手断言改为读日志聚合文本。
  it("completes the shell -> guardian -> backend handshake in the real webview", async () => {
    await browser.waitUntil(
      async () => {
        const text = await logText();
        return text.includes("guardian ok · node v") && text.includes("backend ready · pid ");
      },
      { timeout: 30_000, timeoutMsg: "guardian/backend handshake log line did not appear" },
    );
    const text = await logText();
    assert.match(text, /guardian ok · node v\d+\.\d+\.\d+ · pid \d+/);
    assert.match(text, /backend ready · pid \d+ · generation \d+/);
  });

  it("logs the app version and java environment into the run log", async () => {
    await browser.waitUntil(
      async () => {
        const text = await logText();
        return /xresconv-gui v\S+ · protocol v\d+/.test(text) && text.includes("Java 环境：");
      },
      { timeout: 30_000, timeoutMsg: "version/java diagnostics log lines did not appear" },
    );
    // 状态条/横幅不再存在（调试信息只在日志里）。
    assert.ok(!(await $('[data-testid="backend-health"]').isExisting()));
    assert.ok(!(await $('[data-testid="cli-args"]').isExisting()));
  });
});
