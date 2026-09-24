/**
 * runConversion 编排测试（P3-08）。
 *
 * 真实 ScriptWorkerPool（worker 真进程）+ 注入 fake Java runner（不 spawn java）。
 * 语义锚点：main.js:2301-2448（事件链/收尾文案）、main.js:2118-2189（并发与退出码）。
 */

import type { JavaBatchOptions, JavaBatchResult, ScriptWorkerPool } from "@xresconv/guardian";
import { AbortError } from "@xresconv/guardian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ParsedConfig } from "../../src/config/model.ts";
import type { RunState } from "../../src/domain/run-state.ts";
import { flattenTreeItems } from "../../src/domain/selection.ts";
import { ConversionSession } from "../../src/service/session.ts";
import { fixture, startPool, TEST_TIMEOUT_MS, waitUntil } from "./helpers.ts";

function okRunner(calls: JavaBatchOptions[]) {
  return async (options: JavaBatchOptions): Promise<JavaBatchResult> => {
    calls.push(options);
    return { exitCode: 0, signal: null, failedTaskCount: 0, durationMs: 1 };
  };
}

function selectAll(config: ParsedConfig) {
  return { items: flattenTreeItems(config.tree) };
}

function collectStates(session: ConversionSession): RunState[] {
  const states: RunState[] = [];
  session.onStateChange = (state) => states.push(state);
  return states;
}

describe("runConversion", () => {
  let pool: ScriptWorkerPool;

  beforeAll(async () => {
    pool = await startPool();
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await pool.shutdown();
  }, TEST_TIMEOUT_MS);

  it("全链：before→java→after 顺序、状态序列、成功收尾文案", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const calls: JavaBatchOptions[] = [];
    const session = new ConversionSession({ pool, runner: okRunner(calls) });
    const states = collectStates(session);
    const config = await session.loadConfig(fixture("run-hooks.xml"));

    const summary = await session.runConversion(selectAll(config));
    await session.pipeline.drain();

    expect(summary.state).toBe("succeeded");
    expect(summary.failedCount).toBe(0);
    expect(summary.taskCount).toBe(1);
    expect(summary.runSeq).toBe(1);
    expect(calls.length).toBe(1);
    expect(calls[0]?.tasks.length).toBe(1);
    expect(states).toEqual([
      "loading",
      "ready",
      "before_hooks",
      "converting",
      "after_hooks",
      "succeeded",
    ]);

    // 日志次序：BEFORE（hook log_info，main.js:2301+）→ 派发日志 [CONV 1]（main.js:2093-2097）
    // → AFTER → "All jobs done."（main.js:2438-2446）。
    const snapshot = session.pipeline.snapshot();
    const indexOf = (pred: (message: string, moduleName: string) => boolean) =>
      snapshot.findIndex((entry) => pred(entry.message, entry.moduleName));
    const beforeIdx = indexOf((m, mod) => m === "BEFORE" && mod === "CONV EVENT");
    const dispatchIdx = indexOf((_m, mod) => mod === "[CONV 1]");
    const afterIdx = indexOf((m, mod) => m === "AFTER" && mod === "CONV EVENT");
    const doneIdx = indexOf((m) => m === "All jobs done.");
    expect(beforeIdx).toBeGreaterThanOrEqual(0);
    expect(dispatchIdx).toBeGreaterThan(beforeIdx);
    expect(afterIdx).toBeGreaterThan(dispatchIdx);
    expect(doneIdx).toBeGreaterThan(afterIdx);

    // 终态后重跑：loading→ready 重新武装（BD-O14）。
    const rerun = await session.runConversion(selectAll(config));
    expect(rerun.state).toBe("succeeded");
    expect(rerun.runSeq).toBe(2);
  });

  it("before reject → java/after 全跳过、failed_count=1、失败收尾文案（main.js:2396-2418）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const calls: JavaBatchOptions[] = [];
    const session = new ConversionSession({ pool, runner: okRunner(calls) });
    const states = collectStates(session);
    const config = await session.loadConfig(fixture("run-reject.xml"));

    const summary = await session.runConversion(selectAll(config));
    await session.pipeline.drain();

    expect(summary.state).toBe("failed");
    expect(summary.failedCount).toBe(1);
    expect(calls.length).toBe(0); // run_all 被跳过
    expect(states).toEqual(["loading", "ready", "before_hooks", "failed"]);

    const messages = session.pipeline.snapshot().map((entry) => entry.message);
    // 末尾 catch 记 "CONV" error（main.js:2416-2418）。
    expect(messages.some((m) => m.includes("stop-now"))).toBe(true);
    expect(messages.some((m) => m.includes("AFTER"))).toBe(false); // after 链跳过
    expect(messages).toContain("All jobs done, 1 job(s) failed.");
  });

  it("java 退出码累加进 failed_count（main.js:2175-2176），after 跳过（main.js:2179-2185）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const session = new ConversionSession({
      pool,
      runner: async (): Promise<JavaBatchResult> => ({
        exitCode: 2,
        signal: null,
        failedTaskCount: 2,
        durationMs: 1,
      }),
    });
    const config = await session.loadConfig(fixture("run-hooks.xml"));

    const summary = await session.runConversion(selectAll(config));
    await session.pipeline.drain();

    expect(summary.state).toBe("failed");
    expect(summary.failedCount).toBe(2);
    const snapshot = session.pipeline.snapshot();
    const messages = snapshot.map((entry) => entry.message);
    expect(messages).toContain("[Process 1 exit with code 2.]");
    expect(messages).toContain("All jobs done, 2 job(s) failed.");
    expect(messages.some((m) => m.includes("AFTER"))).toBe(false);
  });

  it("确定分片：round-robin（task i → 分片 i%N，BD-O3），5 任务并发 2 → [0,2,4]/[1,3]", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const calls: JavaBatchOptions[] = [];
    const session = new ConversionSession({ pool, runner: okRunner(calls), parallelism: 2 });
    const config = await session.loadConfig(fixture("run-shards.xml"));

    const summary = await session.runConversion(selectAll(config));

    expect(summary.state).toBe("succeeded");
    expect(summary.taskCount).toBe(5);
    expect(calls.length).toBe(2);
    const shard0 = (calls[0]?.tasks ?? []).join("\n");
    const shard1 = (calls[1]?.tasks ?? []).join("\n");
    expect(calls[0]?.tasks.length).toBe(3);
    expect(calls[1]?.tasks.length).toBe(2);
    for (const marker of ["item0", "item2", "item4"]) {
      expect(shard0).toContain(marker);
    }
    for (const marker of ["item1", "item3"]) {
      expect(shard1).toContain(marker);
    }
  });

  it("取消：运行中 cancel → 终态 cancelled 恰好一次、java abort 生效、无 All jobs done（BD-O6）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const runnerCalls: JavaBatchOptions[] = [];
    const hangingRunner = (options: JavaBatchOptions): Promise<JavaBatchResult> => {
      runnerCalls.push(options);
      const { promise, reject } = Promise.withResolvers<JavaBatchResult>();
      options.signal?.addEventListener("abort", () => reject(new AbortError()));
      return promise;
    };
    const session = new ConversionSession({ pool, runner: hangingRunner });
    const states = collectStates(session);
    const config = await session.loadConfig(fixture("run-hooks.xml"));

    const runPromise = session.runConversion(selectAll(config));
    await waitUntil(() => runnerCalls.length > 0, "java runner dispatched");
    session.cancel();
    session.cancel(); // 重复 cancel 是 no-op
    const summary = await runPromise;
    await session.pipeline.drain();

    expect(summary.state).toBe("cancelled");
    expect(summary.failedCount).toBe(0);
    expect(runnerCalls[0]?.signal?.aborted).toBe(true);
    expect(states.filter((s) => s === "cancelled").length).toBe(1);
    expect(states.indexOf("after_hooks")).toBe(-1);
    const messages = session.pipeline.snapshot().map((entry) => entry.message);
    expect(messages).toContain("Conversion cancelled.");
    expect(messages.some((m) => m.startsWith("All jobs done"))).toBe(false);
  });

  it("状态机违规：未加载配置/运行中再启动均抛错（复用 assertTransition 语义）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const session = new ConversionSession({ pool, runner: okRunner([]) });
    await expect(session.runConversion({ items: [] })).rejects.toThrow(/requires a loaded config/);

    const hangingRunner = (options: JavaBatchOptions): Promise<JavaBatchResult> => {
      const { promise, reject } = Promise.withResolvers<JavaBatchResult>();
      options.signal?.addEventListener("abort", () => reject(new AbortError()));
      return promise;
    };
    const hanging = new ConversionSession({ pool, runner: hangingRunner });
    const config = await hanging.loadConfig(fixture("run-hooks.xml"));
    const items = selectAll(config);
    const first = hanging.runConversion(items);
    await waitUntil(() => hanging.getState() !== "ready", "first run leaves ready");
    await expect(hanging.runConversion(items)).rejects.toThrow(/cannot start a run/);
    hanging.cancel();
    const summary = await first;
    expect(summary.state).toBe("cancelled");
  });
});
