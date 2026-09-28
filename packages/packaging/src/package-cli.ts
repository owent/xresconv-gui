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
 * 用户 2026-09-28 决策：不创建安装包。bootstrap 变体 WebView2 用系统
 * Evergreen 运行时，包内附官方 bootstrapper（MicrosoftEdgeWebview2Setup.exe）
 * 作为修复通道，壳预检缺失时弹窗指引；offline 变体内嵌 Fixed Version 运行时
 * （webview2-runtime/ 目录，壳以 WEBVIEW2_BROWSER_EXECUTABLE_FOLDER 指向它）。
 * 仅 windows 宿主可达（nativeArch 已保证）。 */
export interface WindowsZipExtras {
  bootstrapper?: string;
  fixedRuntimeDir?: string;
}

/** 组装 Windows portable 顶层目录（zip 与 tar.zst 共用）：exe + wry 的
 * WebView2Loader.dll + 发行布局（runtime/app/manifest）+ WebView2 附件
 * （bootstrap 附 bootstrapper sidecar；offline 内嵌 fixed runtime）。返回
 * PORTABLE_ZIP_STAGE，调用方负责压缩后清理。 */
function stageWindowsPortableTop(
  exePath: string,
  layoutDir: string,
  extras: WindowsZipExtras,
): void {
  rmSync(PORTABLE_ZIP_STAGE, { recursive: true, force: true });
  const top = path.join(PORTABLE_ZIP_STAGE, PORTABLE_TAR_TOPDIR);
  mkdirSync(top, { recursive: true });
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
  if (extras.bootstrapper)
    copyFileSync(extras.bootstrapper, path.join(top, "MicrosoftEdgeWebview2Setup.exe"));
  if (extras.fixedRuntimeDir)
    cpSync(extras.fixedRuntimeDir, path.join(top, "webview2-runtime"), { recursive: true });
}

/** Windows bootstrap zip（42MiB 级，双击解压）：Compress-Archive（DEFLATE）
 * 对小负载够用，且保留全 Windows 版本原生双击解压。 */
export function zipPortableWindowsLayout(
  exePath: string,
  layoutDir: string,
  dest: string,
  extras: WindowsZipExtras = {},
): void {
  stageWindowsPortableTop(exePath, layoutDir, extras);
  try {
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

/** Windows offline tar.zst（内嵌 ~668MiB Fixed Version 运行时）：DEFLATE zip
 * 对已压缩的 WebView2 二进制收益低（344MiB）；改用 zstd L19 后 260MiB
 * （−24.5%），多线程 ~49s（2026-09-28 本机实测，见 source-index）。用 Windows
 * 内置 `tar`（bsdtar/libarchive，含 zstd）压缩，无需额外二进制。用户侧同样用
 * 内置 `tar --zstd -xf` 解压，离线场景零依赖。
 *
 * bsdtar 对未知 `--options` 是致命错误（非忽略，本机实证 exit 1）；libarchive
 * <3.6 无 `zstd:threads`。故先试全核多线程（静默捕获，避免退回成功时污染
 * 日志），不支持则退回单线程 L19（~284s，产物一致）。 */
export function tarZstPortableWindowsLayout(
  exePath: string,
  layoutDir: string,
  dest: string,
  extras: WindowsZipExtras = {},
): void {
  stageWindowsPortableTop(exePath, layoutDir, extras);
  // Windows 宿主的 tar 可能是 MSYS GNU tar（本机 Git Bash）或 System32
  // bsdtar（CI pwsh），能力矩阵不同（本机/CI 双实证）：
  // - 盘符冒号：GNU tar 当远程主机语法（叠加 MSYS 反斜杠转义 → broken
  //   pipe），需 --force-local + 正斜杠；bsdtar 不支持 --force-local（致命
  //   错误），但正斜杠盘符路径本身可用 → 按 --version 探测实现自适应。
  // - 压缩级别：两者 --use-compress-program 皆支持（外部 zstd -19 -T0）；
  //   bsdtar --zstd 不收级别、--options 不存在。
  const tarVersion = spawnSync("tar", ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  const isBsdtar = (tarVersion.stdout ?? "").includes("bsdtar");
  const posix = (value: string) => value.replaceAll("\\", "/");
  const base = [
    ...(isBsdtar ? [] : ["--force-local"]),
    "-cf",
    posix(dest),
    "-C",
    posix(PORTABLE_ZIP_STAGE),
    PORTABLE_TAR_TOPDIR,
  ];
  try {
    // 级别/线程控制走外部 zstd 过滤程序（--use-compress-program 是 GNU tar 与
    // bsdtar 的公共子集；bsdtar 3.8.8 的 --zstd 不接受级别、--options 不存在，
    // 本机实测）。PATH 无 zstd 时回退 tar 内置压缩器（默认级别，零依赖）。
    const multithreaded = spawnSync(
      "tar",
      ["--use-compress-program", "zstd -19 -T0", ...base],
      { encoding: "utf8", timeout: 15 * 60_000, windowsHide: true },
    );
    if (multithreaded.status !== 0) {
      const fallback = spawnSync("tar", ["--zstd", ...base], {
        stdio: "inherit",
        timeout: 20 * 60_000,
        windowsHide: true,
      });
      if (fallback.error || fallback.status !== 0)
        throw new Error(
          `tar --zstd failed (${fallback.error?.message ?? fallback.status})`,
        );
    }
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

/** WebView2 Fixed Version 官方下载页（HTML 静态内嵌全部直链，无需 JS 渲染；
 * 2026-09-28 curl 实证）。无官方 API（WebView2Feedback#3372），页面结构变化
 * 时解析失败即 fail-closed 中止构建，不产出残缺 offline 包。 */
export const WEBVIEW2_DOWNLOAD_PAGE = "https://developer.microsoft.com/en-us/microsoft-edge/webview2/";
const FIXED_RUNTIME_PATTERN =
  /msedge\.sf\.dl\.delivery\.mp\.microsoft\.com(?:\\u002F|\/)filestreamingservice(?:\\u002F|\/)files(?:\\u002F|\/)([0-9a-f-]+)(?:\\u002F|\/)(Microsoft\.WebView2\.FixedVersionRuntime\.(\d+\.\d+\.\d+\.\d+)\.(x64|x86|arm64)\.cab)/g;

export interface FixedRuntimeLink {
  url: string;
  version: string;
  arch: "x64" | "x86" | "arm64";
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 4; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

/** 纯函数：从下载页 HTML 解析每个架构的最高版本 cab 直链。URL 里的
 * `\u002F` 转义还原为 `/`；同架构多版本取最高（页面保证最新两大版本的
 * most-patched 可下载）。 */
export function parseFixedRuntimeLinks(
  html: string,
): Map<"x64" | "x86" | "arm64", FixedRuntimeLink> {
  const best = new Map<"x64" | "x86" | "arm64", FixedRuntimeLink>();
  for (const match of html.matchAll(FIXED_RUNTIME_PATTERN)) {
    const guid = match[1] as string;
    const file = (match[2] as string).replace(/\\u002F/g, "/");
    const version = match[3] as string;
    const arch = match[4] as "x64" | "x86" | "arm64";
    const url = `https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/${guid}/${file}`;
    const current = best.get(arch);
    if (current === undefined || compareVersions(version, current.version) > 0)
      best.set(arch, { url, version, arch });
  }
  return best;
}

const WEBVIEW2_FIXED_CACHE = path.join(ROOT, "build/webview2-fixedruntime");

/** Windows offline zip 的 Fixed Version 运行时（2026-09-28 决策）：抓官方下载
 * 页取直链（无 API，见 parseFixedRuntimeLinks）→ cab 下载缓存（MSCF 魔数 +
 * 体积下限校验）→ `expand -F:*` 解压（官方指定方式）。返回解压出的运行时
 * 目录（Microsoft.WebView2.FixedVersionRuntime.<version>.<arch>/）。 */
export async function ensureWebView2FixedRuntime(arch: "x64" | "arm64"): Promise<string> {
  const page = await fetch(WEBVIEW2_DOWNLOAD_PAGE, { redirect: "follow" });
  if (!page.ok) throw new Error(`webview2 download page fetch failed: HTTP ${page.status}`);
  const link = parseFixedRuntimeLinks(await page.text()).get(arch);
  if (link === undefined)
    throw new Error(`no Fixed Version runtime link for ${arch} on the download page`);
  const cab = path.join(WEBVIEW2_FIXED_CACHE, `Microsoft.WebView2.FixedVersionRuntime.${link.version}.${arch}.cab`);
  const extractRoot = path.join(WEBVIEW2_FIXED_CACHE, "extracted", `${link.version}-${arch}`);
  const runtimeDir = path.join(extractRoot, `Microsoft.WebView2.FixedVersionRuntime.${link.version}.${arch}`);
  if (existsSync(path.join(runtimeDir, "msedgewebview2.exe"))) return runtimeDir;
  if (!existsSync(cab)) {
    const response = await fetch(link.url, { redirect: "follow" });
    if (!response.ok) throw new Error(`fixed runtime download failed: HTTP ${response.status}`);
    const payload = Buffer.from(await response.arrayBuffer());
    if (payload.length < 100_000_000 || payload.subarray(0, 4).toString("ascii") !== "MSCF")
      throw new Error("fixed runtime payload is not a complete cabinet file");
    mkdirSync(WEBVIEW2_FIXED_CACHE, { recursive: true });
    writeFileSync(cab, payload);
  }
  rmSync(extractRoot, { recursive: true, force: true });
  mkdirSync(extractRoot, { recursive: true });
  // expand.exe（System32 内置）是官方文档指定的 cab 解压方式；-F:* 展开全部
  // 文件。必须绝对路径调用：Git Bash 环境的 /usr/bin/expand（tab 转空格工具）
  // 会遮蔽 PATH 查找（本机实证 exit 1）。
  const systemExpand = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "expand.exe");
  const result = spawnSync(systemExpand, [cab, "-F:*", extractRoot], {
    stdio: "inherit",
    timeout: 10 * 60_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error(`expand failed (${result.error?.message ?? result.status})`);
  if (!existsSync(path.join(runtimeDir, "msedgewebview2.exe")))
    throw new Error(`fixed runtime layout unexpected: ${runtimeDir} has no msedgewebview2.exe`);
  return runtimeDir;
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
  let fixedRuntime: string | undefined;
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
    // 决策）：Windows bootstrap zip 解压即双击、offline tar.zst（zstd 压缩，
    // 体积优化）；Linux tar.zst 解压即运行 + offline AppImage 并存。与是否
    // 传 --portable 无关。
    const formats: Array<PortableFormat | "dmg-installer"> =
      os === "windows" || os === "linux"
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
        if (os === "windows") {
          // Windows offline "解压即用" tar.zst：裸 exe + 发行布局 + 内嵌 Fixed
          // Version 运行时（webview2-runtime/，壳启动时指向它，完全离线）。
          // zstd L19 多线程压缩，用 Windows 内置 tar 解压，离线场景零依赖。
          runTauriBuild(["build", "--no-bundle"]);
          const exe = path.join(ROOT, "target/release", "xresconv-gui.exe");
          if (!existsSync(exe)) throw new Error(`app binary not found: ${exe}`);
          if (fixedRuntime === undefined)
            fixedRuntime = await ensureWebView2FixedRuntime(arch === "x64" ? "x64" : "arm64");
          tarZstPortableWindowsLayout(exe, layout, dest, { fixedRuntimeDir: fixedRuntime });
        } else if (variant === "offline") {
          // Linux "解压即运行" tar.zst：已产出的自含 AppImage 解包重压（复用
          // linuxdeploy 闭包，用户侧免 FUSE 免安装）。
          if (appimageSource === undefined)
            throw new Error("offline tar.zst requires the appimage build in the same invocation");
          tarPortableFromAppImage(appimageSource, dest);
        } else {
          // Linux bootstrap：裸 exe（tauri build --no-bundle）+ 发行布局平铺，
          // 运行时用系统 WebKitGTK（preflight.sh 探测/指引）。
          runTauriBuild(["build", "--no-bundle"]);
          const exe = path.join(ROOT, "target/release", "xresconv-gui");
          if (!existsSync(exe)) throw new Error(`app binary not found: ${exe}`);
          tarPortableBootstrapLayout(exe, layout, dest);
        }
      } else if (format === "zip") {
        // Windows bootstrap "解压即双击" zip：裸 exe + 发行布局 + 官方
        // bootstrapper sidecar（Evergreen 修复通道）。offline 已改用 tar.zst
        // （zstd 压缩，体积优化，见 tarZstPortableWindowsLayout）。
        runTauriBuild(["build", "--no-bundle"]);
        const exe = path.join(ROOT, "target/release", "xresconv-gui.exe");
        if (!existsSync(exe)) throw new Error(`app binary not found: ${exe}`);
        if (bootstrapper === undefined) bootstrapper = await ensureWebView2Bootstrapper();
        zipPortableWindowsLayout(exe, layout, dest, { bootstrapper });
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
