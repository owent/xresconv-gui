import { describe, expect, it } from "vitest";
import { targetKey } from "../src/baseline.ts";
import { artifactName, buildMatrix, selectMatrix } from "../src/matrix.ts";
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

describe("selectMatrix (release CI built-subset verification)", () => {
  // release.yml 当前实际构建的目标（与三个 build job 的 matrix 同步维护）
  const CI_KEYS = [
    "windows/-/x64/bootstrap",
    "windows/-/x64/offline",
    "macos/-/x64/bootstrap",
    "macos/-/x64/offline",
    "macos/-/arm64/bootstrap",
    "macos/-/arm64/offline",
    "linux/ubuntu-22.04/x86_64/bootstrap",
    "linux/-/x86_64/offline",
    "linux/ubuntu-24.04/x86_64/bootstrap",
  ];

  it("selects exactly the requested keys, preserving full row metadata", () => {
    const matrix = buildMatrix(realTargetsFile(), VERSION);
    const selected = selectMatrix(matrix, CI_KEYS);
    expect(selected.map((row) => targetKey(row))).toEqual(CI_KEYS);
    for (const row of selected) {
      expect(matrix).toContain(row);
      expect(row.sha256Name).toBe(`${row.name}.sha256`);
    }
  });

  it("fails closed on a key outside the full matrix (typo guard)", () => {
    const matrix = buildMatrix(realTargetsFile(), VERSION);
    expect(() => selectMatrix(matrix, [...CI_KEYS, "windows/-/x64/typo"])).toThrow(
      /windows\/-\/x64\/typo/,
    );
  });

  it("fails closed on duplicate keys", () => {
    const matrix = buildMatrix(realTargetsFile(), VERSION);
    expect(() => selectMatrix(matrix, [CI_KEYS[0] as string, CI_KEYS[0] as string])).toThrow(
      /duplicate/,
    );
  });

  it("fails closed on an empty key list (guard against a vacuous verify)", () => {
    const matrix = buildMatrix(realTargetsFile(), VERSION);
    expect(() => selectMatrix(matrix, [])).toThrow(/no target keys/);
  });
});
