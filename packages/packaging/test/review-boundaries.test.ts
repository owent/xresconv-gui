import { expect, it } from "vitest";
import { lintManifest } from "../src/lint.ts";
import { validateRuntimeManifest, validateTargets } from "../src/load.ts";
import { buildMatrix } from "../src/matrix.ts";
import { pickTarget, realTargetsFile, sampleManifest } from "./fixtures.ts";

it("redacts detected secret values from findings and thrown diagnostics", () => {
  const synthetic = `ghp_${"SyntheticTestValue".repeat(3)}`;
  const findings = lintManifest({ token: synthetic });
  expect(findings.length).toBeGreaterThan(0);
  expect(JSON.stringify(findings)).not.toContain(synthetic);
  const manifest = sampleManifest(pickTarget((t) => t.os === "windows"));
  manifest.nodeHash.source = synthetic;
  try {
    validateRuntimeManifest(manifest);
  } catch (error) {
    expect(JSON.stringify(error)).not.toContain(synthetic);
    return;
  }
  throw new Error("expected manifest rejection");
});

it.each(["../outside", "/opt/app", "bin/../../outside", "C:relative", "bin\\app"])(
  "rejects nonportable installed file path %s",
  (file) => {
    const manifest = sampleManifest(pickTarget((t) => t.os === "windows"));
    const entry = manifest.files[0];
    if (!entry) throw new Error("missing fixture");
    entry.path = file;
    expect(() => validateRuntimeManifest(manifest)).toThrow();
  },
);

it("rejects a build target with a triple for another architecture", () => {
  const file = structuredClone(realTargetsFile());
  const target = file.targets.find((t) => t.os === "windows" && t.arch === "x64");
  if (!target) throw new Error("missing target");
  target.targetTriple = "aarch64-pc-windows-msvc";
  expect(() => validateTargets(file)).toThrow();
});

it("does not generate a successful incomplete release matrix", () => {
  const file = realTargetsFile();
  expect(() => buildMatrix({ ...file, targets: file.targets.slice(1) }, "3.0.0")).toThrow();
});

it("rejects a structurally valid manifest with an incoherent runtime strategy", () => {
  const manifest = sampleManifest(pickTarget((t) => t.os === "windows"));
  manifest.webviewStrategy = "system-only";
  expect(() => validateRuntimeManifest(manifest)).toThrow();
});
