/**
 * 并发分片矩阵（P3-07 / EX02）：fake runner 实测编排层批次调度。
 *
 * - 并发 1/4/16：分片数、单分片任务数、真实最大并发数、每任务只提交一次；
 * - 少于 worker 的任务数（parallelism 16、3 任务 → 3 分片）；
 * - 空任务不 spawn（BD-O5）。
 *
 * runner 是注入的 fake（不 spawn java）：真实并发窗口用 25ms 延迟放大，
 * maxConcurrency 证明 Promise.all 的真实并行度。语义锚点：main.js:2118
 * （parallelism）、BD-O2（[1,16] 夹取）、BD-O3（round-robin 确定分片）。
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { JavaBatchOptions, JavaBatchResult, ScriptWorkerPool } from "@xresconv/guardian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flattenTreeItems } from "../../src/domain/selection.ts";
import { ConversionSession } from "../../src/service/session.ts";
import { startPool, TEST_TIMEOUT_MS } from "./helpers.ts";

const tmpRoots: string[] = [];

afterAll(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeConfig(itemCount: number): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xresconv-par-"));
  tmpRoots.push(dir);
  const configPath = path.join(dir, "parallelism.xml");
  const items = Array.from(
    { length: itemCount },
    (_, i) => `    <item name="i${i}"><option>-c item${i}</option></item>`,
  ).join("\n");
  writeFileSync(
    configPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<root>
  <global>
    <work_dir>${dir}</work_dir>
    <xresloader_path>${configPath}</xresloader_path>
  </global>
  <list>
${items}
  </list>
</root>
`,
  );
  return configPath;
}

interface RunnerStats {
  calls: JavaBatchOptions[];
  maxConcurrency: number;
}

/** 测量真实并发度的 fake runner：25ms 窗口放大并行重叠。 */
function measuringRunner(stats: RunnerStats) {
  let inFlight = 0;
  return async (options: JavaBatchOptions): Promise<JavaBatchResult> => {
    inFlight++;
    stats.maxConcurrency = Math.max(stats.maxConcurrency, inFlight);
    stats.calls.push(options);
    await new Promise((resolve) => setTimeout(resolve, 25));
    inFlight--;
    return { exitCode: 0, signal: null, failedTaskCount: 0, durationMs: 25 };
  };
}

function allLines(stats: RunnerStats): string[] {
  return stats.calls.flatMap((call) => call.tasks);
}

describe("runConversion 并发分片矩阵（EX02）", () => {
  let pool: ScriptWorkerPool;

  beforeAll(async () => {
    pool = await startPool();
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await pool.shutdown();
  }, TEST_TIMEOUT_MS);

  it("并发 1：6 任务 → 1 分片 6 行，maxConcurrency=1", { timeout: TEST_TIMEOUT_MS }, async () => {
    const stats: RunnerStats = { calls: [], maxConcurrency: 0 };
    const session = new ConversionSession({ pool, runner: measuringRunner(stats), parallelism: 1 });
    const config = await session.loadConfig(writeConfig(6));
    const summary = await session.runConversion({ items: flattenTreeItems(config.tree) });

    expect(summary.state).toBe("succeeded");
    expect(summary.taskCount).toBe(6);
    expect(stats.calls.length).toBe(1);
    expect(stats.calls[0]?.tasks.length).toBe(6);
    expect(stats.maxConcurrency).toBe(1);
  });

  it("并发 4：12 任务 → 4 分片各 3 行，maxConcurrency=4，每任务只提交一次", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const stats: RunnerStats = { calls: [], maxConcurrency: 0 };
    const session = new ConversionSession({
      pool,
      runner: measuringRunner(stats),
      parallelism: 4,
    });
    const config = await session.loadConfig(writeConfig(12));
    const summary = await session.runConversion({ items: flattenTreeItems(config.tree) });

    expect(summary.state).toBe("succeeded");
    expect(summary.taskCount).toBe(12);
    expect(stats.calls.length).toBe(4);
    for (const call of stats.calls) {
      expect(call.tasks.length).toBe(3);
    }
    expect(stats.maxConcurrency).toBe(4);
    const lines = allLines(stats);
    expect(lines.length).toBe(12);
    expect(new Set(lines).size).toBe(12);
    for (let i = 0; i < 12; i++) {
      expect(lines.some((line) => line.includes(`item${i}`))).toBe(true);
    }
  });

  it("并发 16：16 任务 → 16 分片各 1 行，maxConcurrency=16", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const stats: RunnerStats = { calls: [], maxConcurrency: 0 };
    const session = new ConversionSession({
      pool,
      runner: measuringRunner(stats),
      parallelism: 16,
    });
    const config = await session.loadConfig(writeConfig(16));
    const summary = await session.runConversion({ items: flattenTreeItems(config.tree) });

    expect(summary.state).toBe("succeeded");
    expect(summary.taskCount).toBe(16);
    expect(stats.calls.length).toBe(16);
    for (const call of stats.calls) {
      expect(call.tasks.length).toBe(1);
    }
    expect(stats.maxConcurrency).toBe(16);
    expect(new Set(allLines(stats)).size).toBe(16);
  });

  it("少于 worker 的任务数：parallelism 16、3 任务 → 3 分片（不多 spawn）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const stats: RunnerStats = { calls: [], maxConcurrency: 0 };
    const session = new ConversionSession({
      pool,
      runner: measuringRunner(stats),
      parallelism: 16,
    });
    const config = await session.loadConfig(writeConfig(3));
    const summary = await session.runConversion({ items: flattenTreeItems(config.tree) });

    expect(summary.state).toBe("succeeded");
    expect(summary.taskCount).toBe(3);
    expect(stats.calls.length).toBe(3);
    expect(stats.maxConcurrency).toBe(3);
  });

  it("空任务：不 spawn java（BD-O5），succeeded", { timeout: TEST_TIMEOUT_MS }, async () => {
    const stats: RunnerStats = { calls: [], maxConcurrency: 0 };
    const session = new ConversionSession({ pool, runner: measuringRunner(stats), parallelism: 4 });
    await session.loadConfig(writeConfig(3)); // 空选择也需先加载配置（状态机要求）
    const summary = await session.runConversion({ items: [] });

    expect(summary.state).toBe("succeeded");
    expect(summary.taskCount).toBe(0);
    expect(stats.calls.length).toBe(0);
  });
});
