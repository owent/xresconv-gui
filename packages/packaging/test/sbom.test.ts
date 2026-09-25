import { describe, expect, it } from "vitest";
import { buildSpdx, packageInventory, sizeBreakdown } from "../src/sbom.ts";
import type { ManifestFile, RuntimeManifest } from "../src/types.ts";

function file(partial: Partial<ManifestFile> & { path: string }): ManifestFile {
  return {
    size: 10,
    sha256: "a".repeat(64),
    origin: "build:packages/backend",
    license: "MIT",
    ...partial,
  };
}

function manifest(files: ManifestFile[]): RuntimeManifest {
  return {
    schemaVersion: 1,
    appVersion: "3.0.0-dev.0",
    sourceCommit: "0".repeat(40),
    targetTriple: "x86_64-pc-windows-msvc",
    os: "windows",
    osVersionRange: ">=10.0.17763",
    arch: "x64",
    variant: "bootstrap",
    webviewStrategy: "webview2-embed-bootstrapper",
    minimumWebview: "120.0.0",
    runtimePayloads: [],
    nodeVersion: "24.21.0",
    nodeHash: { sha256: "b".repeat(64), source: "node-dist" },
    moduleTreeHash: "c".repeat(64),
    nativeAddonAbi: { nodeAbi: "137", modules: [] },
    files,
    signingEvidence: [],
    buildToolchain: {
      runnerOs: "win32",
      runnerArch: "x64",
      nodeVersion: "24.21.0",
      yarnVersion: "4.18.0",
      tauriCliVersion: "2.11.5",
    },
    repositorySnapshot: {
      repository: "https://github.com/xresloader/xresconv-gui.git",
      commit: "0".repeat(40),
      dirty: false,
    },
    verificationReport: { result: "pass", reportPath: "docs/plan/records/P5-07.md" },
  };
}

describe("packageInventory / buildSpdx（P5-07 SBOM 部分）", () => {
  it("origin 聚合：npm 按 name@version、node-dist 单包、build 归应用", () => {
    const inventory = packageInventory([
      file({ path: "app/backend/service.mjs", origin: "build:packages/backend" }),
      file({ path: "app/node_modules/adm-zip/index.js", origin: "npm:adm-zip@0.6.1", size: 100 }),
      file({ path: "app/node_modules/adm-zip/util.js", origin: "npm:adm-zip@0.6.1", size: 50 }),
      file({ path: "runtime/node.exe", origin: "node-dist", size: 9000 }),
    ]);
    expect(inventory.get("adm-zip")).toMatchObject({
      version: "0.6.1",
      fileCount: 2,
      totalSize: 150,
    });
    expect(inventory.get("node")).toMatchObject({ fileCount: 1, totalSize: 9000 });
    expect(inventory.get("xresconv-gui")?.fileCount).toBe(1);
  });

  it("SPDX 文档形状：包清单 + DEPENDS_ON 关系；UNSPECIFIED → NOASSERTION", () => {
    const doc = buildSpdx(
      manifest([
        file({ path: "app/backend/service.mjs" }),
        file({
          path: "app/node_modules/xx/idx.js",
          origin: "npm:xx@1.0.0",
          license: "UNSPECIFIED",
        }),
        file({ path: "runtime/node.exe", origin: "node-dist", license: "MIT" }),
      ]),
      "2026-09-25T00:00:00Z",
    );
    expect(doc.spdxVersion).toBe("SPDX-2.3");
    expect(doc.dataLicense).toBe("CC0-1.0");
    const names = doc.packages.map((pkg) => pkg.name).sort();
    expect(names).toEqual(["node", "xresconv-gui", "xx"]);
    const xx = doc.packages.find((pkg) => pkg.name === "xx");
    expect(xx?.versionInfo).toBe("1.0.0");
    expect(xx?.licenseConcluded).toBe("NOASSERTION");
    const appPkg = doc.packages.find((pkg) => pkg.name === "xresconv-gui");
    expect(doc.relationships).toHaveLength(2);
    for (const rel of doc.relationships) {
      expect(rel.spdxElementId).toBe(appPkg?.SPDXID);
      expect(rel.relationshipType).toBe("DEPENDS_ON");
    }
    expect(doc.documentNamespace).toContain("3.0.0-dev.0");
  });
});

describe("sizeBreakdown（P5-09）", () => {
  it("按 origin 类别汇总（node-dist/build/npm）并排序", () => {
    const report = sizeBreakdown([
      file({ path: "a", origin: "build:x", size: 100 }),
      file({ path: "b", origin: "build:y", size: 50 }),
      file({ path: "c", origin: "npm:p@1", size: 20 }),
      file({ path: "d", origin: "node-dist", size: 500 }),
    ]);
    expect(report.totalFiles).toBe(4);
    expect(report.totalBytes).toBe(670);
    expect(report.categories[0]).toMatchObject({ category: "node-dist", bytes: 500 });
    const build = report.categories.find((entry) => entry.category === "build");
    expect(build).toMatchObject({ fileCount: 2, bytes: 150 });
  });
});
