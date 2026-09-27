import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  detectDistro,
  nativeArch,
  parsePackageArgs,
  selectArtifact,
  verifyReusableLayout,
} from "../src/package-cli.ts";
import { pickTarget, sampleManifest } from "./fixtures.ts";

it("rejects unknown option prefixes and invalid variants", () => {
  expect(() => parsePackageArgs(["--variant-bogus=offline"])).toThrow();
  expect(() => parsePackageArgs(["--variant=unknown"])).toThrow();
  expect(parsePackageArgs(["--variant", "offline", "--skip-assemble"])).toMatchObject({
    variant: "offline",
    "skip-assemble": true,
  });
  expect(parsePackageArgs(["--portable", "--variant=offline"])).toMatchObject({
    portable: true,
    variant: "offline",
  });
  expect(parsePackageArgs([])).toMatchObject({ portable: false, variant: "all" });
});
it("preserves an exact Ubuntu baseline and rejects a foreign native host", () => {
  expect(detectDistro('ID=ubuntu\nVERSION_ID="24.10"')).toBe("ubuntu-24.10");
  expect(nativeArch("linux", "linux", "arm64")).toBe("aarch64");
  expect(() => nativeArch("macos", "win32", "x64")).toThrow(/native/);
});
it("does not reuse a bootstrap payload as an offline manifest, or trust modified files", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "package-reuse-"));
  const target = pickTarget(
    (t) => t.os === "windows" && t.arch === "x64" && t.variant === "bootstrap",
  );
  const manifest = sampleManifest(target);
  try {
    mkdirSync(path.join(dir, "app"));
    const content = "runtime payload";
    manifest.files = [
      {
        path: "app/service.mjs",
        size: Buffer.byteLength(content),
        sha256: createHash("sha256").update(content).digest("hex"),
        origin: "build:@xresconv/backend",
        license: "MIT",
      },
    ];
    writeFileSync(path.join(dir, "app/service.mjs"), content);
    writeFileSync(path.join(dir, "runtime-manifest.json"), JSON.stringify(manifest));
    expect(
      verifyReusableLayout(dir, target, manifest.appVersion, manifest.sourceCommit).variant,
    ).toBe("bootstrap");
    expect(() =>
      verifyReusableLayout(
        dir,
        { ...target, variant: "offline" },
        manifest.appVersion,
        manifest.sourceCommit,
      ),
    ).toThrow(/variant/);
    writeFileSync(path.join(dir, "app/service.mjs"), "tampered");
    expect(() =>
      verifyReusableLayout(dir, target, manifest.appVersion, manifest.sourceCommit),
    ).toThrow(/payload mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("selects a fresh RPM and never renames stale or ambiguous output", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "package-output-"));
  try {
    writeFileSync(path.join(dir, "old.rpm"), "old");
    utimesSync(path.join(dir, "old.rpm"), 1, 1);
    writeFileSync(path.join(dir, "new.deb"), "deb");
    expect(() => selectArtifact(dir, ".rpm", 2000)).toThrow(/found 0/);
    writeFileSync(path.join(dir, "new.rpm"), "rpm");
    expect(readFileSync(selectArtifact(dir, ".rpm", 2000), "utf8")).toBe("rpm");
    writeFileSync(path.join(dir, "duplicate.rpm"), "rpm");
    expect(() => selectArtifact(dir, ".rpm", 2000)).toThrow(/found 2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
