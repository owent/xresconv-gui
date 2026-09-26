import { describe, expect, it } from "vitest";
import { PackagingError } from "../src/errors.ts";
import { lintManifest } from "../src/lint.ts";
import { validateRuntimeManifest } from "../src/load.ts";
import type { RuntimeManifest } from "../src/types.ts";
import { pickTarget, sampleManifest } from "./fixtures.ts";

function expectManifestError(manifest: unknown, code: PackagingError["code"]): PackagingError {
  try {
    validateRuntimeManifest(manifest);
  } catch (error) {
    expect(error).toBeInstanceOf(PackagingError);
    expect((error as PackagingError).code).toBe(code);
    return error as PackagingError;
  }
  throw new Error(`expected PackagingError(${code}), but nothing was thrown`);
}

describe("runtime-manifest schema (artifact side)", () => {
  it("accepts well-formed manifests for windows/macos/linux targets", () => {
    const targets = [
      pickTarget((t) => t.os === "windows" && t.variant === "bootstrap"),
      pickTarget((t) => t.os === "windows" && t.variant === "offline"),
      pickTarget((t) => t.os === "macos" && t.arch === "arm64"),
      pickTarget((t) => t.distro === "ubuntu-22.04" && t.arch === "x86_64"),
      pickTarget((t) => t.distro === "fedora-43"),
      pickTarget((t) => t.os === "linux" && t.variant === "offline"),
    ];
    for (const target of targets) {
      const manifest = validateRuntimeManifest(sampleManifest(target));
      expect(manifest.targetTriple).toBe(target.targetTriple);
      expect(manifest.os).toBe(target.os);
    }
  });

  it("rejects manifests missing required runtime-filled fields", () => {
    const manifest = sampleManifest(pickTarget((t) => t.os === "windows")) as unknown as Record<
      string,
      unknown
    >;
    delete manifest.files;
    const error = expectManifestError(manifest, "SCHEMA_VIOLATION");
    expect(error.message).toContain("files");
  });

  it("rejects malformed hashes, commits and versions", () => {
    const base = sampleManifest(pickTarget((t) => t.os === "windows"));
    expectManifestError({ ...base, sourceCommit: "not-a-commit" }, "SCHEMA_VIOLATION");
    expectManifestError({ ...base, moduleTreeHash: "A".repeat(64) }, "SCHEMA_VIOLATION");
    expectManifestError({ ...base, appVersion: "3.0" }, "SCHEMA_VIOLATION");
  });

  it("rejects unknown properties and distro on non-linux-bootstrap manifests", () => {
    const base = sampleManifest(pickTarget((t) => t.os === "windows"));
    expectManifestError({ ...base, surprise: true }, "SCHEMA_VIOLATION");
    expectManifestError({ ...base, distro: "debian-12" }, "SCHEMA_VIOLATION");
  });

  it("rejects linux bootstrap manifests without distro", () => {
    const base = sampleManifest(pickTarget((t) => t.distro === "debian-13"));
    const withoutDistro: Record<string, unknown> = { ...base };
    delete withoutDistro.distro;
    expectManifestError(withoutDistro, "SCHEMA_VIOLATION");
  });
});

describe("manifest hygiene lint (PK01: no dev-machine paths, no secrets)", () => {
  it("flags a Windows developer path inside files[]", () => {
    const manifest = sampleManifest(pickTarget((t) => t.os === "windows"));
    const file = manifest.files[0];
    if (!file) {
      throw new Error("sample manifest must carry a file");
    }
    file.path = "D:\\workspace\\xresconv-gui\\out\\app.exe";
    const error = expectManifestError(manifest, "MANIFEST_LINT");
    expect(error.details.some((d) => d.includes("windows-drive-path"))).toBe(true);
    expect(error.details.some((d) => d.includes("/files/0/path"))).toBe(true);
  });

  it.each([
    ["/home/dev/xresconv-gui/out/app", "unix-user-path"],
    ["/Users/dev/Library/build/app", "unix-user-path"],
    ["\\\\buildsrv\\share\\artifact.exe", "unc-path"],
    ["C:/ci/work/node-v24.zip", "windows-drive-path"],
  ])("flags dev-machine path %j (%s)", (value, rule) => {
    const manifest = sampleManifest(pickTarget((t) => t.os === "linux"));
    manifest.nodeHash.source = value;
    const error = expectManifestError(manifest, "MANIFEST_LINT");
    expect(error.details.some((d) => d.includes(rule))).toBe(true);
  });

  it.each([
    ["-----BEGIN PRIVATE KEY-----\nMIIBogIBAAJBALe", "private-key-block"],
    ["AKIAIOSFODNN7EXAMPLE", "aws-access-key"],
    ["ghp_abcdefghijklmnopqrstuvwxyz0123456789", "github-token"],
    ["xoxb-123456789012-abcdefghijkl", "slack-token"],
    [
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "jwt",
    ],
  ])("flags secret material %j", (value, rule) => {
    const manifest = sampleManifest(pickTarget((t) => t.os === "windows"));
    manifest.signingEvidence.push({
      kind: "authenticode",
      subject: "xresconv-gui.exe",
      reference: value,
    });
    const findings = lintManifest(manifest);
    expect(findings.some((f) => f.rule === rule)).toBe(true);
    expectManifestError(manifest, "MANIFEST_LINT");
  });

  it("flags secret-looking keys but allows empty or placeholder values", () => {
    expect(
      lintManifest({ nested: { apiToken: "s3cr3t-value" } }).some((f) => f.rule === "secret-key"),
    ).toBe(true);
    expect(lintManifest({ nested: { apiToken: "" } })).toEqual([]);
    expect(lintManifest({ nested: { apiToken: "<redacted>" } })).toEqual([]);
  });

  it("accepts clean manifests and plain system paths", () => {
    const manifest = sampleManifest(pickTarget((t) => t.distro === "ubuntu-24.04"));
    expect(lintManifest(manifest)).toEqual([]);
    expect(lintManifest({ note: "/usr/lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so" })).toEqual([]);
  });

  it("lint can be skipped explicitly for schema-focused checks", () => {
    const manifest: RuntimeManifest = sampleManifest(pickTarget((t) => t.os === "windows"));
    const file = manifest.files[0];
    if (!file) {
      throw new Error("sample manifest must carry a file");
    }
    file.path = "D:\\workspace\\out\\app.exe";
    expect(validateRuntimeManifest(manifest, { lint: false }).os).toBe("windows");
  });
});
