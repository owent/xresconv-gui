/**
 * cancel/reset/close 统一收尾（P2-09/P3-08，EX03/SC10 会话侧）。
 *
 * - 取消覆盖各阶段：before（既有 run.test.ts）/converting（既有）/
 *   after_hooks（本文件：in-flight hook 完成后链中止，无迟到重放）；
 * - reset 是业务操作：先取消并等实际回收（runner 终止确认后 run 才 settle），
 *   再清运行期状态重新武装；幂等（同请求重投）；终态一次；
 * - dispose 幂等；有界等待，超时不冒充清理成功；
 * - 不自动重放：被取消 run 的 hook 不会在新 run 中再次执行（SC10）。
 *
 * 真实 ScriptWorkerPool + 注入 fake Java runner；全部显式有界超时。
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

function hangingRunner(calls: JavaBatchOptions[]) {
  return (options: JavaBatchOptions): Promise<JavaBatchResult> => {
    calls.push(options);
    const { promise, reject } = Promise.withResolvers<JavaBatchResult>();
    options.signal?.addEventListener("abort", () => reject(new AbortError()));
    return promise;
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

describe("cancel/reset/close 统一收尾（EX03）", () => {
  let pool: ScriptWorkerPool;

  beforeAll(async () => {
    pool = await startPool();
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await pool.shutdown();
  }, TEST_TIMEOUT_MS);

  it("after_hooks 阶段取消：in-flight hook 完成后链中止、无 AFTER2、终态一次", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const session = new ConversionSession({ pool, runner: okRunner([]) });
    const states = collectStates(session);
    const config = await session.loadConfig(fixture("run-after-hooks.xml"));

    const runPromise = session.runConversion(selectAll(config));
    await waitUntil(() => session.getState() === "after_hooks", "after_hooks entered");
    session.cancel();
    const summary = await runPromise;
    await session.pipeline.drain();

    expect(summary.state).toBe("cancelled");
    expect(states.filter((s) => s === "cancelled").length).toBe(1);
    const messages = session.pipeline.snapshot().map((entry) => entry.message);
    // in-flight hook 完成（BD-O6：共享池不杀在途 invoke），但链不再前进。
    expect(messages).toContain("AFTER1");
    expect(messages).not.toContain("AFTER2");
    expect(messages).toContain("Conversion cancelled.");
    expect(messages.some((m) => m.startsWith("All jobs done"))).toBe(false);
    await session.dispose();
  });

  it("reset 在活动运行中：先取消并等实际回收，再重新武装；旧 hook 不重放", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const runnerCalls: JavaBatchOptions[] = [];
    // 首个 run 挂起（验证 reset 的取消+回收），reset 后切正常实现（验证重新武装）。
    let impl: (options: JavaBatchOptions) => Promise<JavaBatchResult> = hangingRunner(runnerCalls);
    const session = new ConversionSession({
      pool,
      runner: (options) => impl(options),
    });
    const states = collectStates(session);
    const config = await session.loadConfig(fixture("run-hooks.xml"));

    const runPromise = session.runConversion(selectAll(config));
    await waitUntil(() => runnerCalls.length > 0, "java runner dispatched");
    const resetResult = await session.reset();
    await runPromise; // reset 已等其 settle；这里只取结果
    expect(resetResult.cancelledRun).toBe(true);
    expect(session.getState()).toBe("ready");
    expect(states.filter((s) => s === "cancelled").length).toBe(1);
    // 实际回收证据：reset 返回时 java abort 已被 runner 确认（hangingRunner 只在 abort 时结算）。
    expect(runnerCalls[0]?.signal?.aborted).toBe(true);

    // 重新武装后新运行：runSeq 递增，before hook 恰好再跑一次（无重放旧 run）。
    const beforeCount = () =>
      session.pipeline
        .snapshot()
        .filter((entry) => entry.message === "BEFORE" && entry.moduleName === "CONV EVENT").length;
    expect(beforeCount()).toBe(1);
    impl = okRunner(runnerCalls);
    const rerun = await session.runConversion(selectAll(config));
    expect(rerun.state).toBe("succeeded");
    expect(rerun.runSeq).toBe(2);
    expect(beforeCount()).toBe(2);
    await session.dispose();
  });

  it("reset 在终态/ready：幂等、不重复取消、runSeq 不被空转消耗", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const session = new ConversionSession({ pool, runner: okRunner([]) });
    const config = await session.loadConfig(fixture("run-hooks.xml"));
    const first = await session.runConversion(selectAll(config));
    expect(first.state).toBe("succeeded");
    expect(session.getRunSeq()).toBe(1);

    const r1 = await session.reset();
    expect(r1.cancelledRun).toBe(false);
    expect(session.getState()).toBe("ready");
    const r2 = await session.reset(); // 同请求重投：幂等
    expect(r2.cancelledRun).toBe(false);
    expect(session.getRunSeq()).toBe(1); // reset 不消耗代际

    const second = await session.runConversion(selectAll(config));
    expect(second.runSeq).toBe(2);
    await session.dispose();
  });

  it("dispose 幂等：重复调用直接返回；dispose 后 reset/run 拒绝", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const session = new ConversionSession({ pool, runner: okRunner([]) });
    const config = await session.loadConfig(fixture("run-hooks.xml"));
    await session.runConversion(selectAll(config));
    await session.dispose();
    await session.dispose(); // 重投幂等
    await expect(session.reset()).rejects.toThrow(/disposed/);
    await expect(session.runConversion(selectAll(config))).rejects.toThrow(/disposed/);
  });
});
