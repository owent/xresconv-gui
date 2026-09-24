/**
 * loadConfig + set_name 整合测试（P3-03）。
 *
 * 真实 ScriptWorkerPool（script-host worker 真进程），无协议 mock。
 * 语义锚点：main.js:1704-1758（上下文/无超时/异常后继续）、BD-O1（硬超时）。
 */

import type { ScriptWorkerPool } from "@xresconv/guardian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flattenTreeItems } from "../../src/domain/selection.ts";
import { ConversionSession } from "../../src/service/session.ts";
import { fixture, startPool, TEST_TIMEOUT_MS } from "./helpers.ts";

describe("loadConfig + set_name", () => {
  let pool: ScriptWorkerPool;

  beforeAll(async () => {
    pool = await startPool();
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await pool.shutdown();
  }, TEST_TIMEOUT_MS);

  it("set_name 改写 item name，按树文档序逐条应用", { timeout: TEST_TIMEOUT_MS }, async () => {
    const session = new ConversionSession({ pool });
    expect(session.getState()).toBe("idle");
    const config = await session.loadConfig(fixture("set-name.xml"));
    expect(session.getState()).toBe("ready");
    const names = flattenTreeItems(config.tree).map((item) => item.name);
    expect(names).toEqual(["alpha-renamed", "beta-renamed"]);
    // 同一对象引用：树节点内的 item 同步可见（旧版活引用语义）。
    const node = config.tree[0];
    expect(node?.kind).toBe("item");
    if (node?.kind === "item") {
      expect(node.item.name).toBe("alpha-renamed");
    }
  });

  it("set_name 异常：记 GUI EVENT 诊断、加载继续、部分修改保留", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const session = new ConversionSession({ pool });
    const config = await session.loadConfig(fixture("set-name-error.xml"));
    const items = flattenTreeItems(config.tree);
    // good 正常改名；partial 改名后才抛错（部分修改保留，BD-O16/main.js:1711 活引用语义）；
    // bad 抛错前未修改 → 保留原名（main.js:1749-1757）。
    expect(items.map((item) => item.name)).toEqual(["good-ok", "partial-ok", "bad"]);
    const errors = session.pipeline
      .snapshot()
      .filter((entry) => entry.level === "error" && entry.moduleName === "GUI EVENT");
    expect(errors.length).toBe(2);
    expect(errors.some((entry) => entry.message.includes("boom-partial"))).toBe(true);
    expect(errors.some((entry) => entry.message.includes("boom-bad"))).toBe(true);
  });

  it("set_name 死循环：注入短超时内记诊断、不卡死、item 保留原名（BD-O1）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const session = new ConversionSession({ pool, setNameTimeoutMs: 300 });
    const startedAt = Date.now();
    const config = await session.loadConfig(fixture("set-name-loop.xml"));
    expect(Date.now() - startedAt).toBeLessThan(TEST_TIMEOUT_MS);
    expect(session.getState()).toBe("ready");
    expect(flattenTreeItems(config.tree).map((item) => item.name)).toEqual(["loopy"]);
    const errors = session.pipeline
      .snapshot()
      .filter((entry) => entry.level === "error" && entry.moduleName === "GUI EVENT");
    expect(errors.length).toBe(1);
    expect(errors[0]?.message).toContain('set_name failed for item "loopy"');
  });

  it("解析硬错误：状态进 failed 并把异常抛给调用方", { timeout: TEST_TIMEOUT_MS }, async () => {
    const session = new ConversionSession({ pool });
    await expect(session.loadConfig(fixture("missing-file.xml"))).rejects.toThrow();
    expect(session.getState()).toBe("failed");
    // 终态后可重新加载（terminal → loading → ready）。
    const config = await session.loadConfig(fixture("set-name.xml"));
    expect(session.getState()).toBe("ready");
    expect(flattenTreeItems(config.tree).length).toBe(2);
  });
});
