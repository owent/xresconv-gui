import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  findLayoutRoot,
  resolvePortableTarget,
  verifyBundledNode,
  verifyLayoutIdentity,
  verifyLayoutPayload,
} from "../src/verify-portable.ts";
import { pickTarget, sampleManifest } from "./fixtures.ts";

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

it("resolves real portable targets (macOS + Linux offline)", () => {
  expect(resolvePortableTarget("macos", "arm64").targetTriple).toBe("aarch64-apple-darwin");
  expect(resolvePortableTarget("linux", "aarch64").targetTriple).toBe("aarch64-unknown-linux-gnu");
  expect(() => resolvePortableTarget("linux", "mips64")).toThrow(/no declared portable target/);
});

it("finds the layout root under macOS .app and AppImage extraction shapes", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "portable-root-"));
  try {
    const macLayout = path.join(dir, "xresconv-gui.app", "Contents", "Resources");
    mkdirSync(path.join(macLayout, "runtime"), { recursive: true });
    writeFileSync(path.join(macLayout, "runtime-manifest.json"), "{}");
    expect(findLayoutRoot(path.join(dir, "xresconv-gui.app"))).toBe(macLayout);

    const appLayout = path.join(dir, "squashfs-root", "usr", "lib", "xresconv-gui");
    mkdirSync(appLayout, { recursive: true });
    writeFileSync(path.join(appLayout, "runtime-manifest.json"), "{}");
    expect(findLayoutRoot(path.join(dir, "squashfs-root"))).toBe(appLayout);

    const empty = mkdtempSync(path.join(os.tmpdir(), "portable-empty-"));
    try {
      expect(() => findLayoutRoot(empty)).toThrow(/not found/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("verifies layout identity strictly against the target and current build", () => {
  const target = pickTarget(
    (t) => t.os === "macos" && t.arch === "arm64" && t.variant === "offline",
  );
  const manifest = sampleManifest(target);
  const expected = {
    os: "macos",
    arch: "arm64",
    version: manifest.appVersion,
    commit: manifest.sourceCommit,
  } as const;
  expect(() => verifyLayoutIdentity(manifest, expected, target)).not.toThrow();
  expect(() =>
    verifyLayoutIdentity(manifest, { ...expected, commit: "f".repeat(40) }, target),
  ).toThrow(/identity mismatch/);
  expect(() => verifyLayoutIdentity({ ...manifest, os: "linux" }, expected, target)).toThrow(
    /identity mismatch/,
  );
});

it("verifies every payload file byte-for-byte and rejects tampering", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "portable-payload-"));
  try {
    const content = "payload bytes";
    mkdirSync(path.join(dir, "runtime"), { recursive: true });
    mkdirSync(path.join(dir, "app"));
    writeFileSync(path.join(dir, "runtime", "node"), content);
    writeFileSync(path.join(dir, "app", "service.mjs"), content);
    const target = pickTarget((t) => t.os === "linux" && t.variant === "offline");
    const manifest = sampleManifest(target);
    manifest.files = [
      {
        path: "runtime/node",
        size: content.length,
        sha256: digest(content),
        origin: "local-build:node",
        license: "MIT",
      },
      {
        path: "app/service.mjs",
        size: content.length,
        sha256: digest(content),
        origin: "build:@xresconv/guardian",
        license: "MIT",
      },
    ];
    expect(() => verifyLayoutPayload(dir, manifest)).not.toThrow();

    writeFileSync(path.join(dir, "runtime", "node"), "tampered bytes");
    expect(() => verifyLayoutPayload(dir, manifest)).toThrow(/payload mismatch/);

    writeFileSync(path.join(dir, "runtime", "node"), content);
    rmSync(path.join(dir, "app", "service.mjs"));
    expect(() => verifyLayoutPayload(dir, manifest)).toThrow(/payload missing/);

    manifest.files = [];
    expect(() => verifyLayoutPayload(dir, manifest)).toThrow(/empty/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("probes the bundled node binary and requires the manifest version", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "portable-node-"));
  try {
    mkdirSync(path.join(dir, "runtime"), { recursive: true });
    const nodeName = process.platform === "win32" ? "node.exe" : "node";
    copyFileSync(process.execPath, path.join(dir, "runtime", nodeName));
    const manifest = sampleManifest(pickTarget((t) => t.os === "macos"));
    manifest.nodeVersion = process.versions.node;
    expect(verifyBundledNode(dir, manifest)).toBe(process.version);

    manifest.nodeVersion = "9.9.9";
    expect(() => verifyBundledNode(dir, manifest)).toThrow(/does not match manifest/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
