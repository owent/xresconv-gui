/**
 * 并发分片矩阵：fake runner 实测编排层批次调度。
 *
 * 并发 1/4/16：分片数、单分片任务数、真实最大并发数、每任务只提交一次；
 * 少于 worker 的任务数（parallelism 16、3 任务 → 3 分片）；
 * 空任务不 spawn。
 *
 * runner 是注入的 fake（不 spawn java）：所有预期分片进入后才允许完成，
 * maxConcurrency 验证 Promise.all 的并行度。语义锚点：
 * （parallelism）、（[1,16] 夹取）、（round-robin 确定分片）。
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { JavaBatchOptions, JavaBatchResult, ScriptWorkerPool } from "@xresconv/guardian";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flattenTreeItems } from "../../src/domain/selection.ts";
import { ConversionSession } from "../../src/service/session.ts";
import { startPool, TEST_TIMEOUT_MS } from "./helpers.ts";

const tmpRoots: string[] = [];
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof fsPromises>();
  return { ...original, readFile: vi.fn(original.readFile) };
});
afterEach(() => vi.mocked(fsPromises.readFile).mockReset());
const Zip = createRequire(import.meta.url)("adm-zip") as new () => {
  addFile(name: string, data: Buffer): void;
  writeZip(path: string): void;
};

afterAll(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeConfig(itemCount: number, version?: string, javaOption?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xresconv-par-"));
  tmpRoots.push(dir);
  const configPath = path.join(dir, "parallelism.xml");
  const jarPath = path.join(dir, "converter.jar");
  if (version !== undefined) {
    const jar = new Zip();
    jar.addFile("application.properties", Buffer.from(`version=${version}\nname=xresloader\n`));
    jar.writeZip(jarPath);
  }
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
    <xresloader_path>${version === undefined ? configPath : jarPath}</xresloader_path>
    ${javaOption === undefined ? "" : `<java_option>${javaOption}</java_option>`}
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

/** 所有分片进入同一个屏障，再统一放行，不依赖机器调度速度。 */
function measuringRunner(stats: RunnerStats, expectedCalls: number) {
  let inFlight = 0;
  const entered = Promise.withResolvers<void>();
  return async (options: JavaBatchOptions): Promise<JavaBatchResult> => {
    inFlight++;
    stats.maxConcurrency = Math.max(stats.maxConcurrency, inFlight);
    stats.calls.push(options);
    if (stats.calls.length === expectedCalls) entered.resolve();
    await entered.promise;
    inFlight--;
    return { exitCode: 0, signal: null, failedTaskCount: 0, durationMs: 0 };
  };
}

function allLines(stats: RunnerStats): string[] {
  return stats.calls.flatMap((call) => call.tasks);
}

describe("runConversion 并发分片矩阵", () => {
  let pool: ScriptWorkerPool;

  beforeAll(async () => {
    pool = await startPool();
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await pool.shutdown();
  }, TEST_TIMEOUT_MS);

  it.each([
    { version: "2.23.7", displayVersion: "2.24.0-beta", processes: 4, args: [] },
    {
      version: "2.24.0-beta",
      displayVersion: "2.23.7",
      processes: 1,
      args: ["--parallelism", "4"],
    },
    { version: "Unknown", displayVersion: "2.24.0", processes: 4, args: [] },
  ])(
    "构建 $version、展示 $displayVersion：并发能力由实际构建决定",
    { timeout: TEST_TIMEOUT_MS },
    async ({ version, displayVersion, processes, args }) => {
      const stats: RunnerStats = { calls: [], maxConcurrency: 0 };
      const javaOption = `-Dxresloader.version=${displayVersion}`;
      const session = new ConversionSession({
        pool,
        runner: measuringRunner(stats, 1),
        parallelism: 4,
      });
      const config = await session.loadConfig(writeConfig(5, version, javaOption));
      const summary = await session.runConversion({ items: flattenTreeItems(config.tree) });
      expect(summary.state).toBe("succeeded");
      expect(stats.calls).toHaveLength(processes);
      for (const call of stats.calls) {
        expect(call.xresloaderArgs).toEqual(args);
        expect(call.javaArgs).toContain(javaOption);
      }
      expect(new Set(allLines(stats)).size).toBe(5);
    },
  );

  it.each(["2.24.0-beta", "2.24.0", "2.25.1", "2.100.0", "3.0.0"])(
    "%s：默认 auto，全部任务按序提交给单 JVM",
    { timeout: TEST_TIMEOUT_MS },
    async (version) => {
      const stats: RunnerStats = { calls: [], maxConcurrency: 0 };
      const session = new ConversionSession({ pool, runner: measuringRunner(stats, 1) });
      expect(session.getParallelism()).toBe("auto");
      const config = await session.loadConfig(writeConfig(6, version));
      const summary = await session.runConversion({ items: flattenTreeItems(config.tree) });
      expect(summary.state).toBe("succeeded");
      expect(summary.taskCount).toBe(6);
      expect(stats.calls).toHaveLength(1);
      expect(stats.calls[0]?.xresloaderArgs).toEqual(["--parallelism", "auto"]);
      expect(stats.calls[0]?.tasks).toHaveLength(6);
      stats.calls[0]?.tasks.forEach((line, index) => {
        expect(line).toContain(`item${index}`);
      });
      expect(stats.maxConcurrency).toBe(1);
      expect(
        session.pipeline
          .snapshot()
          .some((entry) => entry.message.includes("--stdin --parallelism auto")),
      ).toBe(true);
    },
  );

  it.each([1, 4, 16])(
    "2.24 数字并发 %i：仍只启动一个 JVM",
    { timeout: TEST_TIMEOUT_MS },
    async (parallelism) => {
      const stats: RunnerStats = { calls: [], maxConcurrency: 0 };
      const session = new ConversionSession({
        pool,
        runner: measuringRunner(stats, 1),
        parallelism,
      });
      const config = await session.loadConfig(writeConfig(3, "2.24.0-beta"));
      const summary = await session.runConversion({ items: flattenTreeItems(config.tree) });
      expect(summary.state).toBe("succeeded");
      expect(stats.calls).toHaveLength(1);
      expect(stats.calls[0]?.tasks).toHaveLength(3);
      expect(stats.calls[0]?.xresloaderArgs).toEqual(["--parallelism", String(parallelism)]);
    },
  );

  it.each(["2.23.99", "2.9.0", "Unknown", "unrecognized"])(
    "%s：auto 回退原默认双进程",
    { timeout: TEST_TIMEOUT_MS },
    async (version) => {
      const stats: RunnerStats = { calls: [], maxConcurrency: 0 };
      const session = new ConversionSession({ pool, runner: measuringRunner(stats, 2) });
      const config = await session.loadConfig(writeConfig(5, version));
      const summary = await session.runConversion({ items: flattenTreeItems(config.tree) });
      expect(summary.state).toBe("succeeded");
      expect(stats.calls).toHaveLength(2);
      expect(stats.calls.map((call) => call.tasks.length)).toEqual([3, 2]);
      expect(stats.calls.every((call) => !call.xresloaderArgs?.length)).toBe(true);
      expect(new Set(allLines(stats)).size).toBe(5);
    },
  );

  it("切换有效 JAR 后重读版本，并发设置保留", { timeout: TEST_TIMEOUT_MS }, async () => {
    const calls: JavaBatchOptions[] = [];
    const session = new ConversionSession({
      pool,
      parallelism: 4,
      runner: async (options) => {
        calls.push(options);
        return { exitCode: 0, signal: null, failedTaskCount: 0, durationMs: 0 };
      },
    });
    const config = await session.loadConfig(writeConfig(5, "2.23.7"));
    const selection = { items: flattenTreeItems(config.tree) };
    expect((await session.runConversion(selection)).state).toBe("succeeded");
    expect(calls).toHaveLength(4);
    calls.length = 0;
    const modernConfig = writeConfig(5, "2.24.0-beta");
    const modernJar = path.join(path.dirname(modernConfig), "converter.jar");
    expect((await session.runConversion(selection, { xresloaderPath: modernJar })).state).toBe(
      "succeeded",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.xresloaderArgs).toEqual(["--parallelism", "4"]);
    expect(session.getParallelism()).toBe(4);
  });

  it("新版单 JVM 返回的失败数进入批次汇总", { timeout: TEST_TIMEOUT_MS }, async () => {
    const session = new ConversionSession({
      pool,
      runner: async () => ({
        exitCode: 2,
        signal: null,
        failedTaskCount: 2,
        durationMs: 0,
      }),
    });
    const config = await session.loadConfig(writeConfig(5, "2.24.0-beta"));
    const summary = await session.runConversion({ items: flattenTreeItems(config.tree) });
    expect(summary).toMatchObject({ state: "failed", failedCount: 2, taskCount: 5 });
  });

  it("新版单 JVM 在途取消继续等待 runner 收尾", { timeout: TEST_TIMEOUT_MS }, async () => {
    const entered = Promise.withResolvers<JavaBatchOptions>();
    const finished = Promise.withResolvers<JavaBatchResult>();
    const session = new ConversionSession({
      pool,
      runner: async (options) => {
        entered.resolve(options);
        return finished.promise;
      },
    });
    const config = await session.loadConfig(writeConfig(5, "2.24.0-beta"));
    const running = session.runConversion({ items: flattenTreeItems(config.tree) });
    const options = await entered.promise;
    expect(options.xresloaderArgs).toEqual(["--parallelism", "auto"]);
    session.cancel();
    expect(options.signal?.aborted).toBe(true);
    expect(session.hasActiveRun()).toBe(true);
    finished.resolve({ exitCode: null, signal: "SIGTERM", failedTaskCount: 5, durationMs: 0 });
    expect((await running).state).toBe("cancelled");
    expect(session.hasActiveRun()).toBe(false);
  });

  it("读取 JAR 时可取消，取消后不启动 JVM", { timeout: TEST_TIMEOUT_MS }, async () => {
    const runner = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      failedTaskCount: 0,
      durationMs: 0,
    }));
    const session = new ConversionSession({ pool, runner });
    const config = await session.loadConfig(writeConfig(5, "2.24.0-beta"));
    const entered = Promise.withResolvers<AbortSignal>();
    vi.mocked(fsPromises.readFile).mockImplementationOnce((_file, options) => {
      const signal = (options as { signal: AbortSignal }).signal;
      entered.resolve(signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const running = session.runConversion({ items: flattenTreeItems(config.tree) });
    const signal = await Promise.race([entered.promise, running.then(() => null)]);
    expect(signal).not.toBeNull();
    session.cancel();
    expect(signal?.aborted).toBe(true);
    expect(await running).toMatchObject({ state: "cancelled", failedCount: 0, taskCount: 5 });
    expect(runner).not.toHaveBeenCalled();
    expect(session.hasActiveRun()).toBe(false);
  });

  it("相对 JAR 路径按有效工作目录读取版本", { timeout: TEST_TIMEOUT_MS }, async () => {
    const stats: RunnerStats = { calls: [], maxConcurrency: 0 };
    const session = new ConversionSession({ pool, runner: measuringRunner(stats, 1) });
    const config = await session.loadConfig(writeConfig(5, "2.23.7"));
    const modern = writeConfig(5, "2.24.0-beta");
    const summary = await session.runConversion(
      { items: flattenTreeItems(config.tree) },
      {
        workDir: path.dirname(modern),
        xresloaderPath: "converter.jar",
      },
    );
    expect(summary.state).toBe("succeeded");
    expect(stats.calls).toHaveLength(1);
    expect(stats.calls[0]?.xresloaderArgs).toEqual(["--parallelism", "auto"]);
  });

  it("并发 1：6 任务 → 1 分片 6 行，maxConcurrency=1", { timeout: TEST_TIMEOUT_MS }, async () => {
    const stats: RunnerStats = { calls: [], maxConcurrency: 0 };
    const session = new ConversionSession({
      pool,
      runner: measuringRunner(stats, 1),
      parallelism: 1,
    });
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
      runner: measuringRunner(stats, 4),
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
      runner: measuringRunner(stats, 16),
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
      runner: measuringRunner(stats, 3),
      parallelism: 16,
    });
    const config = await session.loadConfig(writeConfig(3));
    const summary = await session.runConversion({ items: flattenTreeItems(config.tree) });

    expect(summary.state).toBe("succeeded");
    expect(summary.taskCount).toBe(3);
    expect(stats.calls.length).toBe(3);
    expect(stats.maxConcurrency).toBe(3);
  });

  it("空任务：不 spawn java，succeeded", { timeout: TEST_TIMEOUT_MS }, async () => {
    const stats: RunnerStats = { calls: [], maxConcurrency: 0 };
    const session = new ConversionSession({
      pool,
      runner: measuringRunner(stats, 0),
      parallelism: 4,
    });
    await session.loadConfig(writeConfig(3)); // 空选择也需先加载配置（状态机要求）
    const readJar = vi.mocked(fsPromises.readFile).mockClear();
    const summary = await session.runConversion({ items: [] });

    expect(summary.state).toBe("succeeded");
    expect(summary.taskCount).toBe(0);
    expect(stats.calls.length).toBe(0);
    expect(readJar).not.toHaveBeenCalled();
  });
});
