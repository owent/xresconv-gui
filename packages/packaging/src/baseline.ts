import type {
  DesktopArch,
  LinuxArch,
  ReleaseTarget,
  TargetOs,
  TargetVariant,
  WebviewStrategy,
} from "./types.ts";

/**
 *  Linux 构建基线：最老支持的 Ubuntu LTS（glibc 2.35 地板）。产物本身发行版
 * 无关（tar.zst 解压即运行），该值只约束“必须在什么宿主上构建”。
 */
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

/** : 64-bit only. Exact-match list; x86_64/aarch64 must never trip this. */
export const FORBIDDEN_ARCHES: readonly string[] = ["ia32", "x86", "armv7l", "armv7"];

/** 目标身份为 os/distro-or-dash/arch/variant。当前 Linux 产物与发行版无关，distro 段使用 -。 */
export function targetKey(
  target: Pick<ReleaseTarget, "os" | "arch" | "variant"> & { distro?: string | null },
): string {
  return `${target.os}/${target.distro ?? "-"}/${target.arch}/${target.variant}`;
}

/** 可构建目标的精确身份集合，validateTargets 检查集合一致性。 */
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
