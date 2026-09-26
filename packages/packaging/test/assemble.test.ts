/**
 * P5-02：发行布局组装器（assembleRuntimeLayout）结构层测试。
 *
 * 覆盖 PK07 本机部分：
 * - 单份 Node 获取校验：--version 实测精确版本/major 匹配 target、sha256
 *   强校验（正/负例）、ABI 实测；布局中仅一份 Node 二进制。
 * - 三角色 JS 打包为纯 JS bundle；生产 npm 闭包裁剪（不复制开发机
 *   node_modules 全集）；contracts schema 落位。
 * - runtime-manifest.json 过 P5-01 schema + PK01 lint；moduleTreeHash
 *   跨组装确定（两变体共享模块树哈希的机制基础，05-book Windows 规则 4）。
 *
 * 全链行为验证（staged guardian→backend→worker→脚本 require npm 包）在
 * release-chain.test.ts。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assembleRuntimeLayout, collectProductionSeeds } from "../src/assemble.ts";
import { PackagingError, type PackagingErrorCode } from "../src/errors.ts";
import { validateRuntimeManifest } from "../src/load.ts";
import type { ReleaseTarget, RuntimeManifest } from "../src/types.ts";
import { pickTarget, SAMPLE_COMMIT } from "./fixtures.ts";

const ASSEMBLE_TIMEOUT_MS = 180_000;
const TEST_TIMEOUT_MS = 60_000;

const REPO_URL = "https://github.com/xresloader/xresconv-gui.git";
/** 固定 testedAt：确定性用例要求同输入 → 同 manifest。 */
const VERIFICATION_REPORT = {
  result: "pass",
  reportPath: "docs/plan/records/P5-02.md",
  testedAt: "2026-09-25T00:00:00Z",
} as const;

let tmpBase: string;
let target: ReleaseTarget;
let nodeSha256: string;

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assembleTo(outDir: string): Promise<RuntimeManifest> {
  return assembleRuntimeLayout({
    target,
    outDir,
    node: {
      path: process.execPath,
      source: `local-test-copy:node-v${process.versions.node}-${process.platform}-${process.arch}`,
      expectedSha256: nodeSha256,
    },
    appVersion: "3.0.0-dev.0",
    sourceCommit: SAMPLE_COMMIT,
    repositorySnapshot: { repository: REPO_URL, dirty: false },
    verificationReport: VERIFICATION_REPORT,
  });
}

async function expectAsyncFailure(
  fn: () => Promise<unknown>,
  code: PackagingErrorCode,
): Promise<PackagingError> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PackagingError);
    expect((error as PackagingError).code).toBe(code);
    return error as PackagingError;
  }
  throw new Error(`expected PackagingError(${code}), but nothing was thrown`);
}

beforeAll(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "xresconv-p502-"));
  // 目标随本机平台（node_modules 的 koffi optionalDependencies 按平台解析，
  // 跨平台组装需目标平台的 node_modules——CI 各 OS 上组装本平台目标）。
  // targets.json 的 os/arch 词表：windows/macos 用 x64，linux 用 x86_64。
  const osOfPlatform =
    process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
  const archOfPlatform = osOfPlatform === "linux" ? "x86_64" : "x64";
  target = pickTarget(
    (t) => t.os === osOfPlatform && t.arch === archOfPlatform && t.variant === "bootstrap",
  );
  nodeSha256 = sha256File(process.execPath);
});

afterAll(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe("collectProductionSeeds", () => {
  it("种子 = 各 workspace 生产依赖（滤 workspace:*）∪ 用户脚本供给，无开发依赖", () => {
    const seeds = collectProductionSeeds();
    for (const expected of [
      "adm-zip",
      "compressing",
      "koffi",
      "ajv",
      "log4js",
      "minimatch",
      "fast-xml-parser",
    ]) {
      expect(seeds).toContain(expected);
    }
    // workspace 协议依赖与开发依赖不得成为种子。
    expect(seeds.some((s) => s.startsWith("@xresconv/"))).toBe(false);
    for (const devOnly of ["vitest", "typescript", "vite", "esbuild"]) {
      expect(seeds).not.toContain(devOnly);
    }
  });
});

describe("assembleRuntimeLayout（PK07 本机部分）", () => {
  let installDir: string;
  let manifest: RuntimeManifest;

  beforeAll(async () => {
    // PK07：安装路径含中文与空格。
    installDir = path.join(tmpBase, "安装 目录");
    manifest = await assembleTo(installDir);
  }, ASSEMBLE_TIMEOUT_MS);

  it("a. 布局结构：单份 Node + 三角色纯 JS bundle + 闭包 + schema 落位", {
    timeout: TEST_TIMEOUT_MS,
  }, () => {
    for (const rel of [
      `runtime/${process.platform === "win32" ? "node.exe" : "node"}`,
      "app/backend/service.mjs",
      "app/guardian/service.mjs",
      "app/script-host/worker.mjs",
      "app/node_modules/@xresconv/contracts/schema/backend-rpc.json",
      "app/node_modules/@xresconv/contracts/package.json",
      "runtime-manifest.json",
    ]) {
      expect(fs.existsSync(path.join(installDir, ...rel.split("/"))), rel).toBe(true);
    }
    // 单份 Node：全布局只有一份 Node 二进制，不重复嵌入（PK07）。
    const nodeBinaries = manifest.files.filter((f) => f.origin.startsWith("node-dist:"));
    expect(nodeBinaries.map((f) => f.path)).toEqual([
      `runtime/${process.platform === "win32" ? "node.exe" : "node"}`,
    ]);
    // 三角色 bundle 是纯 JS 产物（非 TS 源复制；机制依据 P2-10）；
    // contracts 落位 = schema/*.json + 合成的 package.json。
    for (const f of manifest.files.filter((f) => f.origin.startsWith("build:@xresconv/"))) {
      const isBundle = f.path.endsWith(".mjs");
      const isContractsDropIn = f.path.startsWith("app/node_modules/@xresconv/contracts/");
      expect(isBundle || isContractsDropIn, f.path).toBe(true);
    }
    // 闭包裁剪：无开发机 node_modules 全集（vitest/typescript 等不得落位）。
    expect(fs.existsSync(path.join(installDir, "app/node_modules/vitest"))).toBe(false);
    expect(fs.existsSync(path.join(installDir, "app/node_modules/typescript"))).toBe(false);
    const npmOrigins = new Set(
      manifest.files
        .filter((f) => f.origin.startsWith("npm:"))
        .map((f) => f.origin.replace(/@[^@]*$/, "")),
    );
    for (const expected of [
      "npm:adm-zip",
      "npm:compressing",
      "npm:koffi",
      "npm:ajv",
      "npm:log4js",
      "npm:minimatch",
      "npm:fast-xml-parser",
    ]) {
      expect(npmOrigins).toContain(expected);
    }
    // P2-10 实测同种子闭包为 50 包量级；上限兜底防全集复制回归。
    expect(npmOrigins.size).toBeLessThan(100);
  });

  it("b. manifest 过 schema+lint；Node 版本/哈希/ABI 与本地实测一致", {
    timeout: TEST_TIMEOUT_MS,
  }, () => {
    const fromDisk = JSON.parse(
      fs.readFileSync(path.join(installDir, "runtime-manifest.json"), "utf8"),
    ) as unknown;
    // validateRuntimeManifest 默认跑 PK01 lint（无绝对路径/密钥）。
    expect(() => validateRuntimeManifest(fromDisk)).not.toThrow();
    expect(manifest.nodeVersion).toBe(process.versions.node);
    expect(manifest.nodeHash.sha256).toBe(nodeSha256);
    expect(manifest.nodeHash.sha256).toBe(
      sha256File(
        path.join(installDir, "runtime", process.platform === "win32" ? "node.exe" : "node"),
      ),
    );
    expect(manifest.nativeAddonAbi.nodeAbi).toBe(process.versions.modules);
    expect(manifest.moduleTreeHash).toMatch(/^[0-9a-f]{64}$/);
    // win32：koffi 原生二进制落位并登记（Node-API，ABI 匹配单份 Node）。
    const nativeNames = manifest.nativeAddonAbi.modules?.map((m) => m.name) ?? [];
    // koffi optionalDependencies 按本机平台解析（win32-x64/linux-x64…）。
    expect(nativeNames).toContain(`@koromix/koffi-${process.platform}-${process.arch}`);
    expect(manifest.runtimePayloads).toContain("native-addons");
    // files[] 全字段非空、路径为 portable 相对路径（lint 已强校验，显式复核）。
    for (const f of manifest.files) {
      expect(f.path).not.toMatch(/[\\:]/);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.origin.length).toBeGreaterThan(0);
      expect(f.license.length).toBeGreaterThan(0);
    }
  });

  it("c. moduleTreeHash 跨组装确定（同输入 → 同模块树哈希与 files）", {
    timeout: ASSEMBLE_TIMEOUT_MS,
  }, async () => {
    const secondDir = path.join(tmpBase, "second");
    const second = await assembleTo(secondDir);
    expect(second.moduleTreeHash).toBe(manifest.moduleTreeHash);
    expect(second.files).toEqual(manifest.files);
    // 同输入整体确定（verificationReport 固定 testedAt）。
    expect(second).toEqual(manifest);
  });

  it("d. Node 获取校验负例：sha256 不符 / major 不符 / outDir 非空 均拒绝", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const badShaDir = path.join(tmpBase, "bad-sha");
    await expectAsyncFailure(
      () =>
        assembleRuntimeLayout({
          target,
          outDir: badShaDir,
          node: {
            path: process.execPath,
            source: "local-test-copy",
            expectedSha256: "0".repeat(64),
          },
          appVersion: "3.0.0-dev.0",
          sourceCommit: SAMPLE_COMMIT,
          repositorySnapshot: { repository: REPO_URL, dirty: false },
          verificationReport: VERIFICATION_REPORT,
        }),
      "NODE_ACQUISITION_FAILED",
    );

    const wrongMajorDir = path.join(tmpBase, "wrong-major");
    await expectAsyncFailure(
      () =>
        assembleRuntimeLayout({
          target: { ...target, nodeVersion: "22" },
          outDir: wrongMajorDir,
          node: { path: process.execPath, source: "local-test-copy" },
          appVersion: "3.0.0-dev.0",
          sourceCommit: SAMPLE_COMMIT,
          repositorySnapshot: { repository: REPO_URL, dirty: false },
          verificationReport: VERIFICATION_REPORT,
        }),
      "NODE_ACQUISITION_FAILED",
    );

    // outDir 非空（防旧文件混入哈希）。
    const dirty = path.join(tmpBase, "dirty-out");
    fs.mkdirSync(dirty, { recursive: true });
    fs.writeFileSync(path.join(dirty, "stale.txt"), "stale", "utf8");
    await expectAsyncFailure(() => assembleTo(dirty), "ASSEMBLY_FAILED");
  });
});
