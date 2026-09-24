import { loadTargets } from "../src/load.ts";
import type { ReleaseTarget, RuntimeManifest, TargetsFile } from "../src/types.ts";

export function realTargetsFile(): TargetsFile {
  return loadTargets();
}

export function cloneTargets(file: TargetsFile = realTargetsFile()): ReleaseTarget[] {
  return structuredClone(file.targets);
}

/** Wraps a target list as raw (unvalidated) targets-file data. */
export function asData(targets: readonly ReleaseTarget[]): unknown {
  return { schemaVersion: 1, targets };
}

export const SAMPLE_SHA256 = "a".repeat(64);
export const SAMPLE_COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** A schema-valid runtime manifest for the given target (well-formed fake hashes). */
export function sampleManifest(target: ReleaseTarget): RuntimeManifest {
  const manifest: RuntimeManifest = {
    schemaVersion: 1,
    appVersion: "3.0.0-dev.0",
    sourceCommit: SAMPLE_COMMIT,
    targetTriple: target.targetTriple,
    os: target.os,
    osVersionRange: target.osVersionRange,
    arch: target.arch,
    variant: target.variant,
    webviewStrategy: target.webviewStrategy,
    minimumWebview: target.minimumWebview,
    runtimePayloads: [
      "shell",
      "frontend",
      "node-runtime",
      "backend-js",
      "guardian-js",
      "script-host-js",
      "npm-modules",
      "resources",
    ],
    nodeVersion: "24.21.0",
    nodeHash: {
      sha256: SAMPLE_SHA256,
      source: "https://nodejs.org/dist/v24.21.0/SHASUMS256.txt",
    },
    moduleTreeHash: SAMPLE_SHA256,
    nativeAddonAbi: { nodeAbi: "137", modules: [] },
    files: [
      {
        path: "bin/xresconv-gui",
        size: 4096,
        sha256: SAMPLE_SHA256,
        origin: "build:apps/desktop",
        license: "MIT",
      },
    ],
    signingEvidence: [],
    buildToolchain: {
      runnerOs: "windows-latest",
      runnerArch: "x64",
      nodeVersion: "24.21.0",
      yarnVersion: "4.18.0",
      tauriCliVersion: "2.11.5",
    },
    repositorySnapshot: {
      repository: "https://github.com/xresloader/xresconv-gui.git",
      commit: SAMPLE_COMMIT,
      dirty: false,
    },
    verificationReport: {
      result: "pass",
      reportPath: "reports/sample.md",
      testedAt: "2026-09-24T00:00:00Z",
    },
  };
  if (target.distro !== undefined) {
    manifest.distro = target.distro;
  }
  return manifest;
}

/** Picks the first real target matching a predicate; fails the test when absent. */
export function pickTarget(pred: (target: ReleaseTarget) => boolean): ReleaseTarget {
  const target = realTargetsFile().targets.find(pred);
  if (!target) {
    throw new Error("no real target matches the predicate");
  }
  return target;
}
