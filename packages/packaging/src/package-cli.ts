/** Shared native packaging workflow; platform scripts only select the OS. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { assembleRuntimeLayout } from "./assemble.ts";
import { LINUX_BUILD_BASELINE } from "./baseline.ts";
import { loadTargets, validateRuntimeManifest } from "./load.ts";
import { artifactName, portableArtifactName, portableFormats } from "./matrix.ts";
import type { PortableFormat, ReleaseTarget, RuntimeManifest, TargetOs } from "./types.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function parsePackageArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      variant: { type: "string", default: "all" },
      arch: { type: "string" },
      distro: { type: "string" },
      "skip-assemble": { type: "boolean", default: false },
      portable: { type: "boolean", default: false },
    },
  });
  if (!["all", "bootstrap", "offline"].includes(values.variant))
    throw new Error("invalid --variant");
  return values;
}

export function nativeArch(os: TargetOs, platform = process.platform, arch = process.arch): string {
  const wanted = os === "windows" ? "win32" : os === "macos" ? "darwin" : "linux";
  if (platform !== wanted || !["x64", "arm64"].includes(arch))
    throw new Error(`package-${os} requires a native x64/arm64 host`);
  return os === "linux" ? (arch === "arm64" ? "aarch64" : "x86_64") : arch;
}

export function detectDistro(text: string): string {
  const field = (name: string) =>
    new RegExp(`^${name}=(.*)$`, "m")
      .exec(text)?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, "") ?? "";
  const id = field("ID");
  const version = field("VERSION_ID");
  if (id === "ubuntu") return `${id}-${version}`;
  throw new Error(`unsupported build host ${id}/${version} (baseline is ${LINUX_BUILD_BASELINE})`);
}

/** Reuse never changes a manifest identity or silently trusts edited payloads. */
export function verifyReusableLayout(
  dir: string,
  target: ReleaseTarget,
  version: string,
  commit: string,
): RuntimeManifest {
  const manifest = validateRuntimeManifest(
    JSON.parse(readFileSync(path.join(dir, "runtime-manifest.json"), "utf8")),
  );
  for (const key of [
    "os",
    "arch",
    "variant",
    "targetTriple",
    "webviewStrategy",
    "minimumWebview",
    "osVersionRange",
  ] as const) {
    if (manifest[key] !== target[key]) throw new Error(`--skip-assemble target mismatch: ${key}`);
  }
  if (manifest.appVersion !== version || manifest.sourceCommit !== commit)
    throw new Error("--skip-assemble version/commit mismatch");
  for (const file of manifest.files) {
    const payload = readFileSync(path.join(dir, file.path));
    if (
      payload.length !== file.size ||
      createHash("sha256").update(payload).digest("hex") !== file.sha256
    )
      throw new Error(`--skip-assemble payload mismatch: ${file.path}`);
  }
  return manifest;
}

export function selectArtifact(dir: string, extension: string, builtAfter: number): string {
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith(extension))
        .map((name) => path.join(dir, name))
        .filter((file) => statSync(file).mtimeMs >= builtAfter)
    : [];
  if (files.length !== 1)
    throw new Error(`expected one fresh ${extension} artifact under ${dir}, found ${files.length}`);
  return files[0] as string;
}

/** macOS portable 打包：ditto 压缩 .app（保留符号链接/xattr，--keepParent 使
 * zip 根为 <productName>.app）。仅 darwin 宿主可达（nativeArch 已保证）。 */
export function zipMacAppBundle(appPath: string, dest: string): void {
  const result = spawnSync(
    "ditto",
    ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, dest],
    { stdio: "inherit", timeout: 10 * 60_000, windowsHide: true },
  );
  if (result.error || result.status !== 0)
    throw new Error(`ditto zip failed (${result.error?.message ?? result.status})`);
}

const TAURI_CLI = path.join(ROOT, "node_modules/@tauri-apps/cli/tauri.js");

function runTauriBuild(args: string[]): void {
  const result = spawnSync(process.execPath, [TAURI_CLI, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
    timeout: 45 * 60_000,
  });
  if (result.error || result.status !== 0)
    throw new Error(`tauri build failed (${result.error?.message ?? result.status})`);
}

/** Portable 归档固定顶层目录名（= productName），解压后 `./xresconv-gui/`
 * 即应用根（Windows zip 与 Linux tar.zst 一致）。 */
const PORTABLE_TAR_TOPDIR = "xresconv-gui";
const PORTABLE_TAR_STAGE = path.join(ROOT, "build/portable-tar");
const PORTABLE_ZIP_STAGE = path.join(ROOT, "build/portable-zip");

function tarStageTo(dest: string): void {
  // 用户 2026-09-28 决策：Linux 归档一律 zstd 压缩（tar.zst）。GNU tar 经
  // --zstd 调用 PATH 上的 zstd（CI Linux apt 安装；本机/官方镜像均内置）。
  const result = spawnSync(
    "tar",
    ["--zstd", "-cf", dest, "-C", PORTABLE_TAR_STAGE, PORTABLE_TAR_TOPDIR],
    {
      stdio: "inherit",
      timeout: 10 * 60_000,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(`tar failed (${result.error?.message ?? result.status})`);
}

/** Windows portable zip：解压后进入 xresconv-gui/ 直接双击 xresconv-gui.exe。
 * 用户 2026-09-28 决策：不创建安装包；WebView2 用系统 Evergreen 运行时，包内
 * 附官方 bootstrapper（MicrosoftEdgeWebview2Setup.exe）作为修复通道，壳预检
 * 缺失时弹窗指引。仅 windows 宿主可达（nativeArch 已保证）。 */
export function zipPortableWindowsLayout(
  exePath: string,
  layoutDir: string,
  bootstrapperPath: string,
  dest: string,
): void {
  rmSync(PORTABLE_ZIP_STAGE, { recursive: true, force: true });
  const top = path.join(PORTABLE_ZIP_STAGE, PORTABLE_TAR_TOPDIR);
  mkdirSync(top, { recursive: true });
  try {
    copyFileSync(exePath, path.join(top, "xresconv-gui.exe"));
    // tauri/wry 的 WebView2 loader：--no-bundle 时由 cargo 构建产物携带。
    const loader = path.join(path.dirname(exePath), "WebView2Loader.dll");
    if (existsSync(loader)) copyFileSync(loader, path.join(top, "WebView2Loader.dll"));
    cpSync(path.join(layoutDir, "runtime"), path.join(top, "runtime"), { recursive: true });
    cpSync(path.join(layoutDir, "app"), path.join(top, "app"), { recursive: true });
    copyFileSync(
      path.join(layoutDir, "runtime-manifest.json"),
      path.join(top, "runtime-manifest.json"),
    );
    copyFileSync(bootstrapperPath, path.join(top, "MicrosoftEdgeWebview2Setup.exe"));
    const result = spawnSync(
      "pwsh",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Compress-Archive -LiteralPath '${path.join(PORTABLE_ZIP_STAGE, PORTABLE_TAR_TOPDIR)}' -DestinationPath '${dest}' -Force`,
      ],
      { stdio: "inherit", timeout: 10 * 60_000, windowsHide: true },
    );
    if (result.error || result.status !== 0)
      throw new Error(`Compress-Archive failed (${result.error?.message ?? result.status})`);
  } finally {
    rmSync(PORTABLE_ZIP_STAGE, { recursive: true, force: true });
  }
}

/** WebView2 Evergreen bootstrapper 官方稳定短链（微软文档引用）；zip 内
 * sidecar 的唯一来源。下载后缓存到 build/，MZ 头 + 体积下限防半截文件。 */
const WEBVIEW2_BOOTSTRAPPER_URL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
const WEBVIEW2_BOOTSTRAPPER_CACHE = path.join(ROOT, "build/webview2-bootstrapper");

async function ensureWebView2Bootstrapper(): Promise<string> {
  const dest = path.join(WEBVIEW2_BOOTSTRAPPER_CACHE, "MicrosoftEdgeWebview2Setup.exe");
  const plausible = (buf: Buffer) => buf.length > 1_000_000 && buf[0] === 0x4d && buf[1] === 0x5a;
  if (existsSync(dest) && plausible(readFileSync(dest))) return dest;
  mkdirSync(WEBVIEW2_BOOTSTRAPPER_CACHE, { recursive: true });
  const response = await fetch(WEBVIEW2_BOOTSTRAPPER_URL, { redirect: "follow" });
  if (!response.ok)
    throw new Error(`webview2 bootstrapper download failed: HTTP ${response.status}`);
  const payload = Buffer.from(await response.arrayBuffer());
  if (!plausible(payload))
    throw new Error("webview2 bootstrapper payload is not a Windows executable");
  writeFileSync(dest, payload);
  return dest;
}

/** Linux offline portable：已产出的自含 AppImage `--appimage-extract`（免 FUSE，
 * 内容与 AppImage 逐字节一致）后重压为 tar.zst——复用 linuxdeploy 闭包，不在
 * 脚本侧重造依赖收集。仅 linux 宿主可达。 */
export function tarPortableFromAppImage(appImagePath: string, dest: string): void {
  rmSync(PORTABLE_TAR_STAGE, { recursive: true, force: true });
  mkdirSync(PORTABLE_TAR_STAGE, { recursive: true });
  try {
    const result = spawnSync(appImagePath, ["--appimage-extract"], {
      cwd: PORTABLE_TAR_STAGE,
      timeout: 10 * 60_000,
      windowsHide: true,
    });
    if (result.error || result.status !== 0)
      throw new Error(`appimage extract failed (${result.error?.message ?? result.status})`);
    renameSync(
      path.join(PORTABLE_TAR_STAGE, "squashfs-root"),
      path.join(PORTABLE_TAR_STAGE, PORTABLE_TAR_TOPDIR),
    );
    tarStageTo(dest);
  } finally {
    rmSync(PORTABLE_TAR_STAGE, { recursive: true, force: true });
  }
}

/** Linux bootstrap portable：裸 exe + 发行布局平铺（exe 同级 runtime/app/
 * runtime-manifest.json/preflight.sh），运行时复用系统 WebKitGTK。仅 linux
 * 宿主可达（nativeArch 已保证）。 */
export function tarPortableBootstrapLayout(exePath: string, layoutDir: string, dest: string): void {
  rmSync(PORTABLE_TAR_STAGE, { recursive: true, force: true });
  const top = path.join(PORTABLE_TAR_STAGE, PORTABLE_TAR_TOPDIR);
  mkdirSync(top, { recursive: true });
  try {
    copyFileSync(exePath, path.join(top, "xresconv-gui"));
    chmodSync(path.join(top, "xresconv-gui"), 0o755);
    cpSync(path.join(layoutDir, "runtime"), path.join(top, "runtime"), { recursive: true });
    cpSync(path.join(layoutDir, "app"), path.join(top, "app"), { recursive: true });
    copyFileSync(
      path.join(layoutDir, "runtime-manifest.json"),
      path.join(top, "runtime-manifest.json"),
    );
    copyFileSync(path.join(ROOT, "packaging/linux/preflight.sh"), path.join(top, "preflight.sh"));
    chmodSync(path.join(top, "preflight.sh"), 0o755);
    tarStageTo(dest);
  } finally {
    rmSync(PORTABLE_TAR_STAGE, { recursive: true, force: true });
  }
}

function git(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error("cannot obtain repository identity");
  return result.stdout.trim();
}

/** 当前 HEAD（浅 clone 亦可）；verify-portable 复用同一仓库身份。 */
export function gitHead(): string {
  return git(["rev-parse", "HEAD"]);
}

function signingBundle(os: TargetOs): Record<string, unknown> {
  if (os === "macos" && process.env.XRESCONV_MACOS_SIGNING_IDENTITY)
    return { macOS: { signingIdentity: process.env.XRESCONV_MACOS_SIGNING_IDENTITY } };
  if (
    os !== "windows" ||
    (!process.env.XRESCONV_SIGN_CERT_THUMBPRINT && !process.env.XRESCONV_SIGN_COMMAND)
  )
    return {};
  return {
    windows: {
      digestAlgorithm: process.env.XRESCONV_SIGN_DIGEST_ALGORITHM ?? "sha256",
      timestampUrl: process.env.XRESCONV_SIGN_TIMESTAMP_URL ?? "http://timestamp.digicert.com",
      ...(process.env.XRESCONV_SIGN_CERT_THUMBPRINT
        ? { certificateThumbprint: process.env.XRESCONV_SIGN_CERT_THUMBPRINT }
        : {}),
      ...(process.env.XRESCONV_SIGN_COMMAND
        ? { signCommand: process.env.XRESCONV_SIGN_COMMAND }
        : {}),
    },
  };
}

export async function packageNative(os: TargetOs, args = process.argv.slice(2)): Promise<void> {
  const options = parsePackageArgs(args);
  const arch = nativeArch(os);
  if (options.arch !== undefined && options.arch !== arch)
    throw new Error("--arch must match the native host architecture");
  // Linux 归档发行版无关，但必须在最老支持基线上构建（glibc 地板）；宿主探测
  // 与期望基线（--distro，默认 ubuntu-22.04）不一致即 fail-closed。
  const distro = os === "linux" ? detectDistro(readFileSync("/etc/os-release", "utf8")) : undefined;
  const expectedDistro =
    distro === undefined ? undefined : (options.distro ?? LINUX_BUILD_BASELINE);
  if (distro !== undefined && distro !== expectedDistro)
    throw new Error(`linux archives must be built on ${expectedDistro}, host is ${distro}`);
  const version = (
    JSON.parse(readFileSync(path.join(ROOT, "src-tauri/tauri.conf.json"), "utf8")) as {
      version: string;
    }
  ).version;
  const tag =
    process.env.GITHUB_REF_TYPE === "tag"
      ? process.env.GITHUB_REF_NAME?.replace(/^v/, "")
      : undefined;
  if (tag && tag !== version)
    throw new Error(`release tag ${tag} disagrees with tauri.conf.json version ${version}`);
  const variants = options.variant === "all" ? ["bootstrap", "offline"] : [options.variant];
  if (options["skip-assemble"] && variants.length > 1)
    throw new Error("--skip-assemble requires one explicit --variant");
  const targets = loadTargets().targets;
  const commit = git(["rev-parse", "HEAD"]);
  const layout = path.join(ROOT, "build/release-layout");
  const output = path.join(ROOT, "build/dist");
  const overlays = path.join(ROOT, "build/package-config");
  mkdirSync(output, { recursive: true });
  mkdirSync(overlays, { recursive: true });
  let bootstrapper: string | undefined;
  for (const variant of variants) {
    const target = targets.find((t) => t.os === os && t.arch === arch && t.variant === variant);
    if (!target) throw new Error(`no declared target for ${os}/${arch}/${variant}`);
    if (options["skip-assemble"]) verifyReusableLayout(layout, target, version, commit);
    else {
      // This fixed, repo-owned directory contains only generated staging data.
      rmSync(layout, { recursive: true, force: true });
      await assembleRuntimeLayout({
        target,
        outDir: layout,
        node: {
          path: process.execPath,
          source: `local-build:node-v${process.versions.node}-${process.platform}-${process.arch}`,
        },
        appVersion: version,
        sourceCommit: commit,
        repositorySnapshot: {
          repository: "https://github.com/xresloader/xresconv-gui.git",
          dirty: git(["status", "--porcelain"]).length > 0,
        },
        // Building alone is not installer acceptance. A controlled release must replace this evidence.
        verificationReport: { result: "fail", reportPath: "docs/plan/05-packaging-release.md" },
      });
    }
    const baseName =
      os === "macos" ? "tauri.macos.release.conf.json" : `tauri.${os}.${variant}.conf.json`;
    const base = JSON.parse(readFileSync(path.join(ROOT, "src-tauri", baseName), "utf8"));
    const signing = signingBundle(os);
    for (const key of Object.keys(signing))
      base.bundle[key] = { ...base.bundle[key], ...(signing[key] as object) };
    // macOS release 产物是 dmg 安装器（--portable 时为未签名 .app.zip，供
    // portable 管线）；Windows/Linux 一律 portable 归档（用户 2026-09-28
    // 决策：Windows zip 解压即双击、Linux tar.zst 解压即运行 + offline
    // AppImage 并存），与是否传 --portable 无关。
    const formats: Array<PortableFormat | "dmg-installer"> =
      os === "windows"
        ? ["zip"]
        : os === "linux"
          ? portableFormats(target)
          : options.portable
            ? ["app.zip"]
            : ["dmg-installer"];
    let appimageSource: string | undefined;
    for (const format of formats) {
      const started = Date.now();
      const name =
        format === "dmg-installer"
          ? artifactName(target, version)
          : portableArtifactName(target, version, format);
      const dest = path.join(output, name);
      if (format === "tar.zst") {
        // Linux "解压即运行" tar.zst。两种来源：offline = 已产出的自含 AppImage
        // 解包重压（复用 linuxdeploy 闭包，用户侧免 FUSE 免安装）；bootstrap =
        // 裸 exe（tauri build --no-bundle）+ 发行布局平铺，运行时用系统
        // WebKitGTK（preflight.sh 探测/指引）。
        if (variant === "offline") {
          if (appimageSource === undefined)
            throw new Error("offline tar.zst requires the appimage build in the same invocation");
          tarPortableFromAppImage(appimageSource, dest);
        } else {
          runTauriBuild(["build", "--no-bundle"]);
          const exe = path.join(ROOT, "target/release", "xresconv-gui");
          if (!existsSync(exe)) throw new Error(`app binary not found: ${exe}`);
          tarPortableBootstrapLayout(exe, layout, dest);
        }
      } else if (format === "zip") {
        // Windows "解压即双击" zip：裸 exe + 发行布局 + WebView2 bootstrapper。
        runTauriBuild(["build", "--no-bundle"]);
        const exe = path.join(ROOT, "target/release", "xresconv-gui.exe");
        if (!existsSync(exe)) throw new Error(`app binary not found: ${exe}`);
        if (bootstrapper === undefined) bootstrapper = await ensureWebView2Bootstrapper();
        zipPortableWindowsLayout(exe, layout, bootstrapper, dest);
      } else if (format === "appimage") {
        base.bundle.targets = ["appimage"];
        const overlay = path.join(overlays, `tauri.${os}.${variant}.conf.json`);
        writeFileSync(overlay, `${JSON.stringify(base, null, 2)}\n`, "utf8");
        runTauriBuild(["build", "--config", overlay]);
        const source = selectArtifact(
          path.join(ROOT, "target/release/bundle", "appimage"),
          ".AppImage",
          started,
        );
        cpSync(source, dest);
        appimageSource = source;
      } else if (format === "app.zip") {
        // Tauri 的 "app" 目标产出 bundle/macos/<productName>.app 目录。ditto
        // 保留符号链接/元数据并以 .app 为包根压缩；无签名身份环境时 bundler
        // 跳过签名（v2.11.5 keychain()=None），portable 即未签名 .app。
        base.bundle.targets = ["app"];
        const overlay = path.join(overlays, `tauri.${os}.${variant}.conf.json`);
        writeFileSync(overlay, `${JSON.stringify(base, null, 2)}\n`, "utf8");
        runTauriBuild(["build", "--config", overlay]);
        const app = selectArtifact(path.join(ROOT, "target/release/bundle/macos"), ".app", started);
        zipMacAppBundle(app, dest);
      } else {
        // macOS dmg 安装器（macos 非 --portable 的唯一产物）。
        base.bundle.targets = ["dmg"];
        const overlay = path.join(overlays, `tauri.${os}.${variant}.conf.json`);
        writeFileSync(overlay, `${JSON.stringify(base, null, 2)}\n`, "utf8");
        runTauriBuild(["build", "--config", overlay]);
        const source = selectArtifact(
          path.join(ROOT, "target/release/bundle", "dmg"),
          ".dmg",
          started,
        );
        cpSync(source, dest);
      }
      const digest = createHash("sha256").update(readFileSync(dest)).digest("hex");
      writeFileSync(`${dest}.sha256`, `${digest}  ${name}\n`, "utf8");
      console.log(`${digest}  ${name}`);
    }
  }
}
