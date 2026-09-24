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

  it("circular script mutation degrades to a per-op diagnostic, completion is kept (BD-S17)", async () => {
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
    // BD-S17：脚本本身没有失败；不可序列化的 op 降级为诊断，不再整体判 error。
    expect(result.outcome).toBe("resolved");
    const diagnostics = (result.ops ?? []).filter((op) => op.op === "diagnostic");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: "OP_SERIALIZE_FAILED" });
  });
});
