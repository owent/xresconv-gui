import assert from "node:assert";


const withEmptyState = process.env.XRESCONV_E2E_INPUT ? describe.skip : describe;

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
        const rows = await $$(".log-row");
        const text = (
          await Promise.all(rows.map((row) => row.getText()))
        ).join("\n");
        return text.includes("guardian ok · node v") && text.includes("backend ready · pid ");
      },
      { timeout: 30_000, timeoutMsg: "guardian/backend handshake log line did not appear" },
    );
    const rows = await $$(".log-row");
    const text = (await Promise.all(rows.map((row) => row.getText()))).join("\n");
    assert.match(text, /guardian ok · node v\d+\.\d+\.\d+ · pid \d+/);
    assert.match(text, /backend ready · pid \d+ · generation \d+/);
  });

  it("logs the app version and java environment into the run log", async () => {
    await browser.waitUntil(
      async () => {
        const rows = await $$(".log-row");
        const text = (await Promise.all(rows.map((row) => row.getText()))).join("\n");
        return /xresconv-gui v\S+ · protocol v\d+/.test(text) && text.includes("Java 环境：");
      },
      { timeout: 30_000, timeoutMsg: "version/java diagnostics log lines did not appear" },
    );
    // 状态条/横幅不再存在（调试信息只在日志里）。
    assert.ok(!(await $('[data-testid="backend-health"]').isExisting()));
    assert.ok(!(await $('[data-testid="cli-args"]').isExisting()));
  });
});
