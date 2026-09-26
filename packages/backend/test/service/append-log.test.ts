/**
 * on_append_log 链测试（P3-09 / P2-08 backend 侧）。
 *
 * 真实 ScriptWorkerPool（worker 真进程）+ fake Java runner。
 * 语义锚点：main.js:166-215（共享 log_object/guard/部分修改保留）、
 * main.js:2299/2424（append_log_context 仅 conv_start 链期间）。
 */

import type { JavaBatchOptions, JavaBatchResult, ScriptWorkerPool } from "@xresconv/guardian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ParsedConfig } from "../../src/config/model.ts";
import { flattenTreeItems } from "../../src/domain/selection.ts";
import { ConversionSession } from "../../src/service/session.ts";
import { fixture, startPool, TEST_TIMEOUT_MS } from "./helpers.ts";

async function okRunner(options: JavaBatchOptions): Promise<JavaBatchResult> {
  void options;
  return { exitCode: 0, signal: null, failedTaskCount: 0, durationMs: 1 };
}

function selectAll(config: ParsedConfig) {
  return { items: flattenTreeItems(config.tree) };
}

describe("on_append_log", () => {
  let pool: ScriptWorkerPool;

  beforeAll(async () => {
    pool = await startPool();
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await pool.shutdown();
  }, TEST_TIMEOUT_MS);

  it("两个 hook 链式改写（前缀→大写），渲染取合并结果；窗口外日志不进链", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const session = new ConversionSession({ pool, runner: okRunner });
    const config = await session.loadConfig(fixture("run-append-log.xml"));
    const summary = await session.runConversion(selectAll(config));
    await session.pipeline.drain();
    expect(summary.state).toBe("succeeded");

    // hook1 加 "[H1] " 前缀 → hook2 大写（ops 合并贯穿，main.js:183-204）。
    const hooked = session.pipeline.snapshot().map((entry) => entry.message);
    expect(hooked).toContain("[H1] CHAIN-TARGET");
    expect(hooked).not.toContain("chain-target");
    expect(hooked).not.toContain("[H1] chain-target");

    // append_log_context 窗口外（run 结束后）日志不再进 hook 链（main.js:2424）。
    await session.pipeline.info("post-run", "X");
    const after = session.pipeline.snapshot().map((entry) => entry.message);
    expect(after).toContain("post-run");
    expect(after).not.toContain("[H1] POST-RUN");
  });

  it("hook 内 log_info 不递归进链（guard），且先于被 hook 的日志落队（main.js:182-214）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const session = new ConversionSession({ pool, runner: okRunner });
    const config = await session.loadConfig(fixture("run-append-log-recursion.xml"));
    const summary = await session.runConversion(selectAll(config));
    await session.pipeline.drain();
    expect(summary.state).toBe("succeeded");

    const snapshot = session.pipeline.snapshot();
    // hook 对每条进链日志执行一次 log_info("inner-from-hook")；guard（按 invocation_id
    // 判定 bypass，BD-O11）保证 inner 自身不再进链——否则会被加 "!" 并无限递归。
    const inners = snapshot.filter((entry) => entry.message.startsWith("inner-from-hook"));
    expect(inners.length).toBeGreaterThanOrEqual(1);
    expect(inners.every((entry) => entry.message === "inner-from-hook")).toBe(true);
    // 每条被 hook 的日志（以 "!" 结尾）恰好对应一条 inner。
    const hookedCount = snapshot.filter((entry) => entry.message.endsWith("!")).length;
    expect(inners.length).toBe(hookedCount);
    // inner 在被 hook 的日志之前落队（旧版同步 guard 语义，main.js:182-214）。
    const outerIdx = snapshot.findIndex((entry) => entry.message === "outer!");
    expect(outerIdx).toBeGreaterThanOrEqual(0);
    expect(snapshot.indexOf(inners[0] as (typeof snapshot)[number])).toBeLessThan(outerIdx);
  });

  it("hook 异常：已改字段保留、剩余 hook 跳过、记 APPEND LOG EVENT EXCEPTION（main.js:205-212）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const session = new ConversionSession({ pool, runner: okRunner });
    const config = await session.loadConfig(fixture("run-append-log-error.xml"));
    const summary = await session.runConversion(selectAll(config));
    await session.pipeline.drain();
    expect(summary.state).toBe("succeeded"); // hook 异常不影响 run 成败

    const snapshot = session.pipeline.snapshot();
    const messages = snapshot.map((entry) => entry.message);
    // hook1 的 "P:" 前缀保留，hook2 的 ":S" 后缀未执行。
    expect(messages).toContain("P:target-entry");
    expect(messages).not.toContain("P:target-entry:S");
    const exceptions = snapshot.filter(
      (entry) => entry.moduleName === "APPEND LOG EVENT EXCEPTION",
    );
    expect(exceptions.length).toBeGreaterThanOrEqual(1);
    expect(exceptions.some((entry) => entry.message.includes("h1-boom"))).toBe(true);
  });
});
