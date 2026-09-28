import type {
  DesktopArch,
  LinuxArch,
  ReleaseTarget,
  TargetOs,
  TargetVariant,
  WebviewStrategy,
} from "./types.ts";

/** Linux 构建基线：最老支持的 Ubuntu LTS（glibc 2.35 地板）。产物本身发行版
 * 无关（tar.zst 解压即运行），该值只约束“必须在什么宿主上构建”。 */
export const LINUX_BUILD_BASELINE = "ubuntu-22.04" as const;

export const DESKTOP_ARCHES: readonly DesktopArch[] = ["x64", "arm64"];
export const LINUX_ARCHES: readonly LinuxArch[] = ["x86_64", "aarch64"];
export const TARGET_OSES: readonly TargetOs[] = ["windows", "macos", "linux"];
export const TARGET_VARIANTS: readonly TargetVariant[] = ["bootstrap", "offline"];
export const WEBVIEW_STRATEGIES: readonly WebviewStrategy[] = [
  "webview2-evergreen",
  "webview2-fixed-runtime",
  "system-only",
  "webkitgtk-system",
  "webkitgtk-bundled",
];

/** D1: 64-bit only. Exact-match list; x86_64/aarch64 must never trip this. */
export const FORBIDDEN_ARCHES: readonly string[] = ["ia32", "x86", "armv7l", "armv7"];

/** Stable identity of a target: os/distro-or-dash/arch/variant. Linux targets
 * are distro-independent since the 2026-09-28 portable-archive decision, so
 * the distro segment is always "-" today; the segment is kept for key
 * stability and possible future per-distro rows. */
export function targetKey(
  target: Pick<ReleaseTarget, "os" | "arch" | "variant"> & { distro?: string | null },
): string {
  return `${target.os}/${target.distro ?? "-"}/${target.arch}/${target.variant}`;
}

/**
 * The release baseline as identity keys (2026-09-28 portable-archive decision,
 * same-day offline addendum: Windows ships a bootstrap zip (system Evergreen
 * WebView2 + in-archive bootstrapper sidecar) and an offline zip (bundling the
 * Fixed Version runtime) per arch; Linux ships distro-independent bootstrap +
 * offline tar.zst per arch; macOS keeps dmg x64+arm64 in both variants).
 * validateTargets requires exact set equality with this list.
 */
export function baselineKeys(): string[] {
  const keys: string[] = [];
  for (const arch of DESKTOP_ARCHES) {
    keys.push(targetKey({ os: "windows", arch, variant: "bootstrap" }));
    keys.push(targetKey({ os: "windows", arch, variant: "offline" }));
  }
  for (const arch of DESKTOP_ARCHES) {
    for (const variant of TARGET_VARIANTS) {
      keys.push(targetKey({ os: "macos", arch, variant }));
    }
  }
  for (const arch of LINUX_ARCHES) {
    keys.push(targetKey({ os: "linux", arch, variant: "bootstrap" }));
    keys.push(targetKey({ os: "linux", arch, variant: "offline" }));
  }
  return keys.sort();
}
