import { describe, expect, it } from "vitest";
import { PackagingError } from "../src/errors.ts";
import {
  artifactName,
  formatFor,
  portableArtifactName,
  portableArtifactNames,
  portableFormats,
  releaseArtifacts,
} from "../src/matrix.ts";
import type { PortableFormat } from "../src/types.ts";
import { pickTarget, realTargetsFile } from "./fixtures.ts";

const VERSION = "3.0.0-dev.0";

describe("artifactName (installer naming; macOS dmg only since the 2026-09-28 portable decision)", () => {
  it("names the macOS dmg targets", () => {
    expect(
      artifactName(
        pickTarget((t) => t.os === "macos" && t.arch === "x64"),
        VERSION,
      ),
    ).toBe("xresconv-gui-3.0.0-dev.0-macos-x64-bootstrap.dmg");
    expect(
      artifactName(
        pickTarget((t) => t.os === "macos" && t.arch === "arm64"),
        VERSION,
      ),
    ).toBe("xresconv-gui-3.0.0-dev.0-macos-arm64-bootstrap.dmg");
  });

  it("windows/linux targets have no installer format (portable archives only)", () => {
    expect(() => formatFor(pickTarget((t) => t.os === "windows"))).toThrow(/no installer format/);
    expect(() =>
      formatFor(pickTarget((t) => t.os === "linux" && t.variant === "bootstrap")),
    ).toThrow(/no installer format/);
    expect(() => formatFor(pickTarget((t) => t.os === "linux" && t.variant === "offline"))).toThrow(
      /no installer format/,
    );
  });

  it("accepts release and prerelease versions", () => {
    const target = pickTarget((t) => t.os === "macos");
    expect(artifactName(target, "3.0.0")).toBe("xresconv-gui-3.0.0-macos-x64-bootstrap.dmg");
    expect(artifactName(target, "3.0.0-rc.1")).toContain("-3.0.0-rc.1-");
  });

  it.each(["", "1.2", "v3.0.0", "../3.0.0", "3.0.0/x", "3.0.0 beta", "3.0.0-beta_1"])(
    "rejects invalid or unsafe version %j",
    (version) => {
      const target = pickTarget((t) => t.os === "macos");
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
});

describe("portable artifact naming (Windows zip / macOS .app.zip / Linux tar.zst + AppImage)", () => {
  it("derives portable names from the locked distro-free base name", () => {
    const cases: Array<[Parameters<typeof pickTarget>[0], PortableFormat, string]> = [
      [
        (t) => t.os === "macos" && t.arch === "x64" && t.variant === "offline",
        "app.zip",
        "xresconv-gui-3.0.0-dev.0-macos-x64-offline.app.zip",
      ],
      [
        (t) => t.os === "macos" && t.arch === "arm64" && t.variant === "offline",
        "app.zip",
        "xresconv-gui-3.0.0-dev.0-macos-arm64-offline.app.zip",
      ],
      [
        (t) => t.os === "windows" && t.arch === "x64",
        "zip",
        "xresconv-gui-3.0.0-dev.0-windows-x64-bootstrap.zip",
      ],
      [
        (t) => t.os === "windows" && t.arch === "arm64",
        "zip",
        "xresconv-gui-3.0.0-dev.0-windows-arm64-bootstrap.zip",
      ],
      [
        (t) => t.os === "windows" && t.arch === "x64" && t.variant === "offline",
        "tar.zst",
        "xresconv-gui-3.0.0-dev.0-windows-x64-offline.tar.zst",
      ],
      [
        (t) => t.os === "linux" && t.variant === "bootstrap" && t.arch === "x86_64",
        "tar.zst",
        "xresconv-gui-3.0.0-dev.0-linux-x86_64-bootstrap.tar.zst",
      ],
      [
        (t) => t.os === "linux" && t.variant === "offline" && t.arch === "x86_64",
        "tar.zst",
        "xresconv-gui-3.0.0-dev.0-linux-x86_64-offline.tar.zst",
      ],
      [
        (t) => t.os === "linux" && t.variant === "offline" && t.arch === "x86_64",
        "appimage",
        "xresconv-gui-3.0.0-dev.0-linux-x86_64-offline.AppImage",
      ],
      [
        (t) => t.os === "linux" && t.variant === "offline" && t.arch === "aarch64",
        "tar.zst",
        "xresconv-gui-3.0.0-dev.0-linux-aarch64-offline.tar.zst",
      ],
    ];
    for (const [pred, format, expected] of cases) {
      expect(portableArtifactName(pickTarget(pred), VERSION, format)).toBe(expected);
    }
  });

  it("maps portable formats per os/variant (windows bootstrap zip / offline tar.zst; linux offline appimage+tar.zst)", () => {
    expect(
      portableFormats(pickTarget((t) => t.os === "windows" && t.variant === "bootstrap")),
    ).toEqual(["zip"]);
    expect(
      portableFormats(pickTarget((t) => t.os === "windows" && t.variant === "offline")),
    ).toEqual(["tar.zst"]);
    expect(portableFormats(pickTarget((t) => t.os === "macos"))).toEqual(["app.zip"]);
    expect(portableFormats(pickTarget((t) => t.os === "linux" && t.variant === "offline"))).toEqual(
      ["appimage", "tar.zst"],
    );
    expect(
      portableFormats(pickTarget((t) => t.os === "linux" && t.variant === "bootstrap")),
    ).toEqual(["tar.zst"]);
  });

  it("rejects a portable format that does not belong to the target (fail-closed per format)", () => {
    const linuxOffline = pickTarget((t) => t.os === "linux" && t.variant === "offline");
    const macos = pickTarget((t) => t.os === "macos");
    const windowsBootstrap = pickTarget((t) => t.os === "windows" && t.variant === "bootstrap");
    const windowsOffline = pickTarget((t) => t.os === "windows" && t.variant === "offline");
    const linuxBootstrap = pickTarget((t) => t.os === "linux" && t.variant === "bootstrap");
    expect(() => portableArtifactName(linuxOffline, VERSION, "app.zip")).toThrow(
      /is not portable for target/,
    );
    expect(() => portableArtifactName(macos, VERSION, "appimage")).toThrow(
      /is not portable for target/,
    );
    expect(() => portableArtifactName(macos, VERSION, "tar.zst")).toThrow(
      /is not portable for target/,
    );
    expect(() => portableArtifactName(linuxBootstrap, VERSION, "appimage")).toThrow(
      /is not portable for target/,
    );
    // windows bootstrap 只出 zip、offline 只出 tar.zst——交叉/无关格式 fail-closed
    expect(() => portableArtifactName(windowsBootstrap, VERSION, "appimage")).toThrow(
      /is not portable for target/,
    );
    expect(() => portableArtifactName(windowsBootstrap, VERSION, "tar.zst")).toThrow(
      /is not portable for target/,
    );
    expect(() => portableArtifactName(windowsOffline, VERSION, "zip")).toThrow(
      /is not portable for target/,
    );
  });

  it.each(["", "1.2", "v3.0.0", "../3.0.0", "3.0.0/x", "3.0.0 beta", "3.0.0-beta_1"])(
    "rejects invalid or unsafe version %j for portable names",
    (version) => {
      const target = pickTarget((t) => t.os === "linux" && t.variant === "offline");
      try {
        portableArtifactName(target, version, "tar.zst");
      } catch (error) {
        expect(error).toBeInstanceOf(PackagingError);
        expect((error as PackagingError).code).toBe("INVALID_VERSION");
        return;
      }
      throw new Error(`expected INVALID_VERSION for ${version}`);
    },
  );

  it("pins the portable verification scope (8 artifacts: macOS app.zip + Linux bootstrap/offline tar.zst + offline AppImage)", () => {
    expect(portableArtifactNames(realTargetsFile(), VERSION)).toEqual([
      "xresconv-gui-3.0.0-dev.0-linux-aarch64-bootstrap.tar.zst",
      "xresconv-gui-3.0.0-dev.0-linux-aarch64-offline.AppImage",
      "xresconv-gui-3.0.0-dev.0-linux-aarch64-offline.tar.zst",
      "xresconv-gui-3.0.0-dev.0-linux-x86_64-bootstrap.tar.zst",
      "xresconv-gui-3.0.0-dev.0-linux-x86_64-offline.AppImage",
      "xresconv-gui-3.0.0-dev.0-linux-x86_64-offline.tar.zst",
      "xresconv-gui-3.0.0-dev.0-macos-arm64-offline.app.zip",
      "xresconv-gui-3.0.0-dev.0-macos-x64-offline.app.zip",
    ]);
  });

  it("every real target yields unique, whitespace-free release artifact names", () => {
    const file = realTargetsFile();
    const pattern =
      /^xresconv-gui-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-(?:windows|macos|linux)-(?:x64|arm64|x86_64|aarch64)-(?:bootstrap|offline)\.(?:zip|app\.zip|AppImage|tar\.zst|dmg)$/;
    const names = file.targets.flatMap((t) => releaseArtifacts(t, VERSION).map((a) => a.name));
    for (const name of names) {
      expect(name).toMatch(pattern);
      expect(name).not.toMatch(/\s/);
    }
    expect(new Set(names).size).toBe(names.length);
  });
});
