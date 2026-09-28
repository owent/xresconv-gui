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
 * 仅需 Portable 包；2026-09-27 增补：Linux 需"解压即运行"的 tar.gz，两种运行
 * 时策略都提供且与 AppImage 并存）。macOS portable = 未签名 .app（ditto 压缩
 * .app.zip）；Linux bootstrap = 系统 WebKitGTK tar.gz（尽量复用发行版运行时，
 * 对等 deb 的策略但免安装）；Linux offline = 自含 AppImage + 自含 tar.gz
 * （同一 linuxdeploy 闭包，免 FUSE 的解压形态）。Windows NSIS 是安装器，无
 * portable 形态——Windows portable 的 manifest 语义（webview 策略）需要发行
 * 合同修订，不擅自发明。 */
export type PortableFormat = "app.zip" | "appimage" | "tarball";

export function portableFormats(target: ReleaseTarget): PortableFormat[] {
  if (target.os === "macos") return ["app.zip"];
  if (target.os === "linux") {
    if (target.variant === "offline") return ["appimage", "tarball"];
    if (target.variant === "bootstrap") return ["tarball"];
  }
  throw new PackagingError(
    "NO_PORTABLE_FORMAT",
    `target ${target.os}/${target.variant} has no portable format`,
    [`${target.os}/${target.variant}`],
  );
}

/** Portable 产物名：tar.gz 与 .app.zip 一律不带 distro 段——bootstrap tar.gz
 * 是发行版无关产物（系统 WebKitGTK ≥ minimumWebview 即可），其构建基线
 * （如 ubuntu-22.04）记录在包内 manifest 而非文件名。非法目标先过
 * portableFormats 校验（fail-closed）。 */
export function portableArtifactName(
  target: ReleaseTarget,
  version: string,
  format: PortableFormat,
): string {
  if (!VERSION_PATTERN.test(version)) {
    throw new PackagingError("INVALID_VERSION", `invalid version "${version}"`, [version]);
  }
  if (!portableFormats(target).includes(format))
    throw new PackagingError(
      "NO_PORTABLE_FORMAT",
      `format ${format} is not portable for target ${target.os}/${target.variant}`,
      [`${target.os}/${target.variant}`, format],
    );
  const ext =
    format === "tarball" ? "tar.gz" : format === "app.zip" ? "app.zip" : FORMAT_EXTENSIONS.appimage;
  return `xresconv-gui-${version}-${target.os}-${target.arch}-${target.variant}.${ext}`;
}

/**
 * Portable 构建验证范围（portable-build.yml）：macOS x64/arm64（app.zip）+
 * Linux x86_64/aarch64（bootstrap tar.gz + offline AppImage/tar.gz），共 8 项。
 * macOS 两变体负载相同（targets.json 仅 variant 字段不同），portable 验证取
 * offline 命名；Linux bootstrap tar.gz 不带 distro 段且 12 个 distro 行共享
 * 同一产物（按名去重）。聚合按精确集合 fail-closed，不认额外/缺失产物。
 */
export function portableArtifactNames(file: TargetsFile, version: string): string[] {
  const names = new Set<string>();
  for (const target of file.targets) {
    if (target.os === "macos" && target.variant !== "offline") continue;
    let formats: PortableFormat[];
    try {
      formats = portableFormats(target);
    } catch {
      continue;
    }
    for (const format of formats) names.add(portableArtifactName(target, version, format));
  }
  return [...names].sort();
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

/**
 * The subset of the full matrix a release CI run actually builds (CI-06
 * transitional state: release.yml covers the native-runner targets; the
 * remaining baseline rows await the CI-05 container/cross builds). Keys are
 * targetKey strings, passed one per --target flag by scripts/verify-release.ts
 * and kept in sync with the build-job matrices in release.yml. Fails closed on
 * unknown keys (typo guard), duplicates, and an empty list (a vacuous verify).
 */
export function selectMatrix(
  artifacts: readonly MatrixArtifact[],
  keys: readonly string[],
): MatrixArtifact[] {
  if (keys.length === 0)
    throw new PackagingError("MISSING_TARGET", "no target keys given to select from the matrix");
  const byKey = new Map(artifacts.map((row) => [targetKey(row), row]));
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key))
      throw new PackagingError("DUPLICATE_TARGET", `duplicate target key "${key}"`, [key]);
    seen.add(key);
    if (!byKey.has(key))
      throw new PackagingError(
        "UNKNOWN_TARGET",
        `target key "${key}" is not in the full matrix`,
        [key],
      );
  }
  return keys.map((key) => byKey.get(key) as MatrixArtifact);
}
