import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.isTauri = true;
    const callbacks = new Map<number, (value: unknown) => void>();
    let callbackId = 0;
    let eventHandler = 0;
    w.__showScriptDialog = () => callbacks.get(eventHandler)?.({ event: "xresconv-event", id: eventHandler, payload: { kind: "event", payload: { type: "dialog_request", token: "browser-dialog", dialog: { title: "确认转换", content: "准备转换所选配置。是否继续？", buttons: ["yes", "no"] } } } });
    let settings: unknown = null;
    const nodes = Array.from({ length: 36 }, (_, index) => ({
      key: index + 1, title: ["道具配置", "角色成长", "关卡数据", "任务奖励"][index % 4] + ` ${index + 1}`,
      tooltip: `策划配置表 ${index + 1}，包含说明和来源文件`, folder: false, unselectable: index === 3,
      selected: index < 2, partsel: false, expanded: false, autoSelect: false, children: [],
      item: { id: index + 1, name: `配置 ${index + 1}`, file: "配置数据.xlsx", scheme: "Sheet1", desc: "用于服务端和客户端的共享配置", tags: ["server"], classes: [] },
    }));
    const snapshot = {
      state: "ready", runSeq: 0, config: { path: "D:/项目/游戏配置/资源与表格/xresconv.xml", gui: { onBeforeConvert: [{ enabled: true, toggle: { name: "转换前校验", checked: true, mutable: true } }], onAfterConvert: [{ enabled: true, toggle: { name: "生成完成报告", checked: true, mutable: false } }], onAppendLog: [] } },
      tree: { version: 1, nodes: [{ key: "cat:1", title: "游戏基础数据", tooltip: "转换条目", folder: true, unselectable: false, selected: false, partsel: true, expanded: true, autoSelect: false, children: nodes }] },
      selectedItems: nodes.filter((node) => node.selected).map((node) => node.item),
      settings: { overrides: {}, parallelism: 2, effective: { workDir: "D:/项目/游戏配置", xresloaderPath: "tools/xresloader.jar", proto: "protobuf", dataVersion: "2026.09.27", outputDir: "output", rename: "", type: "bin", protoFile: ["config.pb"], dataSrcDir: ["ExcelTables", "补充数据"], matrix: [{ type: "bin", tags: ["server"], classes: [], outputDir: "output/server" }, { type: "json", tags: ["client"], classes: [], outputDir: "output/client" }] } },
      customSelectors: [{ name: "服务端配置", description: "选择服务端条目", valid: true }, { name: "客户端配置", description: "选择客户端条目", valid: true }],
      hooks: { before: [], after: [], append_log: [] },
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      transformCallback(callback: (value: unknown) => void) { callbacks.set(++callbackId, callback); return callbackId; },
      unregisterCallback(id: number) { callbacks.delete(id); },
      async invoke(command: string, args: Record<string, unknown> = {}) {
        if (command === "get_cli_matches") return { input: { value: snapshot.config.path } };
        if (command === "read_display_settings") return settings;
        if (command === "write_display_settings") { settings = args; return; }
        if (command === "get_app_info") return { name: "xresconv-gui", version: "3.0.0-dev.1", protocol_version: 1 };
        if (command === "get_backend_health") return { ok: true, node: "v24.21.0", backend: { state: "ready", generation: 1 } };
        if (command === "plugin:event|listen") { if (args.event === "xresconv-event") eventHandler = Number(args.handler); return args.handler; }
        if (command === "plugin:event|unlisten") return;
        if (command === "backend_rpc") {
          const params = (args.params ?? {}) as Record<string, unknown>;
          switch (args.method) {
            case "respondDialog": return;
            case "loadConfig": case "getSnapshot": return structuredClone(snapshot);
            case "getLogs": return { entries: [], capacity: 10000, droppedCount: 0 };
            case "checkJava": return { ok: true, versionText: 'openjdk version "24.0.1"', versions: [24, 0, 1], bit64: true, executable: { command: "java", source: "path" }, problem: null, downloadHints: [] };
            case "updateSettings": Object.assign(snapshot.settings.effective, params.fields); return structuredClone(snapshot.settings);
            case "applyOps": {
              const ops = params.ops as { op: string; key?: number; selected?: boolean }[];
              w.__selectionCalls = Number(w.__selectionCalls ?? 0) + 1;
              for (const op of ops) for (const node of nodes) {
                if (!node.unselectable && (op.op === "select_all" || op.op === "select_none" || node.key === op.key)) node.selected = op.op === "select_all" || (op.op !== "select_none" && op.selected === true);
              }
              snapshot.selectedItems = nodes.filter((node) => node.selected).map((node) => node.item);
              snapshot.tree.version++;
              return { applied: ops.length, rejected: [], diagnostics: [], version: snapshot.tree.version, stateChanges: nodes.map((node) => ({ key: node.key, selected: node.selected, partsel: false, expanded: false })) };
            }
            case "preview": return { selectionCount: 2, conflicts: [], plan: { workDir: "D:/项目/游戏配置", xresloaderPath: "tools/xresloader.jar", taskCount: 2, tasks: [{ display: "\u001b[32m转换任务：\u001b[0m" + "非常长的来源文件名称.xlsx / 内容字段 / ".repeat(24) + "\n第二行任务参数", itemKey: "1" }] } };
          }
        }
        throw new Error(`unhandled browser test bridge command ${command}/${args.method ?? ""}`);
      },
    };
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "详情…" })).toBeEnabled();
});

test("工作区、详情、主题和换行日志可用", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByText("道具配置 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重置" })).toHaveCount(0);
  await page.getByText("道具配置 1", { exact: true }).dblclick();
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>).__selectionCalls)).toBe(1);
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("第二行任务参数");
  await page.getByRole("button", { name: "横向滚动", exact: true }).click();
  await page.getByText("转换事件", { exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "转换前校验" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "生成完成报告" })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("workspace-light.png") });
  await page.getByRole("button", { name: "详情…" }).click();
  const dialog = page.getByRole("dialog", { name: "详细配置" });
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox())?.width).toBeGreaterThan(750);
  await dialog.getByText("条目详情", { exact: true }).click();
  await page.screenshot({ path: info.outputPath("details.png") });
  await dialog.getByText("输出矩阵与重命名", { exact: true }).click();
  await dialog.locator(".output-matrix").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("output-matrix.png") });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "显示设置", exact: true }).click();
  await page.getByText("暗色", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "暗色", exact: true })).toBeChecked();
  await page.screenshot({ path: info.outputPath("display-settings-dark.png") });
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  await page.screenshot({ path: info.outputPath("workspace-dark.png") });
  await page.evaluate(() => ((window as unknown as Record<string, unknown>).__showScriptDialog as () => void)());
  const scriptDialog = page.getByRole("dialog", { name: "确认转换" });
  await expect(scriptDialog).toBeVisible();
  await page.screenshot({ path: info.outputPath("script-dialog.png") });
  await scriptDialog.getByRole("button", { name: "否", exact: true }).click();
  await expect(scriptDialog).not.toBeVisible();
  const violations = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""));
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
  expect(errors).toEqual([]);
});

test("窄窗口和分区大字号不遮挡日志与操作", async ({ page }, info) => {
  await page.setViewportSize({ width: 900, height: 600 });
  const treeToolbar = page.getByRole("toolbar", { name: "转换树工具栏" });
  const title = treeToolbar.getByRole("heading", { name: "转换列表" });
  const search = treeToolbar.getByRole("searchbox", { name: "搜索转换条目" });
  const titleBox = await title.boundingBox();
  const searchBox = await search.boundingBox();
  const toolbarBox = await treeToolbar.boundingBox();
  expect(titleBox).not.toBeNull();
  expect(searchBox).not.toBeNull();
  expect(toolbarBox?.height).toBeLessThan(120);
  expect(Math.abs((titleBox?.y ?? 0) + (titleBox?.height ?? 0) / 2 - (searchBox?.y ?? 0) - (searchBox?.height ?? 0) / 2)).toBeLessThanOrEqual(4);
  await page.getByRole("button", { name: "显示设置", exact: true }).click();
  await page.getByRole("spinbutton", { name: "左侧转换列表字号(px)" }).fill("24");
  await page.getByRole("spinbutton", { name: "日志输出字号(px)" }).fill("24");
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  const rows = page.getByRole("row");
  await expect.poll(async () => (await rows.nth(1).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
  await expect(page.getByRole("button", { name: "开始转换", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("workspace-large-font.png") });
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(page.getByRole("button", { name: "开始转换", exact: true })).toBeVisible();
  const narrowTitleBox = await title.boundingBox();
  const narrowSearchBox = await search.boundingBox();
  expect(Math.abs((narrowTitleBox?.y ?? 0) + (narrowTitleBox?.height ?? 0) / 2 - (narrowSearchBox?.y ?? 0) - (narrowSearchBox?.height ?? 0) / 2)).toBeLessThanOrEqual(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: info.outputPath("workspace-narrow.png"), fullPage: true });
});
