import type { JavaBatchOptions, JavaBatchResult, ScriptWorkerPool } from "@xresconv/guardian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flattenTreeItems } from "../../src/domain/selection.ts";
import { LogPipeline } from "../../src/service/log-pipeline.ts";
import { ConversionSession } from "../../src/service/session.ts";
import { fixture, startPool, TEST_TIMEOUT_MS, waitUntil } from "./helpers.ts";

const success: JavaBatchResult = { exitCode: 0, signal: null, failedTaskCount: 0, durationMs: 1 };

describe("conversion lifecycle regressions", () => {
  let pool: ScriptWorkerPool;
  beforeAll(async () => {
    pool = await startPool();
  }, TEST_TIMEOUT_MS);
  afterAll(async () => {
    await pool.shutdown();
  }, TEST_TIMEOUT_MS);

  it(
    "keeps cancellation nonterminal until the runner is reaped and prevents reload/reentry",
    async () => {
      const reap = Promise.withResolvers<JavaBatchResult>();
      let started = false;
      const session = new ConversionSession({
        pool,
        runner: async () => {
          started = true;
          return reap.promise;
        },
      });
      const config = await session.loadConfig(fixture("run-hooks.xml"));
      const selection = { items: flattenTreeItems(config.tree) };
      const running = session.runConversion(selection);
      await waitUntil(() => started, "runner start");
      session.cancel();
      try {
        expect(session.getState()).not.toBe("cancelled");
        await expect(session.runConversion(selection)).rejects.toThrow(/cannot start a run/);
        await expect(session.loadConfig(fixture("run-hooks.xml"))).rejects.toThrow();
      } finally {
        reap.resolve(success);
        await running;
        await session.dispose();
      }
      expect(session.getState()).toBe("cancelled");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "freezes the planned selection before asynchronous before hooks",
    async () => {
      const calls: JavaBatchOptions[] = [];
      const session = new ConversionSession({
        pool,
        runner: async (options) => {
          calls.push(options);
          return success;
        },
      });
      const config = await session.loadConfig(fixture("run-hooks.xml"));
      const selection = { items: flattenTreeItems(config.tree) };
      const originalFile = selection.items[0]?.file;
      const running = session.runConversion(selection);
      const selected = selection.items[0];
      if (!selected) throw new Error("fixture item missing");
      selected.file = "mutated-after-start.xlsx";
      selection.items.splice(0);
      const result = await running;
      expect(result.taskCount).toBe(1);
      expect(calls[0]?.tasks.join(" ")).toContain(originalFile);
      await session.dispose();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "counts an encoding rejection once when the remaining batch fails to spawn",
    async () => {
      const session = new ConversionSession({
        pool,
        parallelism: 1,
        runner: async () => {
          throw new Error("spawn failed");
        },
      });
      const config = await session.loadConfig(fixture("run-shards.xml"));
      const items = flattenTreeItems(config.tree).slice(0, 2);
      const first = items[0];
      if (!first) throw new Error("fixture item missing");
      first.file = "cannot\nencode.xlsx";
      first.scheme = "sheet";
      const result = await session.runConversion({ items });
      expect(result.failedCount).toBe(2);
      await session.dispose();
    },
    TEST_TIMEOUT_MS,
  );

  it("rejects nonfinite parallelism instead of reporting a run with zero dispatched jobs successful", () => {
    expect(() => new ConversionSession({ pool, parallelism: Number.NaN })).toThrow();
  });

  it("does not recursively hook late logs from a completed on_append_log invocation", async () => {
    const pipeline = new LogPipeline();
    const session = new ConversionSession({ pool, pipeline });
    let hookCalls = 0;
    pipeline.hookRunner = async () => {
      hookCalls++;
    };
    pool.onLog?.({
      protocol_version: 1,
      kind: "log",
      role: "script-worker",
      id: "late-log",
      payload: {
        invocation_id: "completed",
        entry_kind: "on_append_log",
        level: "info",
        message: "late",
      },
    });
    await pipeline.drain();
    expect(hookCalls).toBe(0);
    expect(pipeline.snapshot().at(-1)?.message).toBe("late");
    await session.dispose();
  });

  it(
    "dispose waits for the cancelled runner before draining and rejects subsequent runs",
    async () => {
      const reap = Promise.withResolvers<JavaBatchResult>();
      let started = false;
      const session = new ConversionSession({
        pool,
        runner: async () => {
          started = true;
          return reap.promise;
        },
      });
      const config = await session.loadConfig(fixture("run-hooks.xml"));
      const selection = { items: flattenTreeItems(config.tree) };
      const running = session.runConversion(selection);
      await waitUntil(() => started, "runner start");
      let disposed = false;
      const disposing = session.dispose().then(() => {
        disposed = true;
      });
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(disposed).toBe(false);
        await expect(session.runConversion(selection)).rejects.toThrow(/disposed/);
      } finally {
        reap.resolve(success);
        await Promise.all([running, disposing]);
      }
      expect(disposed).toBe(true);
      expect(session.getState()).toBe("cancelled");
    },
    TEST_TIMEOUT_MS,
  );
});
