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

  it("completes the shell -> guardian -> backend handshake in the real webview", async () => {
    const ok = await $('[data-testid="backend-health"]');
    const err = await $('[data-testid="backend-health-error"]');
    await browser.waitUntil(
      async () => {
        const okText = (await ok.isExisting()) ? await ok.getText() : "";
        const errText = (await err.isExisting()) ? await err.getText() : "";
        if (errText && errText !== "checking…") {
          throw new Error(`guardian handshake failed in app: ${errText}`);
        }
        return okText.includes("backend ready");
      },
      { timeout: 30_000, timeoutMsg: "guardian/backend handshake line did not appear" },
    );
    const text = await ok.getText();
    assert.match(text, /guardian ok · node v\d+\.\d+\.\d+ · pid \d+/);
    assert.match(text, /backend ready · pid \d+ · generation \d+/);
  });

  it("exposes parsed CLI args to the UI", async () => {
    const section = await $('[data-testid="cli-args"]');
    await section.waitForExist({ timeout: 15_000 });
    await section.$("summary").click();
    const text = await section.getText();
    assert.match(text, /input/);
  });
});
