import { targetKey } from "./baseline.ts";
import { PackagingError } from "./errors.ts";
import { validateTargets } from "./load.ts";
import type {
  ArtifactFormat,
  MatrixArtifact,
  PortableFormat,
  ReleaseTarget,
  TargetsFile,
} from "./types.ts";

/** Semver with optional prerelease; also what CI tags use. No path separators possible. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 *  macOS is the last installer-format target ( portable-archive
 * decision: Windows/Linux ship portable archives only, so no nsis/deb/rpm
 * installer naming exists anymore).
 */
export function formatFor(target: ReleaseTarget): ArtifactFormat {
  if (target.os === "macos") return "dmg";
  throw new PackagingError(
    "NO_INSTALLER_FORMAT",
    `target ${target.os}/${target.variant} has no installer format (portable archive only)`,
    [`${target.os}/${target.variant}`],
  );
}

const FORMAT_EXTENSIONS: Record<ArtifactFormat, string> = { dmg: "dmg" };

/**
 * xresconv-gui-<version>-<os>-<arch>-<variant>.<ext> (installer naming; macOS
 * dmg only). Windows/Linux release names come from portableArtifactName.
 */
export function artifactName(target: ReleaseTarget, version: string): string {
  return `${artifactBase(target, version)}.${FORMAT_EXTENSIONS[formatFor(target)]}`;
}

function artifactBase(target: ReleaseTarget, version: string): string {
  if (!VERSION_PATTERN.test(version)) {
    throw new PackagingError("INVALID_VERSION", `invalid version "${version}"`, [version]);
  }
  return `xresconv-gui-${version}-${target.os}-${target.arch}-${target.variant}`;
}

/**
 *  Portable（非安装器）交付形态（ 用户决策：Release 一律 portable
 * 归档——Linux 不再出 deb/rpm，Windows 不再出安装器）。macOS portable = 未
 * 签名 .app（ditto 压缩 .app.zip）；Windows bootstrap/offline 均为 7z
 * （bootstrap 附 WebView2 bootstrapper；offline 内嵌 Fixed Version，
 * 解压后双击应用；目标机须有支持 7z 的解压工具）；
 * Linux bootstrap = 系统 WebKitGTK tar.zst（发行版无关，preflight.sh 探测/
 * 指引）；Linux offline = 自含 AppImage + 同闭包 tar.zst（用户
 * 决策：与 AppImage 并存；压缩格式按  决策为 zstd）。
 */
export function portableFormats(target: ReleaseTarget): PortableFormat[] {
  if (target.os === "macos") return ["app.zip"];
  if (target.os === "windows") return ["7z"];
  if (target.variant === "offline") return ["appimage", "tar.zst"];
  return ["tar.zst"];
}

const PORTABLE_EXTENSIONS: Record<PortableFormat, string> = {
  "7z": "7z",
  "app.zip": "app.zip",
  appimage: "AppImage",
  "tar.zst": "tar.zst",
};

/**
 *  Portable 产物名：一律不带 distro 段（产物发行版无关，构建基线记录在包内
 * manifest 而非文件名）。非法目标先过 portableFormats 校验（fail-closed）。
 */
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
  return `${artifactBase(target, version)}.${PORTABLE_EXTENSIONS[format]}`;
}

/**
 * Portable 构建验证范围（portable-build.yml）：macOS x64/arm64（app.zip）+
 * Linux x86_64/aarch64（bootstrap tar.zst + offline AppImage/tar.zst），共 8 项。
 * macOS 两变体负载相同（targets.json 仅 variant 字段不同），portable 验证取
 * offline 命名。聚合按精确集合 fail-closed，不认额外/缺失产物。
 */
export function portableArtifactNames(file: TargetsFile, version: string): string[] {
  const names = new Set<string>();
  for (const target of file.targets) {
    if (target.os === "macos" && target.variant !== "offline") continue;
    if (target.os === "windows") continue;
    for (const format of portableFormats(target))
      names.add(portableArtifactName(target, version, format));
  }
  return [...names].sort();
}

/**
 *  One shipped release artifact of a target: macOS ships its dmg installer;
 * Windows/Linux ship the portable archive forms (one row per artifact).
 */
export function releaseArtifacts(
  target: ReleaseTarget,
  version: string,
): Array<{ name: string; format: ArtifactFormat | PortableFormat }> {
  // Both macOS build variants use system WKWebView. Keep local/Portable
  // compatibility, but publish one bootstrap DMG per architecture.
  if (target.os === "macos")
    return target.variant === "bootstrap"
      ? [{ name: artifactName(target, version), format: "dmg" }]
      : [];
  return portableFormats(target).map((format) => ({
    name: portableArtifactName(target, version, format),
    format,
  }));
}

function compareKeys(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * Full release matrix for : one serializable row per shipped artifact
 * (a two-artifact target like linux/offline yields two rows), sorted by
 * identity key then name, each with its SHA-256 sidecar name. The aggregate
 * job compares the built artifact name set against these names for exact set
 * equality.
 */
export function buildMatrix(file: TargetsFile, version: string): MatrixArtifact[] {
  validateTargets(file);
  const artifacts = file.targets.flatMap((target) =>
    releaseArtifacts(target, version).map(({ name, format }) => ({
      name,
      sha256Name: `${name}.sha256`,
      version,
      os: target.os,
      distro: null,
      arch: target.arch,
      variant: target.variant,
      targetTriple: target.targetTriple,
      webviewStrategy: target.webviewStrategy,
      format,
    })),
  );
  artifacts.sort((a, b) => compareKeys(targetKey(a), targetKey(b)) || compareKeys(a.name, b.name));
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
 * The subset of the full matrix a release CI run actually builds (
 * transitional state: release.yml covers the native-runner targets). Keys are
 * targetKey strings, passed one per --target flag by scripts/verify-release.ts
 * and kept in sync with the build-job matrices in release.yml. One key may
 * match several artifact rows (linux offline = AppImage + tar.zst); duplicate
 * keys in the list, keys matching nothing, and an empty list all fail closed.
 */
export function selectMatrix(
  artifacts: readonly MatrixArtifact[],
  keys: readonly string[],
): MatrixArtifact[] {
  if (keys.length === 0)
    throw new PackagingError("MISSING_TARGET", "no target keys given to select from the matrix");
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key))
      throw new PackagingError("DUPLICATE_TARGET", `duplicate target key "${key}"`, [key]);
    seen.add(key);
    if (!artifacts.some((row) => targetKey(row) === key))
      throw new PackagingError("UNKNOWN_TARGET", `target key "${key}" is not in the full matrix`, [
        key,
      ]);
  }
  return artifacts.filter((row) => seen.has(targetKey(row)));
}
