import { describe, expect, it } from "vitest";
import { LogPipeline } from "../../src/service/log-pipeline.ts";

describe("log processing budgets", () => {
  it("bounds queued hook work during a log storm and retains raw overflow records", async () => {
    const pipeline = new LogPipeline({ capacity: 3 });
    const gate = Promise.withResolvers<void>();
    let calls = 0;
    pipeline.hookRunner = async (record) => {
      calls++;
      await gate.promise;
      record.message = "changed";
    };
    const pending = Array.from({ length: 20 }, (_, i) => pipeline.info(`raw-${i}`));
    gate.resolve();
    const records = await Promise.all(pending);
    await pipeline.drain();
    expect(calls).toBeLessThanOrEqual(3);
    expect(records.some((record) => record.message.startsWith("raw-"))).toBe(true);
    expect(pipeline.snapshot()).toHaveLength(3);
  });
  it("rejects nonfinite capacity", () => {
    expect(() => new LogPipeline({ capacity: Number.NaN })).toThrow();
  });
});
