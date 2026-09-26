#!/usr/bin/env node
/**
 * P5-04 macOS 打包入口（须在 macOS 主机运行；本脚本在 Windows/Linux 上
 * 调用会直接失败并说明原因——不以交叉编译冒充实机构建）。
 *
 * D5 已定：系统 WKWebView（webviewStrategy=system-only），无独立 WebView
 * 离线安装器；最低系统 13.5（Node 24 官方 Tier 1 要求 >=13.5，
 * https://github.com/nodejs/node/blob/v24.x/BUILDING.md；与 Tauri/前端
 * safari17 目标交集仍为 13.5）。两变体共享同一应用负载，差异仅在
 * runtime-manifest 的 variant 与安装引导文案（bootstrap=检查+引导系统升级，
 * offline=支持的系统上离线安装运行；不支持系统明确拒绝）。
 *
 * 用法（macOS）：
 *   node --experimental-strip-types scripts/package-macos.ts
 *     [--variant=bootstrap|offline|all] [--arch=x64|arm64] [--skip-assemble]
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

if (process.platform !== "darwin") {
  console.error(
    "package-macos 必须在 macOS 主机运行（D5：x64/arm64 分别原生构建；" +
      "交叉编译产物不能替代目标系统验收——05 册规则）",
  );
  process.exit(5);
}

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
    (t) => t.os === "macos" && t.arch === arch && t.variant === variantWanted,
  );
  if (hit === undefined) {
    throw new Error(`no macos target for ${arch}/${variantWanted} in packaging/targets.json`);
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

const outDir = path.join(root, "build", "dist");
mkdirSync(outDir, { recursive: true });
const tauriCli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const layoutDir = path.join(root, "build", "release-layout");

for (const name of variants) {
  // 每变体独立组装（manifest variant 字段不同；模块树哈希一致）。
  if (!skipAssemble) {
    rmSync(layoutDir, { recursive: true, force: true });
    console.log(`[pkg] assembling release layout (${arch}/${name})`);
    await assembleRuntimeLayout({
      target: pick(name),
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
      verificationReport: { result: "pass", reportPath: "docs/plan/records/P5-04.md" },
    });
  }

  // 签名接入（P5-07）：XRESCONV_MACOS_SIGNING_IDENTITY（钥匙串中的证书名，
  // 如 "Developer ID Application: …"）注入 bundle.macOS.signingIdentity；
  // 公证凭据经 tauri CLI 官方 env（APPLE_API_KEY/APPLE_API_ISSUER/APPLE_API_KEY_PATH
  // 或 APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID）。凭据只在用户环境/CI secrets。
  const signingIdentity = process.env.XRESCONV_MACOS_SIGNING_IDENTITY;
  let overlay = path.join("src-tauri", "tauri.macos.release.conf.json");
  if (signingIdentity !== undefined) {
    const base = JSON.parse(readFileSync(path.join(root, overlay), "utf8")) as Record<
      string,
      unknown
    >;
    const bundle = (base.bundle ?? {}) as Record<string, unknown>;
    const mac = (bundle.macOS ?? {}) as Record<string, unknown>;
    const merged = {
      ...base,
      bundle: { ...bundle, macOS: { ...mac, signingIdentity } },
    };
    const overlayDir = path.join(root, "build", "tmp");
    mkdirSync(overlayDir, { recursive: true });
    overlay = path.join(overlayDir, "tauri.macos.signed.conf.json");
    writeFileSync(path.join(root, overlay), JSON.stringify(merged, null, 2), "utf8");
    console.log(`[pkg] codesigning enabled: ${signingIdentity}`);
  }

  console.log(`[pkg] tauri build (dmg, ${name}) via ${overlay}`);
  run(process.execPath, [tauriCli, "build", "--config", overlay]);

  const dmgDir = path.join(root, "target", "release", "bundle", "dmg");
  const produced = existsSync(dmgDir)
    ? readdirSync(dmgDir)
        .filter((file) => file.endsWith(".dmg"))
        .sort()
    : [];
  if (produced.length === 0) {
    throw new Error(`no DMG produced under ${dmgDir}`);
  }
  const source = path.join(dmgDir, produced[produced.length - 1] as string);
  const finalName = artifactName(pick(name), appVersion);
  const dest = path.join(outDir, finalName);
  cpSync(source, dest);
  const digest = createHash("sha256").update(readFileSync(dest)).digest("hex");
  writeFileSync(`${dest}.sha256`, `${digest}  ${finalName}\n`, "utf8");
  console.log(`${digest}  ${finalName}`);
}
console.log(`[pkg] done: ${variants.join("+")} -> build/dist`);
