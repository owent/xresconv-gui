import type {
  DesktopArch,
  LinuxArch,
  LinuxDistro,
  ReleaseTarget,
  TargetOs,
  TargetVariant,
  WebviewStrategy,
} from "./types.ts";

/** D2 first-wave Linux distros; Fedora pins the two latest formal releases (43/44, see P5-01 record). */
export const LINUX_DISTROS: readonly LinuxDistro[] = [
  "ubuntu-22.04",
  "ubuntu-24.04",
  "debian-12",
  "debian-13",
  "fedora-43",
  "fedora-44",
];

export const DESKTOP_ARCHES: readonly DesktopArch[] = ["x64", "arm64"];
export const LINUX_ARCHES: readonly LinuxArch[] = ["x86_64", "aarch64"];
export const TARGET_OSES: readonly TargetOs[] = ["windows", "macos", "linux"];
export const TARGET_VARIANTS: readonly TargetVariant[] = ["bootstrap", "offline"];
export const WEBVIEW_STRATEGIES: readonly WebviewStrategy[] = [
  "webview2-embed-bootstrapper",
  "webview2-offline-installer",
  "system-only",
  "webkitgtk-system",
  "webkitgtk-bundled",
];

/** D1: 64-bit only. Exact-match list; x86_64/aarch64 must never trip this. */
export const FORBIDDEN_ARCHES: readonly string[] = ["ia32", "x86", "armv7l", "armv7"];

/** Stable identity of a target: os/distro-or-dash/arch/variant. */
export function targetKey(
  target: Pick<ReleaseTarget, "os" | "arch" | "variant"> & { distro?: string | null },
): string {
  return `${target.os}/${target.distro ?? "-"}/${target.arch}/${target.variant}`;
}

/**
 * The full D1/D2 baseline as identity keys: windows/macos x64+arm64 in both
 * variants, linux bootstrap per D2 distro per arch, linux offline self-contained
 * per arch. validateTargets requires exact set equality with this list.
 */
export function baselineKeys(): string[] {
  const keys: string[] = [];
  for (const os of ["windows", "macos"] as const) {
    for (const arch of DESKTOP_ARCHES) {
      for (const variant of TARGET_VARIANTS) {
        keys.push(targetKey({ os, arch, variant }));
      }
    }
  }
  for (const distro of LINUX_DISTROS) {
    for (const arch of LINUX_ARCHES) {
      keys.push(targetKey({ os: "linux", distro, arch, variant: "bootstrap" }));
    }
  }
  for (const arch of LINUX_ARCHES) {
    keys.push(targetKey({ os: "linux", arch, variant: "offline" }));
  }
  return keys.sort();
}
