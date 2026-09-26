import assert from "node:assert";
import path from "node:path";
import { existsSync, writeFileSync, rmSync } from "node:fs";

/**
 * 2026-09-26 用户反馈验证：树形条目可勾选/反选、树撑满左列、文字省略、
 * 页面内容显示正常。配置经 --input 注入（CLI 参数 → loadConfig），
 * 勾选经真实 WebView 点击 → applyOps RPC → 快照回写。
 */
describe("tree selection and layout with a loaded config", () => {
  before(async () => {
    const handles = await browser.getWindowHandles();
    assert.strictEqual(handles.length, 1);
    await browser.switchToWindow(handles[0]);
  });

  it("shows the loaded tree and toggles item selection", async () => {
    // 等自动加载(--input 经 CLI 或 display-settings)完成:树节点出现。
    const firstItem = await $('[role="row"][data-key]');
    await firstItem.waitForExist({ timeout: 30_000 });

    // 原生 input 视觉隐藏(RAC):读隐藏 input 的勾选态,点击标题(span)触发切换
    // ——与用户可见交互一致(fancytree 点行切换语义)。
    const checkbox = await $('[role="row"][data-key] input[type="checkbox"]');
    await checkbox.waitForExist({ timeout: 10_000 });
    const title = await $(".tree-node-title");
    await title.waitForExist({ timeout: 10_000 });
    const before = await checkbox.isSelected();

    await browser.execute((el) => el.scrollIntoView({ block: "center" }), title);
    await title.click();

    // 快照回写后勾选态翻转(applyOps → stateChanges → 本地树更新)
    await browser.waitUntil(
      async () => (await checkbox.isSelected()) !== before,
      { timeout: 10_000, timeoutMsg: "树勾选状态未翻转" },
    );

    // 再点一次标题反选回来
    await title.click();
    await browser.waitUntil(
      async () => (await checkbox.isSelected()) === before,
      { timeout: 10_000, timeoutMsg: "树反选状态未恢复" },
    );
  });

  it("tree panel fills the left column and titles ellipsize instead of wrapping", async () => {
    const tree = await $('[aria-label="转换列表"]');
    assert.ok(await tree.isDisplayed());
    const box = await tree.getSize();
    assert.ok(box.height > 200, `tree panel height=${String(box.height)}`);

    // 标题不换行:所有标题元素的 scrollHeight 不超过 1.6 行
    const wraps = await browser.execute(() => {
      const titles = [...document.querySelectorAll(".tree-node-title")];
      return titles.filter((el) => el.scrollHeight > Math.ceil(el.clientHeight * 1.6)).length;
    });
    assert.strictEqual(wraps, 0, "存在换行的树标题");
  });

  it("page content renders: config path, state, buttons", async () => {
    const pathInput = await $('[data-testid="picked-path"]');
    const value = await pathInput.getValue();
    assert.ok(String(value).length > 0, `config path=${String(value)}`);

    const status = await $('[aria-label="运行状态"]');
    const text = await status.getText();
    assert.match(text, /状态|已完成|就绪/, `run state=${text}`);

    for (const name of ["开始转换", "重置", "全部选中"]) {
      const button = await $(`button=${name}`);
      assert.ok(await button.isDisplayed(), `${name} should be visible`);
    }
  });
});
