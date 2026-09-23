import assert from "node:assert";

describe("xresconv-gui desktop skeleton", () => {
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
        return okText.includes("backend ok");
      },
      { timeout: 30_000, timeoutMsg: "guardian/backend handshake line did not appear" },
    );
    const text = await ok.getText();
    assert.match(text, /guardian ok · node v\d+\.\d+\.\d+ · pid \d+/);
    assert.match(text, /backend ok · pid \d+ · protocol v\d+/);
  });

  it("exposes parsed CLI args to the UI", async () => {
    const section = await $('[data-testid="cli-args"]');
    await section.waitForExist({ timeout: 15_000 });
    const text = await section.getText();
    assert.match(text, /input/);
  });
});
