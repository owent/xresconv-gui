import { describe, expect, it } from "vitest";
import { baselineKeys, targetKey } from "../src/baseline.ts";
import { lintManifest } from "../src/lint.ts";
import { loadTargets } from "../src/load.ts";
import type { ReleaseTarget } from "../src/types.ts";

describe("packaging/targets.json (positive)", () => {
  it("loads and passes schema + D1/D2 semantic validation", () => {
    const file = loadTargets();
    expect(file.schemaVersion).toBe(1);
    expect(file.targets).toHaveLength(22);
  });

  it("target identity set equals the D1/D2 baseline exactly", () => {
    const file = loadTargets();
    const keys = file.targets.map((target) => targetKey(target)).sort();
    expect(keys).toEqual(baselineKeys());
    expect(baselineKeys()).toHaveLength(22);
  });

  it("per-os/variant counts: windows 4, macos 4, linux bootstrap 12, linux offline 2", () => {
    const { targets } = loadTargets();
    const count = (pred: (target: ReleaseTarget) => boolean) => targets.filter(pred).length;
    expect(count((t) => t.os === "windows")).toBe(4);
    expect(count((t) => t.os === "macos")).toBe(4);
    expect(count((t) => t.os === "linux" && t.variant === "bootstrap")).toBe(12);
    expect(count((t) => t.os === "linux" && t.variant === "offline")).toBe(2);
  });

  it("ships no 32-bit arch and passes the manifest hygiene lint", () => {
    const file = loadTargets();
    const forbidden = ["ia32", "x86", "armv7l", "armv7"];
    expect(file.targets.every((t) => !forbidden.includes(t.arch))).toBe(true);
    expect(lintManifest(file)).toEqual([]);
  });

  it("every target pins the bundled Node major line", () => {
    const file = loadTargets();
    expect(file.targets.every((t) => t.nodeVersion === "24")).toBe(true);
  });
});
