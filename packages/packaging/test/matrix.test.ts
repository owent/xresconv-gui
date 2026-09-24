import { describe, expect, it } from "vitest";
import { targetKey } from "../src/baseline.ts";
import { artifactName, buildMatrix } from "../src/matrix.ts";
import { realTargetsFile } from "./fixtures.ts";

const VERSION = "3.0.0-dev.0";

describe("buildMatrix (CI-06 aggregate input)", () => {
  it("contains one row per target with full metadata", () => {
    const matrix = buildMatrix(realTargetsFile(), VERSION);
    expect(matrix).toHaveLength(22);
    for (const row of matrix) {
      expect(row.name.length).toBeGreaterThan(0);
      expect(row.sha256Name).toBe(`${row.name}.sha256`);
      expect(row.version).toBe(VERSION);
      expect(row.targetTriple.length).toBeGreaterThan(0);
      expect(row.webviewStrategy.length).toBeGreaterThan(0);
      if (row.os === "linux" && row.variant === "bootstrap") {
        expect(row.distro).not.toBeNull();
      } else {
        expect(row.distro).toBeNull();
      }
    }
  });

  it("is sorted by identity key and deterministic (two runs byte-identical)", () => {
    const file = realTargetsFile();
    const first = buildMatrix(file, VERSION);
    const keys = first.map((row) => targetKey(row));
    expect(keys).toEqual([...keys].sort());
    const second = buildMatrix(file, VERSION);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });

  it("artifact name set equals the per-target naming set (set-equality contract)", () => {
    const file = realTargetsFile();
    const fromMatrix = buildMatrix(file, VERSION)
      .map((row) => row.name)
      .sort();
    const fromNaming = file.targets.map((t) => artifactName(t, VERSION)).sort();
    expect(fromMatrix).toEqual(fromNaming);
    expect(new Set(fromMatrix).size).toBe(22);
  });

  it("format counts: nsis 4, dmg 4, deb 8, rpm 4, appimage 2", () => {
    const matrix = buildMatrix(realTargetsFile(), VERSION);
    const counts = new Map<string, number>();
    for (const row of matrix) {
      counts.set(row.format, (counts.get(row.format) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      nsis: 4,
      dmg: 4,
      deb: 8,
      rpm: 4,
      appimage: 2,
    });
  });
});
