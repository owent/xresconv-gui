/** Portable 产物验证（portable-build.yml）：安装器链路从不产出这些形态，
 * 因此每个 portable 产物在解包后按自身 manifest 逐文件核验，并实测包内
 * Node 二进制可在当前宿主原生运行（架构正确性的直接证据）。聚合口径 =
 * portableArtifactNames 精确集合（fail-closed）。
 *
 * Linux 两种 tar.zst（2026-09-28 用户决策 zstd 压缩）：offline = AppImage
 * 同内容解包树（自含 WebKitGTK 闭包）；bootstrap = exe+布局平铺（运行时用
 * 系统 WebKitGTK，宿主须已具备——ldd 与 preflight.sh 探针在这里充当运行时
 * 策略的证据）。 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { loadTargets, validateRuntimeManifest } from "./load.ts";
import { portableArtifactName, portableArtifactNames, portableFormats } from "./matrix.ts";
import { verifyReleaseArtifacts } from "./release-artifacts.ts";
import type { ReleaseTarget, RuntimeManifest, TargetVariant } from "./types.ts";

const EXTRACT_TIMEOUT_MS = 5 * 60_000;
const NODE_PROBE_TIMEOUT_MS = 30_000;
const LAYOUT_SEARCH_DEPTH = 8;

export interface PortableExpectation {
  os: "macos" | "linux";
  arch: string;
  variant: TargetVariant;
  version: string;
  commit: string;
}

export function resolvePortableTarget(
  os: "macos" | "linux",
  arch: string,
  variant: TargetVariant,
): ReleaseTarget {
  const target = loadTargets().targets.find(
    (t) => t.os === os && t.arch === arch && t.variant === variant,
  );
  if (!target) throw new Error(`no declared portable target for ${os}/${arch}/${variant}`);
  return target;
}

/** 从解包根向下定位发行布局根（runtime-manifest.json 所在目录）。
 * runtime/app 负载树剪枝——manifest 与它们同级，绝不内嵌。 */
export function findLayoutRoot(extractedDir: string): string {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: extractedDir, depth: 0 }];
  while (queue.length > 0) {
    const head = queue.shift();
    if (head === undefined) break;
    for (const entry of readdirSync(head.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        if (entry.name === "runtime-manifest.json") return head.dir;
        continue;
      }
      if (entry.name === "runtime" || entry.name === "app" || head.depth >= LAYOUT_SEARCH_DEPTH)
        continue;
      queue.push({ dir: path.join(head.dir, entry.name), depth: head.depth + 1 });
    }
  }
  throw new Error(`runtime-manifest.json not found under ${extractedDir}`);
}

/** 身份核验：解包 manifest 与目标/本次构建完全一致，不做任何模糊匹配。 */
export function verifyLayoutIdentity(
  manifest: RuntimeManifest,
  expected: PortableExpectation,
  target: ReleaseTarget,
): void {
  for (const [key, want] of [
    ["os", expected.os],
    ["arch", target.arch],
    ["variant", target.variant],
    ["targetTriple", target.targetTriple],
    ["webviewStrategy", target.webviewStrategy],
    ["minimumWebview", target.minimumWebview],
    ["osVersionRange", target.osVersionRange],
    ["appVersion", expected.version],
    ["sourceCommit", expected.commit],
  ] as const) {
    if (manifest[key] !== want) throw new Error(`layout identity mismatch: ${key}`);
  }
}

/** 负载核验：manifest.files 全量存在 + 大小 + SHA-256（与 verifyReusableLayout
 * 同强度；布局组装阶段已验过一次，这里证明打包未损坏负载）。 */
export function verifyLayoutPayload(layoutRoot: string, manifest: RuntimeManifest): void {
  if (manifest.files.length === 0) throw new Error("layout payload is empty");
  for (const file of manifest.files) {
    const payloadPath = path.join(layoutRoot, ...file.path.split("/"));
    if (!existsSync(payloadPath)) throw new Error(`layout payload missing: ${file.path}`);
    const payload = readFileSync(payloadPath);
    if (
      payload.length !== file.size ||
      createHash("sha256").update(payload).digest("hex") !== file.sha256
    )
      throw new Error(`layout payload mismatch: ${file.path}`);
  }
}

/** 包内 Node 必须在当前宿主原生可执行——架构/OS 正确性的直接探针。 */
export function verifyBundledNode(layoutRoot: string, manifest: RuntimeManifest): string {
  const nodePath = path.join(
    layoutRoot,
    "runtime",
    process.platform === "win32" ? "node.exe" : "node",
  );
  const result = spawnSync(nodePath, ["--version"], {
    encoding: "utf8",
    timeout: NODE_PROBE_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || result.stdout === undefined)
    throw new Error(
      `bundled node probe failed: ${String(result.error ?? `exit ${result.status}`)}`,
    );
  const version = result.stdout.trim();
  if (version !== `v${manifest.nodeVersion}`)
    throw new Error(
      `bundled node version ${version} does not match manifest ${manifest.nodeVersion}`,
    );
  return version;
}

function readInfoPlistVersion(appDir: string, manifest: RuntimeManifest): void {
  const plist = readFileSync(path.join(appDir, "Contents", "Info.plist"), "utf8");
  if (
    !plist.includes("LSMinimumSystemVersion") ||
    !plist.includes(manifest.osVersionRange.replace(">=", ""))
  )
    throw new Error("Info.plist is missing the D5 minimum system version");
  const mainBinary = path.join(appDir, "Contents", "MacOS", path.basename(appDir, ".app"));
  if (!existsSync(mainBinary)) throw new Error(`main binary missing: ${mainBinary}`);
}

function verifyLinuxExtras(squashRoot: string): void {
  if (!existsSync(path.join(squashRoot, "AppRun"))) throw new Error("AppImage is missing AppRun");
  const usrLib = readdirSync(path.join(squashRoot, "usr", "lib"));
  if (!usrLib.some((name) => name === "libwebkit2gtk-4.1.so.0"))
    throw new Error("self-contained package does not bundle WebKitGTK 4.1");
}

/** bootstrap tar.zst 专属：平铺布局（无 AppDir/usr 树）、系统 WebKitGTK 运行时
 * （ldd 必须解析到 webkit4.1——这就是"尽量复用发行版运行时"的直接证据）、
 * preflight.sh 可执行且就绪路径通过。 */
function verifyBootstrapExtras(topDir: string): void {
  const exe = path.join(topDir, "xresconv-gui");
  if (!existsSync(exe)) throw new Error("bootstrap tarball is missing the app binary");
  const preflight = path.join(topDir, "preflight.sh");
  if (!existsSync(preflight)) throw new Error("bootstrap tarball is missing preflight.sh");
  if (existsSync(path.join(topDir, "usr")))
    throw new Error("bootstrap tarball must be a flat layout (no AppDir usr tree)");
  const ldd = spawnSync("ldd", [exe], {
    encoding: "utf8",
    timeout: NODE_PROBE_TIMEOUT_MS,
    windowsHide: true,
  });
  if (ldd.error || ldd.status !== 0 || ldd.stdout === undefined)
    throw new Error(`ldd probe failed: ${String(ldd.error ?? ldd.status)}`);
  const webkitLine = ldd.stdout.split("\n").find((line) => line.includes("libwebkit2gtk-4.1.so.0"));
  if (webkitLine === undefined || /not found/.test(webkitLine))
    throw new Error("bootstrap portable expects system WebKitGTK 4.1 on the runtime host");
  const probe = spawnSync("bash", [preflight, "--quiet"], {
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  if (probe.error || probe.status !== 0)
    throw new Error(`preflight probe failed (exit ${probe.status}): ${probe.stderr ?? ""}`);
}

function extractMacZip(zipPath: string, destDir: string): string {
  const result = spawnSync("ditto", ["-x", "-k", zipPath, destDir], {
    timeout: EXTRACT_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error(`ditto extract failed: ${String(result.error ?? result.status)}`);
  const apps = readdirSync(destDir).filter((name) => name.endsWith(".app"));
  if (apps.length !== 1) throw new Error(`expected one .app in portable zip, found ${apps.length}`);
  return path.join(destDir, apps[0] as string);
}

function extractAppImage(appImagePath: string, destDir: string): string {
  // --appimage-extract 不依赖 FUSE；产物与本任务同架构（原生 runner）。
  const result = spawnSync(appImagePath, ["--appimage-extract"], {
    cwd: destDir,
    timeout: EXTRACT_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error(`appimage extract failed: ${String(result.error ?? result.status)}`);
  return path.join(destDir, "squashfs-root");
}

function extractTarZst(tarPath: string, destDir: string): string {
  const result = spawnSync("tar", ["--zstd", "-xf", tarPath, "-C", destDir], {
    timeout: EXTRACT_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error(`tar extract failed: ${String(result.error ?? result.status)}`);
  const tops = readdirSync(destDir);
  if (tops.length !== 1 || tops[0] !== "xresconv-gui")
    throw new Error(
      `tarball must contain exactly one xresconv-gui top dir, found ${tops.join(", ")}`,
    );
  return path.join(destDir, "xresconv-gui");
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifySidecar(file: string, name: string): Promise<void> {
  const sidecar = readFileSync(`${file}.sha256`, "utf8").trim();
  const match = /^([a-fA-F0-9]{64}) [ *](.+)$/.exec(sidecar);
  if (!match || match[2] !== name) throw new Error(`invalid SHA-256 sidecar: ${name}`);
  if ((await sha256File(file)) !== match[1]?.toLowerCase())
    throw new Error(`SHA-256 mismatch: ${name}`);
}

/** 单目标全部 portable 形态验证：构建 job 内调用（同 job 内执行位完好，无需
 * 经过 artifact 中转）。Linux offline 一次验证 AppImage 与 tar.zst 两种产物。 */
export async function verifyPortableArtifacts(
  distDir: string,
  expected: PortableExpectation,
  workDir: string,
): Promise<string[]> {
  const target = resolvePortableTarget(expected.os, expected.arch, expected.variant);
  const verified: string[] = [];
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  try {
    for (const format of portableFormats(target)) {
      const name = portableArtifactName(target, expected.version, format);
      const file = path.join(distDir, name);
      if (!existsSync(file)) throw new Error(`portable artifact missing: ${file}`);
      await verifySidecar(file, name);
      const formatDir = path.join(workDir, format);
      mkdirSync(formatDir, { recursive: true });
      const extracted =
        format === "app.zip"
          ? extractMacZip(file, formatDir)
          : format === "appimage"
            ? extractAppImage(file, formatDir)
            : extractTarZst(file, formatDir);
      const layoutRoot = findLayoutRoot(extracted);
      const manifest = validateRuntimeManifest(
        JSON.parse(readFileSync(path.join(layoutRoot, "runtime-manifest.json"), "utf8")),
      );
      verifyLayoutIdentity(manifest, expected, target);
      verifyLayoutPayload(layoutRoot, manifest);
      const nodeVersion = verifyBundledNode(layoutRoot, manifest);
      if (expected.os === "macos") readInfoPlistVersion(extracted, manifest);
      else if (format === "tar.zst" && expected.variant === "bootstrap")
        verifyBootstrapExtras(extracted);
      else verifyLinuxExtras(extracted);
      console.log(
        `verified ${name}: ${manifest.files.length} payload files, bundled node ${nodeVersion}`,
      );
      verified.push(name);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  return verified;
}

/** 聚合验证：portable 范围的精确产物集合 + SHA-256 边车（CI-06 语义，无发布）。 */
export async function verifyPortableAggregate(
  artifactsDir: string,
  version: string,
): Promise<string[]> {
  const names = portableArtifactNames(loadTargets(), version);
  return verifyReleaseArtifacts(artifactsDir, names);
}
