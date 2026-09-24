import { describe, expect, it } from "vitest";
import { PackagingError, type PackagingErrorCode } from "../src/errors.ts";
import { validateTargetSemantics, validateTargets } from "../src/load.ts";
import type { ReleaseTarget } from "../src/types.ts";
import { asData, cloneTargets, pickTarget } from "./fixtures.ts";

function expectFailure(fn: () => unknown, code: PackagingErrorCode): PackagingError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PackagingError);
    expect((error as PackagingError).code).toBe(code);
    return error as PackagingError;
  }
  throw new Error(`expected PackagingError(${code}), but nothing was thrown`);
}

describe("PK01 negative paths", () => {
  it("duplicate target (same os/distro/arch/variant) fails", () => {
    const targets = cloneTargets();
    const first = targets[0];
    if (!first) {
      throw new Error("targets must not be empty");
    }
    targets.push(structuredClone(first));
    const error = expectFailure(() => validateTargets(asData(targets)), "DUPLICATE_TARGET");
    expect(error.details.some((d) => d.startsWith("windows/"))).toBe(true);
  });

  it("missing target (baseline set not covered) fails and names the gap", () => {
    const targets = cloneTargets().filter(
      (t) => !(t.os === "linux" && t.distro === "fedora-44" && t.arch === "aarch64"),
    );
    const error = expectFailure(() => validateTargets(asData(targets)), "MISSING_TARGET");
    expect(error.details).toContain("linux/fedora-44/aarch64/bootstrap");
  });

  it("unknown os fails at the schema gate", () => {
    const base = pickTarget((t) => t.os === "windows");
    const bad = { ...base, os: "freebsd" };
    expectFailure(
      () => validateTargets(asData([bad as unknown as ReleaseTarget])),
      "SCHEMA_VIOLATION",
    );
  });

  it("unknown os fails the semantic gate for direct callers", () => {
    const base = pickTarget((t) => t.os === "windows");
    const bad = { ...base, os: "freebsd" } as unknown as ReleaseTarget;
    const error = expectFailure(() => validateTargetSemantics([bad]), "UNKNOWN_TARGET");
    expect(error.message).toContain("freebsd");
  });

  it("unknown distro fails at the schema gate and the semantic gate", () => {
    const base = pickTarget((t) => t.os === "linux" && t.variant === "bootstrap");
    const bad = { ...base, distro: "arch" };
    expectFailure(
      () => validateTargets(asData([bad as unknown as ReleaseTarget])),
      "SCHEMA_VIOLATION",
    );
    const error = expectFailure(
      () => validateTargetSemantics([bad as unknown as ReleaseTarget]),
      "UNKNOWN_TARGET",
    );
    expect(error.message).toContain("arch");
  });

  it("unknown arch fails the semantic gate", () => {
    const base = pickTarget((t) => t.os === "windows");
    const bad = { ...base, arch: "sparc" } as unknown as ReleaseTarget;
    expectFailure(() => validateTargetSemantics([bad]), "UNKNOWN_TARGET");
  });

  it.each(["ia32", "x86", "armv7l"])("forbidden 32-bit arch %s is rejected (D1)", (arch) => {
    const base = pickTarget((t) => t.os === "windows");
    const bad = { ...base, arch };
    expectFailure(
      () => validateTargets(asData([bad as unknown as ReleaseTarget])),
      "SCHEMA_VIOLATION",
    );
    const error = expectFailure(
      () => validateTargetSemantics([bad as unknown as ReleaseTarget]),
      "FORBIDDEN_ARCH",
    );
    expect(error.message).toContain(arch);
  });

  it("x86_64 is not caught by the ia32/x86 ban (exact-match rule)", () => {
    const targets = cloneTargets();
    expect(targets.some((t) => t.arch === "x86_64")).toBe(true);
    expect(() => validateTargets(asData(targets))).not.toThrow();
  });

  it("windows bootstrap with the offline WebView2 strategy fails coherence", () => {
    const base = pickTarget((t) => t.os === "windows" && t.variant === "bootstrap");
    const bad: ReleaseTarget = { ...base, webviewStrategy: "webview2-offline-installer" };
    const error = expectFailure(() => validateTargets(asData([bad])), "INCOHERENT_TARGET");
    expect(error.message).toContain("webview2-embed-bootstrapper");
  });

  it("macOS with a webview version floor fails coherence (gate is osVersionRange, D5)", () => {
    const base = pickTarget((t) => t.os === "macos");
    const bad: ReleaseTarget = { ...base, minimumWebview: "17.0" };
    expectFailure(() => validateTargets(asData([bad])), "INCOHERENT_TARGET");
  });

  it("linux bootstrap without a distro fails", () => {
    const base = pickTarget((t) => t.os === "linux" && t.variant === "bootstrap");
    const bad = { ...base };
    delete bad.distro;
    expectFailure(() => validateTargets(asData([bad])), "SCHEMA_VIOLATION");
    expectFailure(() => validateTargetSemantics([bad]), "INCOHERENT_TARGET");
  });

  it("linux offline carrying a distro fails", () => {
    const base = pickTarget((t) => t.os === "linux" && t.variant === "offline");
    const bad = { ...base, distro: "ubuntu-22.04" };
    expectFailure(
      () => validateTargets(asData([bad as unknown as ReleaseTarget])),
      "SCHEMA_VIOLATION",
    );
  });

  it("windows/macos carrying a distro fails", () => {
    const base = pickTarget((t) => t.os === "macos");
    const bad = { ...base, distro: "debian-12" };
    expectFailure(
      () => validateTargets(asData([bad as unknown as ReleaseTarget])),
      "SCHEMA_VIOLATION",
    );
  });

  it("windows/macos with a linux-style arch fails at the schema gate", () => {
    const base = pickTarget((t) => t.os === "windows");
    const bad = { ...base, arch: "x86_64" };
    expectFailure(
      () => validateTargets(asData([bad as unknown as ReleaseTarget])),
      "SCHEMA_VIOLATION",
    );
  });
});
