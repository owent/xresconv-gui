import { describe, expect, it } from "vitest";
import { healthCheck } from "../src/index.js";

describe("script-host skeleton", () => {
  it("reports a healthy handshake shape", () => {
    const h = healthCheck();
    expect(h.ok).toBe(true);
    expect(h.pid).toBe(process.pid);
    expect(h.node).toMatch(/^v\d+\./);
  });
});
