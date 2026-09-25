#!/usr/bin/env node
/**
 * P5-03 Windows 打包入口：组装发行布局（P5-02 assembleRuntimeLayout，两变体
 * 共享同一 moduleTreeHash）→ 逐变体 `tauri build --config` 双配置覆盖 →
 * NSIS 产物按 P5-01 矩阵命名复制到 build/dist/ 并写 SHA-256 边车。
 *
 * 用法：
 *   node --experimental-strip-types scripts/package-windows.mjs
 *     [--variant=bootstrap|offline|all] [--arch=x64|arm64] [--skip-assemble]
 * - 本机 Node 必须与目标 nodeVersion major 一致（assemble 校验；开发机即 v24）。
 * - NSIS 工具链由 tauri CLI 首次使用时自动获取。
 * - 产物不签名（签名/SBOM 属 P5-07 受控发行环境）。
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

const variant = arg("variant", "all");
const arch = arg("arch", process.arch === "arm64" ? "arm64" : "x64");
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
    (t) => t.os === "windows" && t.arch === arch && t.variant === variantWanted,
  );
  if (hit === undefined) {
    throw new Error(`no windows target for ${arch}/${variantWanted} in packaging/targets.json`);
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

// 1. 组装共享发行布局（两变体只差 WebView2 准备方式；moduleTreeHash 一致）。
const layoutDir = path.join(root, "build", "release-layout");
if (!skipAssemble) {
  rmSync(layoutDir, { recursive: true, force: true });
  console.log(`[pkg] assembling release layout (${arch}) -> build/release-layout`);
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
      reportPath: "docs/plan/records/P5-03.md",
    },
  });
} else {
  console.log("[pkg] --skip-assemble: reusing build/release-layout");
  if (!existsSync(path.join(layoutDir, "runtime-manifest.json"))) {
    throw new Error("--skip-assemble requires an existing build/release-layout");
  }
}

// 2. 逐变体构建 NSIS 并按矩阵命名落位。
const outDir = path.join(root, "build", "dist");
mkdirSync(outDir, { recursive: true });
const tauriCli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
for (const name of variants) {
  const target = pick(name);
  const overlay = path.join("src-tauri", `tauri.windows.${name}.conf.json`);
  console.log(`[pkg] tauri build (nsis, ${name}) via ${overlay}`);
  run(process.execPath, [tauriCli, "build", "--config", overlay]);

  const nsisDir = path.join(root, "target", "release", "bundle", "nsis");
  const produced = readdirSync(nsisDir)
    .filter((file) => file.endsWith("-setup.exe"))
    .sort();
  if (produced.length === 0) {
    throw new Error(`no NSIS installer produced under ${nsisDir}`);
  }
  const source = path.join(nsisDir, produced[produced.length - 1] as string);
  const finalName = artifactName(target, appVersion);
  const dest = path.join(outDir, finalName);
  cpSync(source, dest);
  const digest = createHash("sha256").update(readFileSync(dest)).digest("hex");
  writeFileSync(`${dest}.sha256`, `${digest}  ${finalName}\n`, "utf8");
  console.log(`${digest}  ${finalName}`);
}
console.log(`[pkg] done: ${variants.join("+")} -> build/dist`);
