import { targetKey } from "./baseline.ts";
import { PackagingError } from "./errors.ts";
import { validateTargets } from "./load.ts";
import type { ArtifactFormat, MatrixArtifact, ReleaseTarget, TargetsFile } from "./types.ts";

/** Semver with optional prerelease; also what CI tags use. No path separators possible. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Installer format per target, fixed by 05-book: NSIS on Windows, DMG on macOS,
 * DEB/RPM online on Linux, self-contained AppImage for Linux offline (P5-06
 * prototype; fallback per-distro closure would extend this mapping). */
export function formatFor(target: ReleaseTarget): ArtifactFormat {
  switch (target.os) {
    case "windows":
      return "nsis";
    case "macos":
      return "dmg";
    case "linux":
      if (target.variant === "offline") {
        return "appimage";
      }
      return target.distro?.startsWith("fedora-") ? "rpm" : "deb";
  }
}

const FORMAT_EXTENSIONS: Record<ArtifactFormat, string> = {
  nsis: "exe",
  dmg: "dmg",
  deb: "deb",
  rpm: "rpm",
  appimage: "AppImage",
};

/**
 * xresconv-gui-<version>-<os>-<distro?>-<arch>-<variant>.<ext>
 * The distro segment appears only on linux bootstrap targets (linux offline is
 * one self-contained package per arch; windows/macos never carry a distro).
 */
export function artifactName(target: ReleaseTarget, version: string): string {
  if (!VERSION_PATTERN.test(version)) {
    throw new PackagingError("INVALID_VERSION", `invalid version "${version}"`, [version]);
  }
  const distro = target.os === "linux" && target.distro ? `${target.distro}-` : "";
  return `xresconv-gui-${version}-${target.os}-${distro}${target.arch}-${target.variant}.${
    FORMAT_EXTENSIONS[formatFor(target)]
  }`;
}

function compareKeys(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * Full release matrix for CI-06: one serializable row per artifact, sorted by
 * identity key, each with its SHA-256 sidecar name. The aggregate job compares
 * the built artifact name set against these names for exact set equality.
 */
export function buildMatrix(file: TargetsFile, version: string): MatrixArtifact[] {
  validateTargets(file);
  const artifacts = file.targets.map((target) => {
    const name = artifactName(target, version);
    return {
      name,
      sha256Name: `${name}.sha256`,
      version,
      os: target.os,
      distro: target.distro ?? null,
      arch: target.arch,
      variant: target.variant,
      targetTriple: target.targetTriple,
      webviewStrategy: target.webviewStrategy,
      format: formatFor(target),
    } satisfies MatrixArtifact;
  });
  artifacts.sort((a, b) => compareKeys(targetKey(a), targetKey(b)));
  const names = new Set<string>();
  const duplicates: string[] = [];
  for (const artifact of artifacts) {
    if (names.has(artifact.name)) {
      duplicates.push(artifact.name);
    }
    names.add(artifact.name);
  }
  if (duplicates.length > 0) {
    throw new PackagingError(
      "DUPLICATE_TARGET",
      `artifact name collision: ${duplicates.join(", ")}`,
      duplicates,
    );
  }
  return artifacts;
}
