import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 依赖与产物扫描（P4-09，G4）：新架构工作区不得携带旧 UI 运行依赖
 * （jquery/jquery.fancytree/bootstrap/@popperjs——旧实现仅供对照，P7 删除）。
 * 旧依赖允许存在于仓库根 package.json（旧 Electron 架构过渡期保留）。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");

const FORBIDDEN_DEPENDENCIES = ["jquery", "jquery.fancytree", "bootstrap", "@popperjs/core"];

const WORKSPACE_DIRS = [path.join(root, "apps"), path.join(root, "packages")];

function listWorkspacePackageJsons(): string[] {
  const out: string[] = [];
  for (const dir of WORKSPACE_DIRS) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = path.join(dir, entry.name, "package.json");
      if (existsSync(manifest)) {
        out.push(manifest);
      }
    }
  }
  return out;
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(full, out);
    } else if (/\.(ts|tsx|mts|mjs|js|jsx|css)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("依赖与产物扫描（P4-09，G4）", () => {
  it("新架构工作区生产依赖不含旧 UI 运行依赖", () => {
    const manifests = listWorkspacePackageJsons();
    expect(manifests.length).toBeGreaterThanOrEqual(8);
    for (const manifest of manifests) {
      const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
        name: string;
        dependencies?: Record<string, string>;
      };
      for (const banned of FORBIDDEN_DEPENDENCIES) {
        expect(pkg.dependencies?.[banned], `${pkg.name} 不得依赖 ${banned}`).toBeUndefined();
      }
    }
  });

  it("新架构源码不引用旧 UI 库（import/require/类名）", () => {
    const patterns: RegExp[] = [
      /from\s+["'](jquery|jquery\.fancytree|bootstrap|@popperjs\/core)["']/,
      /require\(\s*["'](jquery|jquery\.fancytree|bootstrap|@popperjs\/core)["']\s*\)/,
      /@import\s+["'](bootstrap|jquery)/,
    ];
    const offenders: string[] = [];
    for (const dir of [
      path.join(root, "apps", "desktop", "src"),
      path.join(root, "packages"),
      path.join(root, "src-tauri", "src"),
    ]) {
      for (const file of listSourceFiles(dir)) {
        const content = readFileSync(file, "utf8");
        for (const pattern of patterns) {
          if (pattern.test(content)) {
            offenders.push(`${path.relative(root, file)}: ${pattern.source}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("生产构建产物（dist）不打包旧 UI 库特征", () => {
    const distDir = path.join(root, "apps", "desktop", "dist", "assets");
    if (!existsSync(distDir)) {
      // 构建产物属 test:browser/test:desktop 流程；未构建时跳过（不制造无意义失败）。
      return;
    }
    const signatures = [/jQuery/, /fancytree/i, /bootstrap/i, /popper/i];
    const offenders: string[] = [];
    for (const file of readdirSync(distDir)) {
      if (!/\.(js|css)$/.test(file)) continue;
      const content = readFileSync(path.join(distDir, file), "utf8");
      for (const signature of signatures) {
        // 注释/许可文本命中不算运行依赖；只看代码级特征（函数与选择器）。
        if (signature.test(content) && /fn\.jquery|fancytree|data-bs-|popper/i.test(content)) {
          offenders.push(`${file}: ${signature.source}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
