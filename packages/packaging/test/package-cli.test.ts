import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  detectDistro,
  nativeArch,
  parseFixedRuntimeLinks,
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

it("parses Fixed Version runtime links from the download page HTML (u002F escapes, highest version per arch)", () => {
  // 2026-09-28 实抓页面片段形态：链接以字面 \u002F 转义内嵌（无需 JS 渲染），
  // 同架构多版本并存时取最高版本；裸斜杠链接同样接受。
  const html = [
    'x: "msedge.sf.dl.delivery.mp.microsoft.com\\u002Ffilestreamingservice\\u002Ffiles\\u002Fb82d47e8-d146-4563-94d1-3a3176b25c0a\\u002FMicrosoft.WebView2.FixedVersionRuntime.153.0.4234.48.x64.cab",',
    'y: "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/125acdc1-7d47-4c37-b4b9-b2452c6ec327/Microsoft.WebView2.FixedVersionRuntime.154.0.4258.37.x64.cab",',
    'z: "msedge.sf.dl.delivery.mp.microsoft.com\\u002Ffilestreamingservice\\u002Ffiles\\u002F14402c3c-0447-4db8-92e4-f79b20be8387\\u002FMicrosoft.WebView2.FixedVersionRuntime.154.0.4258.37.arm64.cab",',
  ].join("\n");
  const links = parseFixedRuntimeLinks(html);
  expect(links.size).toBe(2);
  const x64 = links.get("x64");
  if (!x64) throw new Error("x64 link missing");
  expect(x64.version).toBe("154.0.4258.37");
  expect(x64.url).toBe(
    "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/125acdc1-7d47-4c37-b4b9-b2452c6ec327/Microsoft.WebView2.FixedVersionRuntime.154.0.4258.37.x64.cab",
  );
  expect(links.get("arm64")?.version).toBe("154.0.4258.37");
});

it("returns no Fixed Version links for a page whose markup changed (fail-closed downstream)", () => {
  expect(parseFixedRuntimeLinks("<html>download button only</html>").size).toBe(0);
});
