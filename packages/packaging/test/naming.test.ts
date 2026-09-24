import { describe, expect, it } from "vitest";
import { PackagingError } from "../src/errors.ts";
import { artifactName, formatFor } from "../src/matrix.ts";
import { pickTarget, realTargetsFile } from "./fixtures.ts";

const VERSION = "3.0.0-dev.0";

describe("artifactName (locked pattern xresconv-gui-<version>-<os>-<distro?>-<arch>-<variant>.<ext>)", () => {
  it("names representative real targets", () => {
    const cases: Array<[Parameters<typeof pickTarget>[0], string]> = [
      [
        (t) => t.os === "windows" && t.arch === "x64" && t.variant === "bootstrap",
        "xresconv-gui-3.0.0-dev.0-windows-x64-bootstrap.exe",
      ],
      [
        (t) => t.os === "windows" && t.arch === "arm64" && t.variant === "offline",
        "xresconv-gui-3.0.0-dev.0-windows-arm64-offline.exe",
      ],
      [
        (t) => t.os === "macos" && t.arch === "x64" && t.variant === "bootstrap",
        "xresconv-gui-3.0.0-dev.0-macos-x64-bootstrap.dmg",
      ],
      [
        (t) => t.os === "macos" && t.arch === "arm64" && t.variant === "offline",
        "xresconv-gui-3.0.0-dev.0-macos-arm64-offline.dmg",
      ],
      [
        (t) => t.distro === "ubuntu-24.04" && t.arch === "x86_64",
        "xresconv-gui-3.0.0-dev.0-linux-ubuntu-24.04-x86_64-bootstrap.deb",
      ],
      [
        (t) => t.distro === "debian-12" && t.arch === "aarch64",
        "xresconv-gui-3.0.0-dev.0-linux-debian-12-aarch64-bootstrap.deb",
      ],
      [
        (t) => t.distro === "fedora-44" && t.arch === "x86_64",
        "xresconv-gui-3.0.0-dev.0-linux-fedora-44-x86_64-bootstrap.rpm",
      ],
      [
        (t) => t.os === "linux" && t.variant === "offline" && t.arch === "x86_64",
        "xresconv-gui-3.0.0-dev.0-linux-x86_64-offline.AppImage",
      ],
      [
        (t) => t.os === "linux" && t.variant === "offline" && t.arch === "aarch64",
        "xresconv-gui-3.0.0-dev.0-linux-aarch64-offline.AppImage",
      ],
    ];
    for (const [pred, expected] of cases) {
      expect(artifactName(pickTarget(pred), VERSION)).toBe(expected);
    }
  });

  it("maps format and extension by os/variant (NSIS exe, DMG, DEB, RPM, AppImage)", () => {
    expect(formatFor(pickTarget((t) => t.os === "windows"))).toBe("nsis");
    expect(formatFor(pickTarget((t) => t.os === "macos"))).toBe("dmg");
    expect(formatFor(pickTarget((t) => t.distro === "ubuntu-22.04"))).toBe("deb");
    expect(formatFor(pickTarget((t) => t.distro === "debian-13"))).toBe("deb");
    expect(formatFor(pickTarget((t) => t.distro === "fedora-43"))).toBe("rpm");
    expect(formatFor(pickTarget((t) => t.os === "linux" && t.variant === "offline"))).toBe(
      "appimage",
    );
  });

  it("accepts release and prerelease versions", () => {
    const target = pickTarget((t) => t.os === "windows");
    expect(artifactName(target, "3.0.0")).toBe("xresconv-gui-3.0.0-windows-x64-bootstrap.exe");
    expect(artifactName(target, "3.0.0-rc.1")).toContain("-3.0.0-rc.1-");
  });

  it.each(["", "1.2", "v3.0.0", "../3.0.0", "3.0.0/x", "3.0.0 beta", "3.0.0-beta_1"])(
    "rejects invalid or unsafe version %j",
    (version) => {
      const target = pickTarget((t) => t.os === "windows");
      try {
        artifactName(target, version);
      } catch (error) {
        expect(error).toBeInstanceOf(PackagingError);
        expect((error as PackagingError).code).toBe("INVALID_VERSION");
        return;
      }
      throw new Error(`expected INVALID_VERSION for ${version}`);
    },
  );

  it("every real target yields a unique, whitespace-free, pattern-conforming name", () => {
    const file = realTargetsFile();
    const pattern =
      /^xresconv-gui-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-(?:windows|macos|linux)-(?:[a-z0-9-]+(?:\.[0-9a-z-]+)?-)?(?:x64|arm64|x86_64|aarch64)-(?:bootstrap|offline)\.[A-Za-z0-9]+$/;
    const names = file.targets.map((t) => artifactName(t, VERSION));
    for (const name of names) {
      expect(name).toMatch(pattern);
      expect(name).not.toMatch(/\s/);
    }
    expect(new Set(names).size).toBe(names.length);
  });
});
