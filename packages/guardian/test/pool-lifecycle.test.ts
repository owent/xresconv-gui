import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ScriptWorkerPool } from "../src/script-worker.ts";

describe("pool startup lifecycle", () => {
  it("rejects an invalid health payload or channel role", async () => {
    const pool = new ScriptWorkerPool({
      workerEntry: fileURLToPath(new URL("./fixtures/bad-health.mjs", import.meta.url)),
    });
    try {
      await expect(pool.start()).rejects.toThrow();
    } finally {
      await pool.shutdown();
    }
  }, 10000);

  it("all concurrent start callers await the same handshake", async () => {
    const pool = new ScriptWorkerPool();
    try {
      const first = pool.start();
      await pool.start();
      expect(pool.stats()).toHaveLength(1);
      await first;
    } finally {
      await pool.shutdown();
    }
  }, 10000);

  it("shutdown during startup leaves no child to become ready later", async () => {
    const pool = new ScriptWorkerPool();
    const started = pool.start().catch(() => undefined);
    await pool.shutdown();
    await started;
    try {
      expect(pool.stats()).toHaveLength(0);
    } finally {
      // Explicit cleanup protects the test even on the pre-fix pool.
      for (const stat of pool.stats()) if (stat.pid) process.kill(stat.pid, "SIGKILL");
    }
  }, 10000);

  it("rejects invalid size rather than starting an empty or unbounded pool", () => {
    for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(() => new ScriptWorkerPool({ size })).toThrow();
    }
  });
});
