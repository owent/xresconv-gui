import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  findLayoutRoot,
  resolvePortableTarget,
  verifyBundledNode,
  verifyLayoutIdentity,
  verifyLayoutPayload,
  verifyWindowsExtras,
} from "../src/verify-portable.ts";
import { pickTarget, sampleManifest } from "./fixtures.ts";

it("checks Windows executable architecture and variant attachments", () => {
  const root = fileURLToPath(new URL("../../../build/verify-windows-tests/", import.meta.url));
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(path.join(root, "case-"));
  const pe = Buffer.alloc(128);
  pe.writeUInt16LE(0x5a4d, 0);
  pe.writeUInt32LE(64, 0x3c);
  pe.writeUInt32LE(0x4550, 64);
  pe.writeUInt16LE(0xaa64, 68);
  try {
    const bootstrap = resolvePortableTarget("windows", "arm64", "bootstrap");
    writeFileSync(path.join(dir, "xresconv-gui.exe"), pe);
    expect(() => verifyWindowsExtras(dir, bootstrap)).toThrow();
    writeFileSync(path.join(dir, "MicrosoftEdgeWebview2Setup.exe"), "MZ sample");
    expect(() => verifyWindowsExtras(dir, bootstrap)).not.toThrow();
    expect(() =>
      verifyWindowsExtras(dir, resolvePortableTarget("windows", "x64", "bootstrap")),
    ).toThrow("architecture");
    const offline = resolvePortableTarget("windows", "arm64", "offline");
    expect(() => verifyWindowsExtras(dir, offline)).toThrow();
    mkdirSync(path.join(dir, "webview2-runtime"));
    writeFileSync(path.join(dir, "webview2-runtime/msedgewebview2.exe"), pe);
    writeFileSync(
      path.join(dir, "webview2-runtime-policy.json"),
      JSON.stringify({ locales: "all" }),
    );
    expect(() => verifyWindowsExtras(dir, offline)).not.toThrow();
    writeFileSync(
      path.join(dir, "webview2-runtime-policy.json"),
      JSON.stringify({ locales: "unknown" }),
    );
    expect(() => verifyWindowsExtras(dir, offline)).toThrow("locale policy");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

it("resolves real portable targets (macOS offline + Linux bootstrap/offline)", () => {
  expect(resolvePortableTarget("macos", "arm64", "offline").targetTriple).toBe(
    "aarch64-apple-darwin",
  );
  expect(resolvePortableTarget("linux", "aarch64", "offline").targetTriple).toBe(
    "aarch64-unknown-linux-gnu",
  );
  expect(resolvePortableTarget("linux", "x86_64", "bootstrap").webviewStrategy).toBe(
    "webkitgtk-system",
  );
  expect(() => resolvePortableTarget("linux", "mips64", "offline")).toThrow(
    /no declared portable target/,
  );
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
    variant: "offline",
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

it("verifies layout identity on the webview strategy axis for linux bootstrap targets", () => {
  const target = pickTarget(
    (t) => t.os === "linux" && t.arch === "x86_64" && t.variant === "bootstrap",
  );
  const manifest = sampleManifest(target);
  const expected = {
    os: "linux",
    arch: "x86_64",
    variant: "bootstrap",
    version: manifest.appVersion,
    commit: manifest.sourceCommit,
  } as const;
  expect(() => verifyLayoutIdentity(manifest, expected, target)).not.toThrow();
  expect(() =>
    verifyLayoutIdentity({ ...manifest, webviewStrategy: "webkitgtk-bundled" }, expected, target),
  ).toThrow(/identity mismatch: webviewStrategy/);
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
