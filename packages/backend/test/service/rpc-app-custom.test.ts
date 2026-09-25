/**
 * BackendRpcApp 自定义选择器/按钮 + 事件 hook 开关测试（P4-05a，UI05/F09 后端）。
 *
 * 真实 ScriptWorkerPool（按钮脚本真进程执行）+ 真实隔离 MatcherService
 * （选择器匹配）；fixture custom-button.xml 提供 file+scheme 项、DataSource 项、
 * 命名/锁定/匿名三类 hook 与 counter/patch 两个按钮脚本。
 *
 * 覆盖：setHookEnabled（参数/状态校验、mutable 生效进快照）；setCustomSelectors
 * （参数校验、错误条目、default_selected 重放）；invokeCustomButton（匹配切换、
 * 动作链、按钮 data 跨点击持久、reload 动作使 data 重置、链失败中止记日志、
 * BD-S3 所有 outcome 应用 ops）。
 */

import { ScriptWorkerPool } from "@xresconv/guardian";
import { afterAll, describe, expect, it } from "vitest";
import type { CustomSelectorView } from "../../src/service/custom-selector.ts";
import {
  type BackendAppEvent,
  BackendRpcApp,
  type BackendSnapshot,
  type RpcErrorCode,
} from "../../src/service/rpc-app.ts";
import type { AppliedOpsReport } from "../../src/service/tree-state.ts";
import { fixture, TEST_TIMEOUT_MS, waitUntil } from "./helpers.ts";

const apps: BackendRpcApp[] = [];

afterAll(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()));
}, TEST_TIMEOUT_MS);

function makeApp() {
  const app = new BackendRpcApp({ pool: new ScriptWorkerPool() });
  apps.push(app);
  const events: BackendAppEvent[] = [];
  app.onEvent((event) => events.push(event));
  return { app, events };
}

async function expectRpcError(promise: Promise<unknown>, code: RpcErrorCode): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "RpcError", code });
}

async function snapshot(app: BackendRpcApp): Promise<BackendSnapshot> {
  return (await app.handleRpc("getSnapshot")) as BackendSnapshot;
}

/** 快照树里按标题找 item 节点（key 为运行时数字 id）。 */
function itemNodeByTitle(snap: BackendSnapshot, title: string) {
  const queue = [...(snap.tree?.nodes ?? [])];
  for (;;) {
    const node = queue.shift();
    if (node === undefined) return undefined;
    if (typeof node.key === "number" && node.title === title) return node;
    queue.push(...node.children);
  }
}

async function selectItem(app: BackendRpcApp, snap: BackendSnapshot, title: string) {
  const node = itemNodeByTitle(snap, title);
  expect(node).toBeDefined();
  const report = (await app.handleRpc("applyOps", {
    ops: [{ v: snap.tree?.version, op: "select_node", key: node?.key, selected: true }],
  })) as AppliedOpsReport;
  expect(report.applied).toBe(1);
}

function counterLogs(events: BackendAppEvent[]): string[] {
  return events
    .filter((e) => e.type === "log" && e.entry.message.startsWith("COUNTER="))
    .map((e) => (e.type === "log" ? e.entry.message : ""));
}

describe("setHookEnabled（P4-05a，main.js:1122-1188 复选框）", () => {
  it("未加载配置 → INVALID_STATE；参数形状/越界/无开关/不可变 → INVALID_PARAMS", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    await expectRpcError(
      app.handleRpc("setHookEnabled", { group: "before", index: 0, enabled: false }),
      "INVALID_STATE",
    );

    await app.handleRpc("loadConfig", { path: fixture("custom-button.xml") });
    // group 枚举外
    await expectRpcError(
      app.handleRpc("setHookEnabled", { group: "middle", index: 0, enabled: true }),
      "INVALID_PARAMS",
    );
    // index 负数/非整数/错类型
    await expectRpcError(
      app.handleRpc("setHookEnabled", { group: "before", index: -1, enabled: true }),
      "INVALID_PARAMS",
    );
    await expectRpcError(
      app.handleRpc("setHookEnabled", { group: "before", index: 0.5, enabled: true }),
      "INVALID_PARAMS",
    );
    await expectRpcError(
      app.handleRpc("setHookEnabled", { group: "before", index: "0", enabled: true }),
      "INVALID_PARAMS",
    );
    // enabled 非布尔
    await expectRpcError(
      app.handleRpc("setHookEnabled", { group: "before", index: 0, enabled: "yes" }),
      "INVALID_PARAMS",
    );
    // 越界（before 仅两条）
    await expectRpcError(
      app.handleRpc("setHookEnabled", { group: "before", index: 2, enabled: true }),
      "INVALID_PARAMS",
    );
    // 匿名 hook 无 UI 开关（after[0]）
    await expectRpcError(
      app.handleRpc("setHookEnabled", { group: "after", index: 0, enabled: false }),
      "INVALID_PARAMS",
    );
    // mutable="no"（before[1] 前置锁定）
    await expectRpcError(
      app.handleRpc("setHookEnabled", { group: "before", index: 1, enabled: false }),
      "INVALID_PARAMS",
    );
  });

  it("命名且可变的 hook 切换生效并进快照（含 append_log 组）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    const loaded = (await app.handleRpc("loadConfig", {
      path: fixture("custom-button.xml"),
    })) as BackendSnapshot;
    const before = loaded.config?.gui.onBeforeConvert ?? [];
    expect(before[0]?.toggle).toEqual({ name: "前置可关", checked: true, mutable: true });
    expect(before[0]?.enabled).toBe(true);

    const off = (await app.handleRpc("setHookEnabled", {
      group: "before",
      index: 0,
      enabled: false,
    })) as { enabled: boolean };
    expect(off.enabled).toBe(false);
    let snap = await snapshot(app);
    expect(snap.config?.gui.onBeforeConvert[0]?.enabled).toBe(false);
    // 锁定 hook 不受影响
    expect(snap.config?.gui.onBeforeConvert[1]?.enabled).toBe(true);

    await app.handleRpc("setHookEnabled", { group: "append_log", index: 0, enabled: false });
    snap = await snapshot(app);
    expect(snap.config?.gui.onAppendLog[0]?.enabled).toBe(false);

    // 无状态门禁：旧版复选框全程可改，切回不报错。
    await app.handleRpc("setHookEnabled", { group: "before", index: 0, enabled: true });
    expect((await snapshot(app)).config?.gui.onBeforeConvert[0]?.enabled).toBe(true);
  });
});

describe("setCustomSelectors（P4-05a，setup.js:54-105）", () => {
  it("参数校验：files 缺失/非数组/元素非字符串 → INVALID_PARAMS", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    await expectRpcError(app.handleRpc("setCustomSelectors", {}), "INVALID_PARAMS");
    await expectRpcError(
      app.handleRpc("setCustomSelectors", { files: "x.json" }),
      "INVALID_PARAMS",
    );
    await expectRpcError(
      app.handleRpc("setCustomSelectors", { files: ["a.json", 1] }),
      "INVALID_PARAMS",
    );
  });

  it("未设置时快照 customSelectors 为 null；设置后含视图与错误条目（记 CUSTOM SELECTOR 日志）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app, events } = makeApp();
    expect(((await snapshot(app)) as BackendSnapshot).customSelectors).toBeNull();

    const result = (await app.handleRpc("setCustomSelectors", {
      files: [fixture("custom-selectors.json"), fixture("custom-selectors-errors.json")],
    })) as { selectors: CustomSelectorView[] };
    // 8 条合法 + 3 条错误（字符串项/无名/空规则）。
    expect(result.selectors).toHaveLength(11);
    expect(result.selectors[0]).toMatchObject({ name: "proto选择", defaultSelected: true });
    expect(result.selectors[8]).toMatchObject({ name: null });
    const snap = await snapshot(app);
    expect(snap.customSelectors).toHaveLength(11);

    // 错误条目逐条记 error（module "CUSTOM SELECTOR"）。
    const errors = events.filter(
      (e) =>
        e.type === "log" && e.entry.level === "error" && e.entry.moduleName === "CUSTOM SELECTOR",
    );
    expect(errors.length).toBe(3);
  });

  it("default_selected：先设选择器再 loadConfig 重放勾选；reload 再重放（main.js:1888-1892）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    // CLI 顺序：选择器可先于配置设置。
    await app.handleRpc("setCustomSelectors", { files: [fixture("custom-selectors.json")] });
    const loaded = (await app.handleRpc("loadConfig", {
      path: fixture("custom-button.xml"),
    })) as BackendSnapshot;
    // proto选择（glob:*.proto + Kind）默认勾选 pa/pb；xa/xb 不选。
    expect(loaded.selectedItems.map((item) => item.name)).toEqual(["pa", "pb"]);

    // 手动全消后 reload：default_selected 重放再次勾选。
    const cleared = (await app.handleRpc("applyOps", {
      ops: [{ v: loaded.tree?.version, op: "select_none" }],
    })) as AppliedOpsReport;
    expect(cleared.applied).toBe(1);
    expect((await snapshot(app)).selectedItems).toEqual([]);

    const reloaded = (await app.handleRpc("reload")) as BackendSnapshot;
    expect(reloaded.selectedItems.map((item) => item.name)).toEqual(["pa", "pb"]);
  });

  it("default_selected：loadConfig 之后再 setCustomSelectors 立即勾选", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    await app.handleRpc("loadConfig", { path: fixture("custom-button.xml") });
    expect((await snapshot(app)).selectedItems).toEqual([]);
    await app.handleRpc("setCustomSelectors", { files: [fixture("custom-selectors.json")] });
    expect((await snapshot(app)).selectedItems.map((item) => item.name)).toEqual(["pa", "pb"]);
  });
});

describe("invokeCustomButton（P4-05a，main.js:795-830）", () => {
  it("参数校验与未知按钮：name 缺失/非字符串/未知 → INVALID_PARAMS", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    await app.handleRpc("setCustomSelectors", { files: [fixture("custom-selectors.json")] });
    await expectRpcError(app.handleRpc("invokeCustomButton", {}), "INVALID_PARAMS");
    await expectRpcError(app.handleRpc("invokeCustomButton", { name: 1 }), "INVALID_PARAMS");
    await expectRpcError(app.handleRpc("invokeCustomButton", { name: "不存在" }), "INVALID_PARAMS");
  });

  it("无 action 选择器点击 = 匹配切换：有未选中 → 全选匹配项，否则全取消（main.js:416-428）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    await app.handleRpc("loadConfig", { path: fixture("custom-button.xml") });
    await app.handleRpc("setCustomSelectors", { files: [fixture("custom-selectors.json")] });
    // default_selected 已勾 pa/pb；表格选择（glob:x*.xlsx）只中 xa。
    const on = (await app.handleRpc("invokeCustomButton", { name: "表格选择" })) as {
      ok: boolean;
    };
    expect(on.ok).toBe(true);
    expect((await snapshot(app)).selectedItems.map((item) => item.name)).toEqual([
      "pa",
      "pb",
      "xa",
    ]);

    const off = (await app.handleRpc("invokeCustomButton", { name: "表格选择" })) as {
      ok: boolean;
    };
    expect(off.ok).toBe(true);
    expect((await snapshot(app)).selectedItems.map((item) => item.name)).toEqual(["pa", "pb"]);
  });

  it("按钮脚本 data 跨点击持久；reload 动作重读文件使 data 重置（BD-O19 字符串 action 生效）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app, events } = makeApp();
    await app.handleRpc("loadConfig", { path: fixture("custom-button.xml") });
    await app.handleRpc("setCustomSelectors", { files: [fixture("custom-selectors.json")] });

    const first = (await app.handleRpc("invokeCustomButton", { name: "计数按钮" })) as {
      ok: boolean;
    };
    expect(first.ok).toBe(true);
    const second = (await app.handleRpc("invokeCustomButton", { name: "计数按钮" })) as {
      ok: boolean;
    };
    expect(second.ok).toBe(true);
    expect(counterLogs(events)).toEqual(["COUNTER=1", "COUNTER=2"]);

    // 重载按钮：字符串 action "reload"（BD-O19 归一化路径）重读文件，
    // generation 递增 → 旧 button_id 的 data 不再命中。
    const reloaded = (await app.handleRpc("invokeCustomButton", { name: "重载按钮" })) as {
      ok: boolean;
    };
    expect(reloaded.ok).toBe(true);
    const third = (await app.handleRpc("invokeCustomButton", { name: "计数按钮" })) as {
      ok: boolean;
    };
    expect(third.ok).toBe(true);
    expect(counterLogs(events)).toEqual(["COUNTER=1", "COUNTER=2", "COUNTER=1"]);
  });

  it("动作链失败记 error（module CUSTOM SELECTOR）并中止后续动作", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app, events } = makeApp();
    await app.handleRpc("loadConfig", { path: fixture("custom-button.xml") });
    await app.handleRpc("setCustomSelectors", { files: [fixture("custom-selectors.json")] });

    const result = (await app.handleRpc("invokeCustomButton", { name: "链中止" })) as {
      ok: boolean;
      error?: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("script missing-script not found.");
    // 链中止：counter 未执行。
    expect(counterLogs(events)).toEqual([]);
    await waitUntil(
      () =>
        events.some(
          (e) =>
            e.type === "log" &&
            e.entry.level === "error" &&
            e.entry.moduleName === "CUSTOM SELECTOR" &&
            e.entry.message.includes("missing-script"),
        ),
      "CUSTOM SELECTOR error log",
    );
  });

  it("内建动作 select_all/unselect_all 顺序执行；未知动作 no-op", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    await app.handleRpc("loadConfig", { path: fixture("custom-button.xml") });
    await app.handleRpc("setCustomSelectors", { files: [fixture("custom-selectors.json")] });
    // default_selected 已勾 pa/pb；链 = 全选后全消 → 最终为空。
    const chain = (await app.handleRpc("invokeCustomButton", { name: "全选全消" })) as {
      ok: boolean;
    };
    expect(chain.ok).toBe(true);
    expect((await snapshot(app)).selectedItems).toEqual([]);

    const noop = (await app.handleRpc("invokeCustomButton", { name: "未知动作" })) as {
      ok: boolean;
    };
    expect(noop.ok).toBe(true);
  });

  it("BD-S3：按钮脚本（resolved）的 ops 应用回会话树（item 字段改写可见）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    await app.handleRpc("loadConfig", { path: fixture("custom-button.xml") });
    await app.handleRpc("setCustomSelectors", { files: [fixture("custom-selectors.json")] });
    // default_selected 在 setCustomSelectors 里推过版本：取新快照再勾选。
    await selectItem(app, await snapshot(app), "pa");

    const result = (await app.handleRpc("invokeCustomButton", { name: "补丁按钮" })) as {
      ok: boolean;
    };
    expect(result.ok).toBe(true);
    const snap = await snapshot(app);
    expect(itemNodeByTitle(snap, "patched-by-button")).toBeDefined();
    expect(itemNodeByTitle(snap, "pa")).toBeUndefined();
  });
});
