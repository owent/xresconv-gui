#!/usr/bin/env node
/**
 * P5-05/P5-06 Linux 打包入口：组装发行布局（Linux 目标，本机 Node 须为
 * targets.nodeVersion major）→ `tauri build --config` 变体覆盖 → 产物按
 * P5-01 矩阵命名（bootstrap=deb/rpm 按本机发行版；offline=AppImage 自含
 * 原型）复制到 build/dist/ 并写 SHA-256 边车。
 *
 * 用法（在 Linux（含 WSL）上）：
 *   node --experimental-strip-types scripts/package-linux.ts
 *     [--variant=bootstrap|offline|all] [--distro=<targets.json distro>]
 *     [--arch=x86_64|aarch64] [--skip-assemble]
 * 发行版推断：--distro 缺省按 /etc/os-release 映射（Debian→debian-13、
 * Ubuntu→ubuntu-24.04 等；不匹配 targets 清单即失败，不猜目标）。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { ReleaseTarget } from "../packages/packaging/src/index.ts";
import {
  artifactName,
  assembleRuntimeLayout,
  loadTargets,
} from "../packages/packaging/src/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((value) => value.startsWith(`--${name}`));
  if (hit === undefined) return fallback;
  const eq = hit.indexOf("=");
  return eq === -1 ? "true" : hit.slice(eq + 1);
}

/** /etc/os-release → targets.json distro 段（只映射已登记目标，不猜）。 */
function detectDistro(): string {
  if (process.platform !== "linux") {
    throw new Error("package-linux 必须在 Linux（含 WSL）上运行");
  }
  const osRelease = readFileSync("/etc/os-release", "utf8");
  const id = /^ID=(.*)$/m.exec(osRelease)?.[1]?.trim().replaceAll('"', "") ?? "";
  const versionId = /^VERSION_ID=(.*)$/m.exec(osRelease)?.[1]?.trim().replaceAll('"', "") ?? "";
  const major = versionId.split(".")[0] ?? "";
  if (id === "debian") return `debian-${major}`;
  if (id === "ubuntu") return `ubuntu-${major}.04`;
  if (id === "fedora") return `fedora-${major}`;
  throw new Error(
    `不支持的发行版 ID=${id}（D2 清单：Ubuntu 22.04/24.04、Debian 12/13、Fedora 43/44）`,
  );
}

const variant = arg("variant", "all");
const distro = arg("distro", detectDistro());
const arch = arg("arch", process.arch === "arm64" ? "aarch64" : "x86_64");
const skipAssemble = arg("skip-assemble", "false") === "true";
const variants = variant === "all" ? ["bootstrap", "offline"] : [variant];

const appVersion = (
  JSON.parse(readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8")) as {
    version: string;
  }
).version;

const targets = loadTargets();
function pick(variantWanted: string): ReleaseTarget {
  const hit = targets.targets.find(
    (t) =>
      t.os === "linux" &&
      t.arch === arch &&
      t.variant === variantWanted &&
      (variantWanted === "offline" || t.distro === distro),
  );
  if (hit === undefined) {
    throw new Error(
      `no linux target for ${distro}/${arch}/${variantWanted} in packaging/targets.json`,
    );
  }
  return hit;
}

function run(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`command failed (${result.status}): ${cmd} ${args.join(" ")}`);
  }
}

function git(args: string[]): string {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout?.trim() ?? "";
}

// 1. 组装共享发行布局（本机 Node 作为单份运行时；major 由 assemble 校验）。
const layoutDir = path.join(root, "build", "release-layout");
if (!skipAssemble) {
  rmSync(layoutDir, { recursive: true, force: true });
  console.log(`[pkg] assembling release layout (${distro}/${arch}) -> build/release-layout`);
  await assembleRuntimeLayout({
    target: pick("bootstrap"),
    outDir: layoutDir,
    node: {
      path: process.execPath,
      source: `local-dev:node-v${process.versions.node}-${process.platform}-${process.arch}`,
    },
    appVersion,
    sourceCommit: git(["rev-parse", "HEAD"]) || "0".repeat(40),
    repositorySnapshot: {
      repository: "https://github.com/xresloader/xresconv-gui.git",
      dirty: git(["status", "--porcelain"]).length > 0,
    },
    verificationReport: {
      result: "pass",
      reportPath: "docs/plan/records/P5-05.md",
    },
  });
} else {
  console.log("[pkg] --skip-assemble: reusing build/release-layout");
  if (!existsSync(path.join(layoutDir, "runtime-manifest.json"))) {
    throw new Error("--skip-assemble requires an existing build/release-layout");
  }
}

// 2. 逐变体构建并按矩阵命名落位（bootstrap 在 Debian 系出 deb；rpm 需在
//    Fedora 基线构建（CI 矩阵）；offline 为 AppImage 自含原型（P5-06））。
const outDir = path.join(root, "build", "dist");
mkdirSync(outDir, { recursive: true });
const tauriCli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
for (const name of variants) {
  const target = pick(name);
  const overlay = path.join("src-tauri", `tauri.linux.${name}.conf.json`);
  console.log(`[pkg] tauri build (${name}) via ${overlay}`);
  run(process.execPath, [tauriCli, "build", "--config", overlay]);

  const bundleDir = path.join(root, "target", "release", "bundle");
  const wantedExt = name === "offline" ? ".AppImage" : ".deb";
  const produced: string[] = [];
  const debDir = path.join(bundleDir, "deb");
  const appimageDir = path.join(bundleDir, "appimage");
  for (const dir of [debDir, appimageDir]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (file.endsWith(wantedExt)) produced.push(path.join(dir, file));
    }
  }
  if (produced.length === 0) {
    throw new Error(`no ${wantedExt} artifact produced under ${bundleDir}`);
  }
  const finalName = artifactName(target, appVersion);
  const dest = path.join(outDir, finalName);
  cpSync(produced.sort().at(-1) as string, dest);
  const digest = createHash("sha256").update(readFileSync(dest)).digest("hex");
  writeFileSync(`${dest}.sha256`, `${digest}  ${finalName}\n`, "utf8");
  console.log(`${digest}  ${finalName}`);
}
console.log(`[pkg] done: ${variants.join("+")} -> build/dist`);
