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
  return `${artifactBase(target, version)}.${FORMAT_EXTENSIONS[formatFor(target)]}`;
}

function artifactBase(target: ReleaseTarget, version: string): string {
  if (!VERSION_PATTERN.test(version)) {
    throw new PackagingError("INVALID_VERSION", `invalid version "${version}"`, [version]);
  }
  const distro = target.os === "linux" && target.distro ? `${target.distro}-` : "";
  return `xresconv-gui-${version}-${target.os}-${distro}${target.arch}-${target.variant}`;
}

/** Portable（非安装器）交付形态（用户 2026-09-27 指示：无签名证书，发行验证
 * 仅需 Portable 包）。macOS portable = 未签名 .app（打包期 ditto 压缩为
 * .app.zip）；Linux offline AppImage 本身自含即 portable。Windows NSIS 与
 * Linux bootstrap deb/rpm 是安装器，无 portable 形态——Windows portable 的
 * manifest 语义（webview 策略）需要发行合同修订，不擅自发明。 */
export function portableBundleTarget(target: ReleaseTarget): "app" | "appimage" {
  if (target.os === "macos") return "app";
  if (target.os === "linux" && target.variant === "offline") return "appimage";
  throw new PackagingError(
    "NO_PORTABLE_FORMAT",
    `target ${target.os}/${target.variant} has no portable format`,
    [`${target.os}/${target.variant}`],
  );
}

/** Portable 产物名：macOS 追加 `.app.zip`（.app 经 ditto 压缩）；Linux offline
 * 与安装器命名一致（AppImage 本身即 portable）。 */
export function portableArtifactName(target: ReleaseTarget, version: string): string {
  const bundle = portableBundleTarget(target);
  const ext = bundle === "app" ? "app.zip" : FORMAT_EXTENSIONS[bundle];
  return `${artifactBase(target, version)}.${ext}`;
}

/**
 * Portable 构建验证范围（portable-build.yml）：macOS x64/arm64 + Linux
 * x86_64/aarch64，一律取 offline 命名——macOS 两变体负载相同（targets.json
 * 仅 variant 字段不同），portable 验证以 offline 为准；Linux portable 只有
 * offline 自含形态。聚合按精确集合 fail-closed，不认额外/缺失产物。
 */
export function portableArtifactNames(file: TargetsFile, version: string): string[] {
  return file.targets
    .filter((t) => (t.os === "macos" || t.os === "linux") && t.variant === "offline")
    .map((t) => portableArtifactName(t, version))
    .sort();
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
