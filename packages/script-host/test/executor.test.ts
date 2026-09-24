import { afterEach, describe, expect, it, vi } from "vitest";
import { type ExecutorHooks, executeInvocation } from "../src/executor.ts";

const hooks: ExecutorHooks = { emitLog() {}, requestDialog() {}, registerDialogCallbacks() {} };
afterEach(() => vi.useRealTimers());
describe("executor completion", () => {
  it("does not retain a timeout after synchronous resolve", async () => {
    vi.useFakeTimers();
    const result = await executeInvocation(
      {
        invocation_id: "timer",
        entry_kind: "button",
        filename: "test.js",
        source: "resolve();",
        timeout_ms: 30000,
        context: {},
      },
      hooks,
    );
    expect(result.outcome).toBe("resolved");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns a bounded diagnostic for a circular script mutation instead of losing completion", async () => {
    const result = await executeInvocation(
      {
        invocation_id: "cycle",
        entry_kind: "set_name",
        filename: "test.js",
        source: "item_data.extra = {}; item_data.extra.self = item_data.extra;",
        timeout_ms: 1000,
        context: { item_data: { name: "test" } },
      },
      hooks,
    );
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(result.outcome).toBe("error");
  });
});
