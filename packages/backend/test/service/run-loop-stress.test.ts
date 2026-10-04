/**
 * P6-03 泄漏循环（主计划 11.5 / 06 册"性能、稳定性和证据模板"）：
 * 加载→选择→转换→（每 10 轮取消 + reset 重新武装 + 再次转换），共 100 轮。
 *
 * 断言（本机可自动验证部分）：
 * - 每轮结束状态正确（succeeded / cancelled），runSeq 与实际运行数一致；
 * - 后端 reset RPC 在循环中反复执行（活动运行取消后重新武装路径）；
 * - 池 worker 数量不随循环增长（补员只替换不累积）；
 * - 进程句柄数无持续增长（warm-up/中段/末段三点采样，末-首差有界）；
 * - 结束后 shutdown：循环期间出现过的全部 worker pid 均已回收（无孤儿）；
 * - RSS 趋势记录在案（宽松上界守卫，稳定态评估不靠硬阈值伪造精度）。
 *
 * 真实 ScriptWorkerPool（真实 worker 子进程执行 BEFORE/AFTER hook）+
 * 注入 fake Java runner（真实 JAR 差分属 EX05，不在此重复）；全部等待有界。
 */

import type { JavaBatchOptions, JavaBatchResult, ScriptWorkerPool } from "@xresconv/guardian";
import { AbortError, ScriptWorkerPool as Pool } from "@xresconv/guardian";
import { expect, it } from "vitest";
import type { ParsedConfig } from "../../src/config/model.ts";
import { flattenTreeItems } from "../../src/domain/selection.ts";
import { ConversionSession } from "../../src/service/session.ts";
import { fixture, waitUntil } from "./helpers.ts";

const LOOP_COUNT = 100;
/** 100 轮真实子进程循环的上限：按每轮 ≤1s 预留 5 倍余量。 */
const STRESS_TIMEOUT_MS = 300_000;
/** 句柄采样差上界：覆盖 vitest runner 噪声，远低于"每轮泄漏 1 个"的斜率。 */
const HANDLE_DELTA_LIMIT = 16;

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

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function activeHandles(): number {
  // 内部 API 仅用于测试的泄漏趋势守卫采样；不进入产品代码。
  const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles;
  return handles ? handles().length : -1;
}

it("P6-03：100 轮加载→选择→转换（每 10 轮取消+reset+再转换）无孤儿、句柄无持续增长", {
  timeout: STRESS_TIMEOUT_MS,
}, async () => {
  const pool: ScriptWorkerPool = new Pool();
  await pool.start();

  const runnerCalls: JavaBatchOptions[] = [];
  let impl: (options: JavaBatchOptions) => Promise<JavaBatchResult> = okRunner(runnerCalls);
  const session = new ConversionSession({ pool, runner: (options) => impl(options) });

  const seenPids = new Set<number>();
  const poolSize = pool.stats().length;
  expect(poolSize).toBeGreaterThan(0);
  const handleSamples: Array<{ iteration: number; handles: number; rssMb: number }> = [];
  const sample = (iteration: number) => {
    for (const stat of pool.stats()) {
      if (stat.pid !== undefined) seenPids.add(stat.pid);
    }
    handleSamples.push({
      iteration,
      handles: activeHandles(),
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    });
  };

  let expectedRunSeq = 0;
  for (let i = 1; i <= LOOP_COUNT; i += 1) {
    // 加载（含 reload 路径）→ 全选 → 转换。
    const config = await session.loadConfig(fixture("run-hooks.xml"));
    const selection = selectAll(config);

    if (i % 10 === 0) {
      // 取消路径：挂起 java runner 使 converting 可取消。
      impl = hangingRunner(runnerCalls);
      const cancelPromise = session.runConversion(selection);
      await waitUntil(
        () => session.getState() === "converting",
        `converting entered (iteration ${i})`,
      );
      session.cancel();
      const cancelled = await cancelPromise;
      expect(cancelled.state).toBe("cancelled");
      expect(cancelled.runSeq).toBe(expectedRunSeq + 1);
      expectedRunSeq += 1;

      // reset RPC：重新武装后"再次转换"必须正常完成。
      const reset = await session.reset();
      expect(reset.cancelledRun).toBe(false);
      impl = okRunner(runnerCalls);
      const rerun = await session.runConversion(selection);
      expect(rerun.state).toBe("succeeded");
      expect(rerun.runSeq).toBe(expectedRunSeq + 1);
      expectedRunSeq += 1;
    } else {
      const summary = await session.runConversion(selection);
      expect(summary.state).toBe("succeeded");
      expect(summary.runSeq).toBe(expectedRunSeq + 1);
      expectedRunSeq += 1;
    }

    if (i === 5 || i === 50 || i === LOOP_COUNT) {
      sample(i);
    }
  }

  // 状态干净：runSeq 与实际运行数一致（90 正常 + 10 取消 + 10 重跑 = 110）。
  expect(session.getRunSeq()).toBe(expectedRunSeq);
  expect(expectedRunSeq).toBe(110);
  expect(pool.stats().length).toBe(poolSize); // 池不随循环增长
  await session.pipeline.drain();
  await session.dispose();

  // 句柄趋势：末段 - warm-up 有界（允许运行噪声，不允许每轮累积）。
  const warm = handleSamples[0] as { handles: number; rssMb: number };
  const end = handleSamples[handleSamples.length - 1] as { handles: number; rssMb: number };
  expect(end.handles - warm.handles).toBeLessThanOrEqual(HANDLE_DELTA_LIMIT);
  // RSS 宽松守卫：只拦失控增长（+512MiB），不把正常波动写成精度结论。
  expect(end.rssMb - warm.rssMb).toBeLessThanOrEqual(512);
  const trend = handleSamples
    .map((s) => `#${s.iteration} handles=${s.handles} rss=${s.rssMb}MiB`)
    .join("; ");
  console.log(`[P6-03] 句柄/RSS 采样：${trend}；循环期间出现 worker pid 数=${seenPids.size}`);

  // 孤儿检查：shutdown 后循环期间出现过的全部 worker pid 死亡。
  await pool.shutdown();
  for (const pid of seenPids) {
    await waitUntil(() => !pidAlive(pid), `worker pid ${pid} reaped after shutdown`, 15_000);
  }
});
