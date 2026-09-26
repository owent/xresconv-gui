export type TargetOs = "windows" | "macos" | "linux";
export type TargetVariant = "bootstrap" | "offline";
export type DesktopArch = "x64" | "arm64";
export type LinuxArch = "x86_64" | "aarch64";
export type TargetArch = DesktopArch | LinuxArch;
export type LinuxDistro =
  | "ubuntu-22.04"
  | "ubuntu-24.04"
  | "debian-12"
  | "debian-13"
  | "fedora-43"
  | "fedora-44";
export type WebviewStrategy =
  | "webview2-embed-bootstrapper"
  | "webview2-offline-installer"
  | "system-only"
  | "webkitgtk-system"
  | "webkitgtk-bundled";

/** Build-input identity of one release artifact (packaging/targets.json entry). */
export interface ReleaseTarget {
  os: TargetOs;
  osVersionRange: string;
  distro?: LinuxDistro;
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

export type ArtifactFormat = "nsis" | "dmg" | "deb" | "rpm" | "appimage";

/** One row of the release matrix consumed by the CI aggregate job (CI-06). */
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
  format: ArtifactFormat;
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
  | "webview2-offline-installer"
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
