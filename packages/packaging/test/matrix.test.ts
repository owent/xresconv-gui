import { describe, expect, it } from "vitest";
import { targetKey } from "../src/baseline.ts";
import { buildMatrix, releaseArtifacts, selectMatrix } from "../src/matrix.ts";
import { realTargetsFile } from "./fixtures.ts";

const VERSION = "3.0.0-dev.0";

describe("buildMatrix (CI-06 aggregate input)", () => {
  it("yields one row per shipped artifact with full metadata", () => {
    const matrix = buildMatrix(realTargetsFile(), VERSION);
    expect(matrix).toHaveLength(14);
    for (const row of matrix) {
      expect(row.name.length).toBeGreaterThan(0);
      expect(row.sha256Name).toBe(`${row.name}.sha256`);
      expect(row.version).toBe(VERSION);
      expect(row.targetTriple.length).toBeGreaterThan(0);
      expect(row.webviewStrategy.length).toBeGreaterThan(0);
      expect(row.distro).toBeNull();
    }
  });

  it("one row per artifact: macos/windows/bootstrap=1, linux offline=2 (AppImage + tar.zst)", () => {
    const matrix = buildMatrix(realTargetsFile(), VERSION);
    for (const row of matrix) {
      const expected =
        row.os === "linux" && row.variant === "offline" ? ["appimage", "tar.zst"] : undefined;
      if (expected) expect(expected).toContain(row.format);
      else if (row.os === "macos") expect(row.format).toBe("dmg");
      else if (row.os === "windows") expect(row.format).toBe("zip");
      else expect(row.format).toBe("tar.zst");
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

  it("artifact name set equals the per-target releaseArtifacts set (set-equality contract)", () => {
    const file = realTargetsFile();
    const fromMatrix = buildMatrix(file, VERSION)
      .map((row) => row.name)
      .sort();
    const fromNaming = file.targets
      .flatMap((t) => releaseArtifacts(t, VERSION).map((a) => a.name))
      .sort();
    expect(fromMatrix).toEqual(fromNaming);
    expect(new Set(fromMatrix).size).toBe(14);
  });

  it("format counts: zip 4, dmg 4, appimage 2, tar.zst 4", () => {
    const matrix = buildMatrix(realTargetsFile(), VERSION);
    const counts = new Map<string, number>();
    for (const row of matrix) {
      counts.set(row.format, (counts.get(row.format) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      zip: 4,
      dmg: 4,
      appimage: 2,
      "tar.zst": 4,
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
    "linux/-/x86_64/bootstrap",
    "linux/-/x86_64/offline",
  ];

  it("selects every artifact row of the requested keys, preserving metadata", () => {
    const matrix = buildMatrix(realTargetsFile(), VERSION);
    const selected = selectMatrix(matrix, CI_KEYS);
    // linux offline 选一行 key 带出两个产物（AppImage + tar.zst）
    expect(selected.map((row) => row.name)).toEqual([
      "xresconv-gui-3.0.0-dev.0-linux-x86_64-bootstrap.tar.zst",
      "xresconv-gui-3.0.0-dev.0-linux-x86_64-offline.AppImage",
      "xresconv-gui-3.0.0-dev.0-linux-x86_64-offline.tar.zst",
      "xresconv-gui-3.0.0-dev.0-macos-arm64-bootstrap.dmg",
      "xresconv-gui-3.0.0-dev.0-macos-arm64-offline.dmg",
      "xresconv-gui-3.0.0-dev.0-macos-x64-bootstrap.dmg",
      "xresconv-gui-3.0.0-dev.0-macos-x64-offline.dmg",
      "xresconv-gui-3.0.0-dev.0-windows-x64-bootstrap.zip",
      "xresconv-gui-3.0.0-dev.0-windows-x64-offline.zip",
    ]);
    for (const row of selected) {
      expect(matrix).toContain(row);
      expect(CI_KEYS).toContain(targetKey(row));
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
