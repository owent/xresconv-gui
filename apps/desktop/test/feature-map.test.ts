import { describe, expect, it } from "vitest";
import { APP_REGIONS, FEATURE_MAP } from "../src/app/feature-map";

// UI01：所有 F 功能能映射到明确区域（docs/plan/04-ui.md §P4 任务清单 P4-01）。
const EXPECTED_FEATURE_IDS = [
  "F01",
  "F02",
  "F03",
  "F04",
  "F05",
  "F06",
  "F07",
  "F08",
  "F09",
  "F10",
  "F11",
  "F12",
];

describe("feature map (F01–F12 → UI 区域)", () => {
  it("covers F01–F12 exactly once, in order", () => {
    expect(FEATURE_MAP.map((feature) => feature.id)).toEqual(EXPECTED_FEATURE_IDS);
  });

  it("maps every feature to at least one known region", () => {
    for (const feature of FEATURE_MAP) {
      expect(feature.regions.length, `${feature.id} has no region`).toBeGreaterThan(0);
      for (const region of feature.regions) {
        expect(
          (APP_REGIONS as readonly string[]).includes(region),
          `${feature.id} references unknown region ${region}`,
        ).toBe(true);
      }
      expect(feature.summary.length, `${feature.id} has no summary`).toBeGreaterThan(0);
      expect(feature.legacySource.length, `${feature.id} has no legacy source`).toBeGreaterThan(0);
    }
  });

  it("gives every shell region at least one feature (no dead panels)", () => {
    const used = new Set(FEATURE_MAP.flatMap((feature) => feature.regions));
    for (const region of APP_REGIONS) {
      expect(used.has(region), `region ${region} hosts no feature`).toBe(true);
    }
  });

  it("tracks wiring status: F02/F03 wired (P4-03), rest skeleton", () => {
    for (const feature of FEATURE_MAP) {
      expect(["skeleton", "wired"], `${feature.id} has invalid status`).toContain(feature.status);
    }
    const wired = FEATURE_MAP.filter((feature) => feature.status === "wired").map((f) => f.id);
    expect(wired).toEqual(["F02", "F03"]);
  });
});
