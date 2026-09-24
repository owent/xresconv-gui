import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  isTerminal,
  RUN_STATES,
} from "../src/domain/run-state.ts";

describe("run state machine", () => {
  it("marks exactly succeeded/failed/cancelled as terminal", () => {
    expect(isTerminal("succeeded")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    for (const s of RUN_STATES) {
      if (!["succeeded", "failed", "cancelled"].includes(s)) {
        expect(isTerminal(s)).toBe(false);
      }
    }
  });

  it("allows the happy path", () => {
    const path = [
      "idle",
      "loading",
      "ready",
      "before_hooks",
      "converting",
      "after_hooks",
      "succeeded",
    ] as const;
    for (let i = 0; i + 1 < path.length; i++) {
      const from = path[i];
      const to = path[i + 1];
      if (from === undefined || to === undefined) {
        throw new Error("test setup error: path index out of range");
      }
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it("allows failure/cancel from every active state", () => {
    for (const s of ["loading", "before_hooks", "converting", "after_hooks"] as const) {
      expect(canTransition(s, "failed")).toBe(true);
      expect(canTransition(s, "cancelled")).toBe(true);
    }
  });

  it("rejects impossible jumps", () => {
    expect(canTransition("idle", "converting")).toBe(false);
    expect(canTransition("succeeded", "converting")).toBe(false);
    expect(() => assertTransition("idle", "succeeded")).toThrow(/illegal run-state/);
  });
});
