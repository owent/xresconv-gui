import { describe, expect, it } from "vitest";
import { matchGlob, matchRegex } from "../src/index.js";

describe("compat-service skeleton", () => {
  it("matches globs with minimatch semantics", () => {
    expect(matchGlob("*.bin", "role_cfg.bin")).toBe(true);
    expect(matchGlob("*.bin", "role_cfg.json")).toBe(false);
  });

  it("matches valid regex", () => {
    expect(matchRegex("\\.bin$", "role_cfg.bin")).toBe(true);
    expect(matchRegex("\\.bin$", "role_cfg.json")).toBe(false);
    expect(matchRegex("(?i:\\.BIN)$", "role_cfg.bin")).toBe(true);
  });

  it("falls back to exact match on invalid regex (P0-04 legacy behaviour)", () => {
    expect(matchRegex("(", "(")).toBe(true);
    expect(matchRegex("(", "anything-else")).toBe(false);
  });
});
