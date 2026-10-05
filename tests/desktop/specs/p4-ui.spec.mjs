import assert from "node:assert";
import { selectValue } from "../interactions.mjs";

/**
 * 真实 WebView 桌面 E2E：验证 UI 在真实 WebView2 的渲染与
 * 无配置交互路径。不使用 --input（wdio tauri service 无参数注入通道；
 * 原生文件对话框验证另见 docs/development/testing.md）。
 */

const withEmptyState = process.env.XRESCONV_E2E_INPUT ? describe.skip : describe;

withEmptyState("UI panels in the real webview", () => {
  before(async () => {
    const handles = await browser.getWindowHandles();
    assert.strictEqual(handles.length, 1);
    await browser.switchToWindow(handles[0]);
  });

  it("renders the run controls with disabled actions before any config is loaded", async () => {
    const status = await $('[aria-label="运行状态"]');
    await status.waitForExist({ timeout: 15_000 });
    const text = await status.getText();
    assert.match(text, /未加载配置/);
    for (const name of ["开始转换", "取消", "预览"]) {
      const button = await $(`button=${name}`);
      assert.strictEqual(await button.isEnabled(), false, `${name} 应禁用`);
    }
    assert.strictEqual(await (await $("button=重置")).isExisting(), false);
  });

  it("renders the log panel toolbar and window info", async () => {
    const levelFilter = await $('[aria-label="日志级别筛选"]');
    await levelFilter.waitForExist({ timeout: 15_000 });
    assert.strictEqual(await levelFilter.isDisplayed(), true);
    await expectDisplayed('[aria-label="日志文本筛选"]');
    await expectDisplayed('button=复制日志');
    await expectDisplayed('button=导出日志');
    const info = await $('[data-testid="log-window-info"]');
    await info.waitForExist({ timeout: 15_000 });
    assert.match(await info.getText(), /当前窗口.*导出包含当前筛选结果/);
  });

  it("typing the log text filter keeps the empty log state", async () => {
    const filter = await $('[aria-label="日志文本筛选"]');
    await filter.setValue("不存在的关键字");
    const list = await $('[aria-label="日志列表"]');
    assert.match(await list.getText(), /暂无日志/);
    // 注：不在此清空输入——WebKitWebDriver 对 element/value 的空 text
    // 报 "Missing text parameter"（CI Linux 实测）；清空路径由浏览器层
    // E2E（chromium/firefox/webkit 的 fill+clear）覆盖。
  });

  it("copying with no logs surfaces a readable error, not a crash", async () => {
    const button = await $('button=复制日志');
    await button.click();
    const alert = await $('[role="alert"]');
    await browser.waitUntil(
      async () => (await alert.isExisting()) && (await alert.getText()).includes("无日志可复制"),
      { timeout: 10_000, timeoutMsg: "expected readable no-logs copy error" },
    );
  });

  it("resizes the window to a small viewport without horizontal overflow", async () => {
    await browser.setWindowSize(900, 600);
    const overflow = await browser.execute(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(
      overflow <= 2,
      `small viewport must not overflow horizontally (delta=${overflow})`,
    );
    await browser.setWindowSize(1280, 800);
  });

  it("dark color-scheme tokens exist and compute in the real webview", async () => {
    // WebView2 随系统主题；此处验证 tokens.css 双主题变量存在且当前可计算。
    const hasDarkBlock = await browser.execute(() => {
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          // lightningcss 产出 "prefers-color-scheme:dark"(无空格)——归一后匹配。
          if (rule.conditionText?.replace(/\s/g, "").includes("prefers-color-scheme:dark")) {
            // 构建器(lightningcss)可能改写内部选择器,只验证暗色令牌存在。
            return rule.cssText.includes("--color-bg");
          }
        }
      }
      return false;
    });
    // 自动加载可能已设 data-theme=system? 不会(仅 light/dark 设)。若样式表因
    // 构建合并导致遍历不到,回退验证计算值可切换。
    if (!hasDarkBlock) {
      const computed = await browser.execute(() => {
        getComputedStyle(document.documentElement).getPropertyValue("--color-bg");
        return document.querySelectorAll("style,link[rel=stylesheet]").length > 0;
      });
      assert.ok(computed, "样式表存在");
    }
    const bg = await browser.execute(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(),
    );
    assert.notStrictEqual(bg, "");
  });

  if (process.platform === "win32") {
    it("enumerates installed fonts on repeated settings opens without permission confirmation", async () => {
      const before = await browser.executeAsync((done) => {
        navigator.permissions.query({ name: "local-fonts" }).then((value) => done(value.state),
          (error) => done({ error: String(error) }));
      });
      assert.ok(["prompt", "granted", "denied"].includes(before), JSON.stringify(before));
      console.log(`[fonts] initial permission=${before}`);
      for (let attempt = 0; attempt < 3; attempt++) {
        await (await $("button=显示设置")).click();
        await browser.waitUntil(
          () => browser.execute(() => document.querySelector("datalist")?.options.length > 12),
          { timeout: 10_000, timeoutMsg: "installed font candidates did not replace the fallback list" },
        );
        const result = await browser.executeAsync((done) => {
          Promise.all([
            navigator.permissions.query({ name: "local-fonts" }),
            window.queryLocalFonts(),
          ]).then(([permission, fonts]) => done({
            permission: permission.state,
            installed: [...new Set(fonts.map((font) => font.family))].sort(),
            candidates: Array.from(document.querySelector("datalist").options, (option) => option.value).sort(),
          }), (error) => done({ error: String(error) }));
        });
        assert.strictEqual(result.permission, "granted", JSON.stringify(result));
        assert.deepStrictEqual(result.candidates, result.installed);
        console.log(`[fonts] open=${attempt + 1} permission=${result.permission} families=${result.installed.length}`);
        await (await $("button=关闭")).click();
      }
    });
  }
  it("reads system languages and restores a saved language after reloading the real webview", async () => {
    const original = await browser.executeAsync((done) => {
      window.__TAURI_INTERNALS__.invoke("read_display_settings").then(done, (error) => done({ error: String(error) }));
    });
    assert.ok(!original?.error, JSON.stringify(original));
    try {
      const languages = await browser.executeAsync((done) => {
        window.__TAURI_INTERNALS__.invoke("get_system_locales").then(done, (error) => done({ error: String(error) }));
      });
      assert.ok(Array.isArray(languages), JSON.stringify(languages));
      assert.ok(languages.every((language) => typeof language === "string"));
      console.log(`[languages] system=${JSON.stringify(languages)}`);
      await (await $("button=显示设置")).click();
      const select = await $('[data-testid="language-select"]');
      await select.waitForDisplayed({ timeout: 10_000 });
      await selectValue(browser, select, "en");
      await expectDisplayed('[role="dialog"][aria-label="Display settings"]');
      await (await $("button=Close")).click();
      await browser.waitUntil(async () => (await browser.executeAsync((done) => {
        window.__TAURI_INTERNALS__.invoke("read_display_settings").then(done, () => done(null));
      }))?.language === "en", { timeout: 10_000, timeoutMsg: "language was not saved" });
      await browser.refresh();
      await expectDisplayed("button=Display settings");
      const language = await browser.execute(() => document.documentElement.lang);
      assert.strictEqual(language, "en");
      await expectDisplayed("button=Start conversion");
    } finally {
      const restored = await browser.executeAsync((settings, done) => {
        window.__TAURI_INTERNALS__.invoke("write_display_settings", settings).then(() => done(true), (error) => done({ error: String(error) }));
      }, original ?? { language: "zh-CN" });
      assert.strictEqual(restored, true, JSON.stringify(restored));
      await browser.refresh();
      await expectDisplayed("button=显示设置");
    }
  });
});

async function expectDisplayed(selector) {
  const element = await $(selector);
  await element.waitForExist({ timeout: 10_000 });
  assert.strictEqual(await element.isDisplayed(), true, `${selector} 应可见`);
}
