/**
 * P5-02：发行布局组装器（PK07 本机部分）。把三角色 Node JS（backend/
 * guardian/script-host worker）用 esbuild 打包为纯 JS ESM bundle，按生产
 * 依赖闭包裁剪复制 npm 模块，落位 @xresconv/contracts schema 资源，单份
 * Node 二进制经版本/哈希校验后落位，最后生成 runtime-manifest.json
 * （P5-01 schema，默认跑 PK01 卫生 lint）。
 *
 * 布局约定（与 guardian/backend bin 的发行自定位一致）：
 *   <outDir>/runtime/node.exe|node      单份固定 Node（各角色复用，不重复嵌入）
 *   <outDir>/app/backend/service.mjs    backend bundle
 *   <outDir>/app/guardian/service.mjs   guardian bundle
 *   <outDir>/app/script-host/worker.mjs worker bundle（含 bin 的 fd2 控制台门卫）
 *   <outDir>/app/node_modules/**        生产 npm 闭包 + contracts schema 落位
 *   <outDir>/runtime-manifest.json      P5-01 manifest（files 相对 outDir，正斜杠）
 *
 * 机制依据（P2-10 实测，非猜测）：Node 禁止对 node_modules 内的 .ts 做类型
 * 剥离 → workspace 代码必须打包为纯 JS；contracts validators 运行时
 * createRequire(import.meta.url).resolve("@xresconv/contracts/schema/…")
 * → schema 必须落位在 bundle 上溯可达的 node_modules；缺失的平台
 * optionalDependencies（如 @koromix/koffi-linux-*）跳过不视为缺失。
 *
 * 本切片是 PK07 的本机部分：Node 二进制由调用方取得（本机 process.execPath
 * 或 CI 下载的 dist 副本），本模块负责"校验"（--version 实测精确版本与
 * major 匹配 target.nodeVersion、可选 sha256 强校验、ABI 实测）；nodejs.org
 * 下载与 SHASUMS256.txt 获取属 CI（CI-04），见 records/P5-02 遗留。
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { PackagingError } from "./errors.ts";
import { validateRuntimeManifest } from "./load.ts";
import type {
  BuildToolchain,
  ManifestFile,
  NativeAddonModule,
  ReleaseTarget,
  RuntimeManifest,
  RuntimePayload,
  VerificationReport,
} from "./types.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** 角色 bundle：entry（仓库内）→ 发行落位（app/ 下）。 */
const ROLE_BUNDLES = [
  {
    workspace: "@xresconv/backend",
    entry: "packages/backend/bin/service.mjs",
    destDir: "app/backend",
    destName: "service.mjs",
  },
  {
    workspace: "@xresconv/guardian",
    entry: "packages/guardian/bin/service.mjs",
    destDir: "app/guardian",
    destName: "service.mjs",
  },
  {
    workspace: "@xresconv/script-host",
    entry: "packages/script-host/bin/worker.mjs",
    destDir: "app/script-host",
    destName: "worker.mjs",
  },
] as const;

/** dependencies 携带 workspace 协议的包目录（npm 种子推导来源）。 */
const SEED_SOURCE_PACKAGES = [
  "packages/contracts",
  "packages/ipc",
  "packages/guardian",
  "packages/script-host",
  "packages/compat-service",
  "packages/backend",
] as const;

/** SC04 用户脚本供给包（旧 GUI 提供、新 workspace 不作为依赖的）。 */
const DEFAULT_USER_SCRIPT_PACKAGES = ["adm-zip", "compressing", "koffi"] as const;

export interface NodeAcquisition {
  /** 已取得的 Node 二进制路径（本机 process.execPath 或 CI 下载的 dist 副本）。 */
  path: string;
  /**
   * 来源描述，写入 manifest nodeHash.source 供复现（如 nodejs.org dist URL）；
   * 不得是开发机绝对路径（PK01 lint 会拒绝）。
   */
  source: string;
  /** 期望 sha256（CI：SHASUMS256.txt 对应值）；给出时强制校验，不符即拒绝。 */
  expectedSha256?: string;
}

export interface AssembleLayoutOptions {
  /** 发行目标（packaging/targets.json 条目；nodeVersion major 参与 Node 校验）。 */
  target: ReleaseTarget;
  /** 安装根（组装目的地）；必须不存在或为空目录，防止旧文件混入哈希。 */
  outDir: string;
  node: NodeAcquisition;
  /** 语义化版本（manifest appVersion；CI 传 release 版本）。 */
  appVersion: string;
  /** 40 位小写 hex git commit。 */
  sourceCommit: string;
  repositorySnapshot: { repository: string; dirty: boolean };
  /**
   * 验收报告位（schema 必填）。本机组装传本切片记录（如
   * docs/plan/records/P5-02.md）；正式发行由受控环境在验收后填写（P5-07/P5-10）。
   */
  verificationReport: VerificationReport;
  /** 用户脚本供给 npm 包（SC04 清单）；缺省 adm-zip/compressing/koffi。 */
  userScriptPackages?: readonly string[];
  /** 构建工具链事实；缺省从本机进程与仓库 package.json 采集。 */
  toolchain?: Partial<BuildToolchain>;
  /** 仓库根；缺省从本模块位置推导（本包私有，仅仓库内使用）。 */
  repoRoot?: string;
}

interface NodeFacts {
  exactVersion: string;
  nodeAbi: string;
  sha256: string;
}

interface CopiedPackage {
  name: string;
  version: string;
  license: string;
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function runNode(nodePath: string, args: string[], what: string): string {
  const proc = spawnSync(nodePath, args, { encoding: "utf8" });
  if (proc.error !== undefined || proc.status !== 0) {
    throw new PackagingError("NODE_ACQUISITION_FAILED", `cannot run ${what} with bundled Node`, [
      `path: ${nodePath}`,
      `error: ${String(proc.error ?? `exit ${proc.status}: ${proc.stderr}`)}`,
    ]);
  }
  return proc.stdout.trim();
}

/** 单份 Node 获取校验：可执行、精确版本 major 匹配 target、可选 sha256 强校验、ABI 实测。 */
function verifyNodeBinary(node: NodeAcquisition, target: ReleaseTarget): NodeFacts {
  if (!fs.existsSync(node.path)) {
    throw new PackagingError("NODE_ACQUISITION_FAILED", "bundled Node binary does not exist", [
      `path: ${node.path}`,
    ]);
  }
  const versionOutput = runNode(node.path, ["--version"], "node --version");
  const versionMatch = /^v(\d+)\.(\d+)\.(\d+)$/.exec(versionOutput);
  if (versionMatch === null) {
    throw new PackagingError(
      "NODE_ACQUISITION_FAILED",
      `unexpected node --version output: ${versionOutput}`,
      [versionOutput],
    );
  }
  const exactVersion = `${versionMatch[1]}.${versionMatch[2]}.${versionMatch[3]}`;
  if (versionMatch[1] !== target.nodeVersion) {
    throw new PackagingError(
      "NODE_ACQUISITION_FAILED",
      `bundled Node major ${versionMatch[1]} does not match target nodeVersion ${target.nodeVersion}`,
      [`node --version: ${versionOutput}`, `target: ${target.targetTriple}`],
    );
  }
  const sha256 = sha256File(node.path);
  if (node.expectedSha256 !== undefined && sha256 !== node.expectedSha256) {
    throw new PackagingError("NODE_ACQUISITION_FAILED", "bundled Node sha256 mismatch", [
      `expected: ${node.expectedSha256}`,
      `actual:   ${sha256}`,
      `source: ${node.source}`,
    ]);
  }
  const nodeAbi = runNode(node.path, ["-p", "process.versions.modules"], "node ABI probe");
  if (!/^\d+$/.test(nodeAbi)) {
    throw new PackagingError(
      "NODE_ACQUISITION_FAILED",
      `unexpected Node ABI probe output: ${nodeAbi}`,
      [nodeAbi],
    );
  }
  return { exactVersion, nodeAbi, sha256 };
}

/**
 * 生产 npm 种子：各 workspace 包 dependencies 中滤掉 workspace:* 协议，
 * 与用户脚本供给包合并去重。esbuild external 与闭包复制共用这一集合——
 * 不复制开发机 node_modules 全集（PK07）。
 */
export function collectProductionSeeds(
  repoRoot: string = REPO_ROOT,
  userScriptPackages: readonly string[] = DEFAULT_USER_SCRIPT_PACKAGES,
): string[] {
  const seeds = new Set<string>(userScriptPackages);
  for (const pkgDir of SEED_SOURCE_PACKAGES) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, pkgDir, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (!range.startsWith("workspace:")) {
        seeds.add(name);
      }
    }
  }
  return [...seeds].sort();
}

function copyDir(src: string, dest: string): void {
  fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: false });
}

/**
 * glibc（gnu triple）目标的闭包排除规则：剔除 musl 专用原生模块变体
 * （如 koffi 平台包的 musl_x64 目录）。D2 矩阵无 musl 目标；musl ELF
 * 进入发行树会让 linuxdeploy（P5-06 自含包）按 glibc 解析失败
 * （"Could not find dependency: libc.musl-x86_64.so.1"，WSL 实测）。
 */
export function glibcExclusion(target: ReleaseTarget): RegExp | null {
  return target.os === "linux" && /-gnu(-|$)/.test(target.targetTriple)
    ? /(^|[/\\])[^/\\]*musl[^/\\]*([/\\]|$)/
    : null;
}

function copyDirFiltered(src: string, dest: string, exclude: RegExp | null): void {
  if (exclude === null) {
    copyDir(src, dest);
    return;
  }
  fs.cpSync(src, dest, {
    recursive: true,
    verbatimSymlinks: false,
    filter: (candidate: string) => !exclude.test(candidate),
  });
}

/** 归一化 package.json license 声明（string / {type} / 旧式 licenses 数组）。 */
function licenseOf(manifest: { license?: unknown; licenses?: unknown }): string {
  const from = (value: unknown): string | null => {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const type = (value as { type?: unknown }).type;
      if (typeof type === "string" && type.trim().length > 0) {
        return type.trim();
      }
    }
    return null;
  };
  const direct = from(manifest.license);
  if (direct !== null) {
    return direct;
  }
  if (Array.isArray(manifest.licenses)) {
    const types = manifest.licenses.map(from).filter((t): t is string => t !== null);
    if (types.length > 0) {
      return types.join(" OR ");
    }
  }
  return "UNSPECIFIED";
}

/**
 * 包目录定位：从 fromDir 起逐级向上查 node_modules/<name>/package.json。
 * 闭包复制只需要包目录（整包复制），用目录探测而非 require.resolve——
 * 后者走 CJS exports 条件，对仅声明 import 条件的 ESM-only 包（实测：
 * xml-naming@0.3.0，fast-xml-parser 5.11.1 的依赖）会误判为缺失。
 */
function resolvePackageDir(name: string, fromDir: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * 递归闭包复制：从种子包出发按 package.json dependencies/optionalDependencies
 * 复制。仅 optionalDependencies 解析不到可跳过（平台特定包，如
 * @koromix/koffi-linux-*）；required 依赖缺失抛 ASSEMBLY_FAILED——
 * 坏包/缺包不得静默漏进发行（xml-naming 教训，release-chain 冒烟捕获）。
 */
function copyNpmClosure(
  seeds: readonly string[],
  repoRoot: string,
  nodeModulesDest: string,
  exclusion: RegExp | null,
): Map<string, CopiedPackage> {
  interface QueueEntry {
    name: string;
    fromDir: string;
    optional: boolean;
  }
  const copied = new Map<string, CopiedPackage>();
  const queue: QueueEntry[] = seeds.map((name) => ({
    name,
    fromDir: repoRoot,
    optional: false,
  }));
  while (queue.length > 0) {
    const { name, fromDir, optional } = queue.shift() as QueueEntry;
    if (copied.has(name) || isBuiltin(name)) {
      continue;
    }
    const dir = resolvePackageDir(name, fromDir);
    if (dir === null) {
      if (optional) {
        // 平台特定 optionalDependencies 缺失属正常。
        continue;
      }
      throw new PackagingError("ASSEMBLY_FAILED", `required package ${name} not found`, [
        `looked up from: ${fromDir}`,
      ]);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      name: string;
      version?: string;
      license?: unknown;
      licenses?: unknown;
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    if (typeof manifest.version !== "string" || manifest.version.length === 0) {
      throw new PackagingError("ASSEMBLY_FAILED", `package ${name} carries no version`, [dir]);
    }
    copied.set(name, {
      name,
      version: manifest.version,
      license: licenseOf(manifest),
    });
    copyDirFiltered(dir, path.join(nodeModulesDest, name), exclusion);
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      if (!copied.has(dep)) {
        queue.push({ name: dep, fromDir: dir, optional: false });
      }
    }
    for (const dep of Object.keys(manifest.optionalDependencies ?? {})) {
      if (!copied.has(dep)) {
        queue.push({ name: dep, fromDir: dir, optional: true });
      }
    }
  }
  return copied;
}

/** esbuild 打包一个角色 entry 为纯 JS ESM bundle；npm 生产依赖保持 external。 */
async function bundleRole(
  role: (typeof ROLE_BUNDLES)[number],
  externals: readonly string[],
  repoRoot: string,
  outDir: string,
): Promise<void> {
  const destDir = path.join(outDir, role.destDir);
  fs.mkdirSync(destDir, { recursive: true });
  try {
    await build({
      entryPoints: [path.join(repoRoot, role.entry)],
      outfile: path.join(destDir, role.destName),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      external: [...externals],
      logLevel: "silent",
    });
  } catch (error) {
    throw new PackagingError("ASSEMBLY_FAILED", `esbuild failed for ${role.workspace}`, [
      String(error),
    ]);
  }
}

/** contracts schema 落位：validators 运行时 require.resolve 动态定位的资源。 */
function placeContractsSchema(repoRoot: string, nodeModulesDest: string): void {
  const contractsDest = path.join(nodeModulesDest, "@xresconv", "contracts");
  fs.mkdirSync(contractsDest, { recursive: true });
  copyDir(
    path.join(repoRoot, "packages", "contracts", "schema"),
    path.join(contractsDest, "schema"),
  );
  const source = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "packages", "contracts", "package.json"), "utf8"),
  ) as { name: string; version: string };
  fs.writeFileSync(
    path.join(contractsDest, "package.json"),
    `${JSON.stringify({ name: source.name, version: source.version, exports: { "./schema/*": "./schema/*" } }, null, 2)}\n`,
    "utf8",
  );
}

/** 相对 outDir 的正斜杠文件清单（codepoint 排序，跨平台确定）。 */
function walkFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop() as string;
    const abs = path.join(root, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        stack.push(childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  }
  return out.sort();
}

/** npm 包名 = node_modules 下第一段（scoped 两段）。 */
function packageKeyOf(relInNodeModules: string): string {
  const segments = relInNodeModules.split("/");
  const first = segments[0] as string;
  return first.startsWith("@") ? `${first}/${segments[1] as string}` : first;
}

function collectToolchain(repoRoot: string, override?: Partial<BuildToolchain>): BuildToolchain {
  const rootManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    packageManager?: string;
    devDependencies?: Record<string, string>;
  };
  const yarnVersion = (rootManifest.packageManager ?? "").replace(/^yarn@/, "");
  const tauriCliVersion = (rootManifest.devDependencies?.["@tauri-apps/cli"] ?? "").replace(
    /^[~^]/,
    "",
  );
  const toolchain: BuildToolchain = {
    runnerOs: process.platform,
    runnerArch: process.arch,
    nodeVersion: process.versions.node,
    yarnVersion,
    tauriCliVersion,
    ...override,
  };
  return toolchain;
}

/**
 * 组装发行布局并生成 runtime-manifest.json。返回已过 schema+lint 校验的
 * manifest（同时写入 <outDir>/runtime-manifest.json）。
 */
export async function assembleRuntimeLayout(
  options: AssembleLayoutOptions,
): Promise<RuntimeManifest> {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const { target, outDir } = options;
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
    throw new PackagingError("ASSEMBLY_FAILED", "outDir must be empty or absent", [outDir]);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const nodeFacts = verifyNodeBinary(options.node, target);
  const nodeName = target.os === "windows" ? "node.exe" : "node";
  const stagedNode = path.join(outDir, "runtime", nodeName);
  fs.mkdirSync(path.dirname(stagedNode), { recursive: true });
  fs.copyFileSync(options.node.path, stagedNode);
  if (target.os !== "windows") {
    fs.chmodSync(stagedNode, 0o755);
  }

  const seeds = collectProductionSeeds(repoRoot, options.userScriptPackages);
  const externals = seeds.flatMap((seed) => [seed, `${seed}/*`]);
  for (const role of ROLE_BUNDLES) {
    await bundleRole(role, externals, repoRoot, outDir);
  }

  const nodeModulesDest = path.join(outDir, "app", "node_modules");
  fs.mkdirSync(nodeModulesDest, { recursive: true });
  placeContractsSchema(repoRoot, nodeModulesDest);
  const copied = copyNpmClosure(seeds, repoRoot, nodeModulesDest, glibcExclusion(target));
  for (const seed of options.userScriptPackages ?? DEFAULT_USER_SCRIPT_PACKAGES) {
    if (!copied.has(seed) && !isBuiltin(seed)) {
      throw new PackagingError(
        "ASSEMBLY_FAILED",
        `user-script package ${seed} did not resolve from the repo node_modules`,
        [`seeds: ${seeds.join(", ")}`],
      );
    }
  }

  const rootLicense = (
    JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      license?: string;
    }
  ).license;
  if (typeof rootLicense !== "string" || rootLicense.length === 0) {
    throw new PackagingError("ASSEMBLY_FAILED", "repo root package.json carries no license", []);
  }

  const files: ManifestFile[] = walkFiles(outDir).map((rel) => {
    const abs = path.join(outDir, ...rel.split("/"));
    const base = { path: rel, size: fs.statSync(abs).size, sha256: sha256File(abs) };
    if (rel === `runtime/${nodeName}`) {
      return { ...base, origin: `node-dist:${nodeFacts.exactVersion}`, license: "MIT" };
    }
    for (const role of ROLE_BUNDLES) {
      if (rel.startsWith(`${role.destDir}/`)) {
        return { ...base, origin: `build:${role.workspace}`, license: rootLicense };
      }
    }
    if (rel.startsWith("app/node_modules/@xresconv/contracts/")) {
      return { ...base, origin: "build:@xresconv/contracts", license: rootLicense };
    }
    if (rel.startsWith("app/node_modules/")) {
      const key = packageKeyOf(rel.slice("app/node_modules/".length));
      const pkg = copied.get(key);
      if (pkg === undefined) {
        throw new PackagingError("ASSEMBLY_FAILED", `file belongs to no copied package: ${rel}`, [
          rel,
        ]);
      }
      return { ...base, origin: `npm:${pkg.name}@${pkg.version}`, license: pkg.license };
    }
    throw new PackagingError("ASSEMBLY_FAILED", `unexpected file in layout: ${rel}`, [rel]);
  });

  const nativeModules: NativeAddonModule[] = files
    .filter((file) => file.path.endsWith(".node"))
    .map((file) => ({
      name: packageKeyOf(file.path.slice("app/node_modules/".length)),
      path: file.path,
      sha256: file.sha256,
    }));

  const moduleTreeInput = files
    .filter((file) => file.path.startsWith("app/node_modules/"))
    .map((file) => `${file.path}  ${file.sha256}\n`)
    .join("");
  const moduleTreeHash = createHash("sha256").update(moduleTreeInput, "utf8").digest("hex");

  const runtimePayloads: RuntimePayload[] = [
    "node-runtime",
    "backend-js",
    "guardian-js",
    "script-host-js",
    "npm-modules",
    ...(nativeModules.length > 0 ? (["native-addons"] as const) : []),
  ];

  const manifest: RuntimeManifest = {
    schemaVersion: 1,
    appVersion: options.appVersion,
    sourceCommit: options.sourceCommit,
    targetTriple: target.targetTriple,
    os: target.os,
    osVersionRange: target.osVersionRange,
    ...(target.distro !== undefined ? { distro: target.distro } : {}),
    arch: target.arch,
    variant: target.variant,
    webviewStrategy: target.webviewStrategy,
    minimumWebview: target.minimumWebview,
    runtimePayloads,
    nodeVersion: nodeFacts.exactVersion,
    nodeHash: { sha256: nodeFacts.sha256, source: options.node.source },
    moduleTreeHash,
    nativeAddonAbi: { nodeAbi: nodeFacts.nodeAbi, modules: nativeModules },
    files,
    signingEvidence: [],
    buildToolchain: collectToolchain(repoRoot, options.toolchain),
    repositorySnapshot: {
      repository: options.repositorySnapshot.repository,
      commit: options.sourceCommit,
      dirty: options.repositorySnapshot.dirty,
    },
    verificationReport: options.verificationReport,
  };

  // P5-01 schema + PK01 卫生 lint（无开发机绝对路径/密钥）默认开启。
  const validated = validateRuntimeManifest(manifest);
  fs.writeFileSync(
    path.join(outDir, "runtime-manifest.json"),
    `${JSON.stringify(validated, null, 2)}\n`,
    "utf8",
  );
  return validated;
}
