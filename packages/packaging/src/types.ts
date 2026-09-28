export type TargetOs = "windows" | "macos" | "linux";
export type TargetVariant = "bootstrap" | "offline";
export type DesktopArch = "x64" | "arm64";
export type LinuxArch = "x86_64" | "aarch64";
export type TargetArch = DesktopArch | LinuxArch;
/** Linux 构建基线（最老支持发行版；产物本身发行版无关，见 05 册）。 */
export type LinuxDistro = "ubuntu-22.04";
export type WebviewStrategy =
  | "webview2-evergreen"
  | "webview2-fixed-runtime"
  | "system-only"
  | "webkitgtk-system"
  | "webkitgtk-bundled";

/** Build-input identity of one release artifact (packaging/targets.json entry). */
export interface ReleaseTarget {
  os: TargetOs;
  osVersionRange: string;
  arch: TargetArch;
  variant: TargetVariant;
  targetTriple: string;
  webviewStrategy: WebviewStrategy;
  minimumWebview: string | null;
  nodeVersion: string;
}

/** Root of packaging/targets.json. */
export interface TargetsFile {
  schemaVersion: 1;
  targets: ReleaseTarget[];
}

/** Installer formats still in the release matrix; Windows/Linux ship portable
 * archives only (user decision 2026-09-28), so macOS DMG is the sole one. */
export type ArtifactFormat = "dmg";

/** Portable（非安装器）交付形态：Windows zip、macOS .app.zip、Linux offline
 * 自含 AppImage 与 tar.zst、Linux bootstrap 系统 WebKitGTK tar.zst。 */
export type PortableFormat = "zip" | "app.zip" | "appimage" | "tar.zst";

/** One row of the release matrix consumed by the CI aggregate job (CI-06);
 * one row per shipped artifact (a target with two artifacts yields two rows). */
export interface MatrixArtifact {
  name: string;
  sha256Name: string;
  version: string;
  os: TargetOs;
  distro: LinuxDistro | null;
  arch: TargetArch;
  variant: TargetVariant;
  targetTriple: string;
  webviewStrategy: WebviewStrategy;
  format: ArtifactFormat | PortableFormat;
}

export type RuntimePayload =
  | "shell"
  | "frontend"
  | "node-runtime"
  | "backend-js"
  | "guardian-js"
  | "script-host-js"
  | "npm-modules"
  | "native-addons"
  | "resources"
  | "webview2-bootstrapper"
  | "webview2-fixed-runtime"
  | "linux-selfcontained-runtime";

export interface NodeHash {
  sha256: string;
  source: string;
}

export interface NativeAddonModule {
  name: string;
  path: string;
  sha256: string;
}

export interface NativeAddonAbi {
  nodeAbi: string;
  modules?: NativeAddonModule[];
}

export interface ManifestFile {
  path: string;
  size: number;
  sha256: string;
  origin: string;
  license: string;
}

export type SigningKind =
  | "authenticode"
  | "apple-codesign"
  | "apple-notarization"
  | "gpg"
  | "sbom-attestation";

export interface SigningEvidenceEntry {
  kind: SigningKind;
  subject: string;
  reference: string;
}

export interface BuildToolchain {
  runnerOs: string;
  runnerArch: string;
  nodeVersion: string;
  yarnVersion: string;
  tauriCliVersion: string;
  rustVersion?: string;
}

export interface RepositorySnapshot {
  repository: string;
  commit: string;
  dirty: boolean;
}

export interface VerificationReport {
  result: "pass" | "fail";
  reportPath?: string;
  testedAt?: string;
}

/** Artifact-side manifest (packaging/schema/runtime-manifest.schema.json). */
export interface RuntimeManifest {
  schemaVersion: 1;
  appVersion: string;
  sourceCommit: string;
  targetTriple: string;
  os: TargetOs;
  osVersionRange: string;
  distro?: LinuxDistro;
  arch: TargetArch;
  variant: TargetVariant;
  webviewStrategy: WebviewStrategy;
  minimumWebview: string | null;
  runtimePayloads: RuntimePayload[];
  nodeVersion: string;
  nodeHash: NodeHash;
  moduleTreeHash: string;
  nativeAddonAbi: NativeAddonAbi;
  files: ManifestFile[];
  signingEvidence: SigningEvidenceEntry[];
  buildToolchain: BuildToolchain;
  repositorySnapshot: RepositorySnapshot;
  verificationReport: VerificationReport;
}
