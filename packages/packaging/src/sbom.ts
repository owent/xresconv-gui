/**
 * SPDX 2.3 SBOM 生成（P5-07，PK08 部分）与大小分解报告（P5-09）。
 *
 * 输入是 P5-02 runtime-manifest（files[] 已含 size/sha256/origin/license——
 * 单一事实源）；SBOM 按聚合粒度输出：
 * - 应用自身（origin `build:*`）→ 一个包；
 * - Node 发行二进制（origin `node-dist`）→ 一个包（版本=manifest.nodeVersion）；
 * - 每个 npm 依赖（origin `npm:<name>@<version>`）→ 一个包（license 传播）。
 * 不引入新的事实来源；签名证据字段由受控发行环境后补（P5-07 全量属彼处）。
 */

import type { ManifestFile, RuntimeManifest } from "./types.ts";

/** SPDX 2.3 JSON 的最小可用子集（_creationInfo/documentNamespace 必填）。 */
export interface SpdxDocument {
  spdxVersion: "SPDX-2.3";
  dataLicense: "CC0-1.0";
  SPDXID: "SPDXRef-DOCUMENT";
  name: string;
  documentNamespace: string;
  creationInfo: { created: string; creators: string[] };
  packages: SpdxPackage[];
  relationships: { spdxElementId: string; relatedSpdxElement: string; relationshipType: string }[];
}

export interface SpdxPackage {
  SPDXID: string;
  name: string;
  versionInfo?: string;
  downloadLocation?: string;
  licenseConcluded: string;
  checksums?: { algorithm: "SHA256"; checksumValue: string }[];
}

function spdxId(raw: string): string {
  // SPDXID 允许 [a-zA-Z0-9.-]；其余字符折叠为 '-'。
  return `SPDXRef-Package-${raw.replaceAll(/[^a-zA-Z0-9.-]+/g, "-")}`;
}

/** 聚合 files[] 的 origin → 包清单（npm 按 name@version 聚合）。 */
export function packageInventory(files: readonly ManifestFile[]): Map<
  string,
  {
    version: string;
    license: string;
    sha256s: string[];
    totalSize: number;
    fileCount: number;
  }
> {
  const out = new Map<
    string,
    { version: string; license: string; sha256s: string[]; totalSize: number; fileCount: number }
  >();
  for (const file of files) {
    let key: string;
    let version = "";
    if (file.origin.startsWith("npm:")) {
      const tagged = file.origin.slice("npm:".length);
      const at = tagged.lastIndexOf("@");
      key = at > 0 ? tagged.slice(0, at) : tagged;
      version = at > 0 ? tagged.slice(at + 1) : "";
    } else if (file.origin === "node-dist") {
      key = "node";
    } else {
      key = "xresconv-gui";
    }
    let entry = out.get(key);
    if (entry === undefined) {
      entry = { version, license: file.license, sha256s: [], totalSize: 0, fileCount: 0 };
      out.set(key, entry);
    }
    entry.sha256s.push(file.sha256);
    entry.totalSize += file.size;
    entry.fileCount += 1;
  }
  return out;
}

/** 从 manifest 生成 SPDX 2.3 JSON（documentNamespace 由 appVersion+commit 派生）。 */
export function buildSpdx(manifest: RuntimeManifest, createdIso: string): SpdxDocument {
  const inventory = packageInventory(manifest.files);
  const packages: SpdxPackage[] = [];
  const relationships: SpdxDocument["relationships"] = [];
  const app = "xresconv-gui";
  packages.push({
    SPDXID: spdxId(app),
    name: app,
    versionInfo: manifest.appVersion,
    licenseConcluded: "MIT",
  });
  for (const [name, entry] of [...inventory.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (name === app) continue;
    packages.push({
      SPDXID: spdxId(name),
      name,
      versionInfo: entry.version || undefined,
      licenseConcluded:
        entry.license === "UNSPECIFIED" || entry.license === "" ? "NOASSERTION" : entry.license,
      // 聚合包级校验和：文件级清单在 manifest.files（引用，不复制膨胀）。
    });
    relationships.push({
      spdxElementId: spdxId(app),
      relatedSpdxElement: spdxId(name),
      relationshipType: "DEPENDS_ON",
    });
  }
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${app}-${manifest.appVersion}-${manifest.os}-${manifest.arch}-${manifest.variant}`,
    documentNamespace: `https://github.com/xresloader/xresconv-gui/spdx/${manifest.appVersion}/${manifest.sourceCommit}/${manifest.os}-${manifest.arch}-${manifest.variant}`,
    creationInfo: {
      created: createdIso,
      creators: ["Organization: xresloader", "Tool: xresconv-gui-packaging"],
    },
    packages,
    relationships,
  };
}

/** P5-09 大小分解：按 origin 类别汇总（node-dist / build / npm）+ 总量。 */
export interface SizeBreakdown {
  categories: { category: string; fileCount: number; bytes: number }[];
  totalFiles: number;
  totalBytes: number;
}

export function sizeBreakdown(files: readonly ManifestFile[]): SizeBreakdown {
  const byCategory = new Map<string, { fileCount: number; bytes: number }>();
  for (const file of files) {
    const category =
      file.origin === "node-dist" ? "node-dist" : file.origin.startsWith("npm:") ? "npm" : "build";
    let entry = byCategory.get(category);
    if (entry === undefined) {
      entry = { fileCount: 0, bytes: 0 };
      byCategory.set(category, entry);
    }
    entry.fileCount += 1;
    entry.bytes += file.size;
  }
  const categories = [...byCategory.entries()]
    .map(([category, entry]) => ({ category, ...entry }))
    .sort((a, b) => b.bytes - a.bytes);
  return {
    categories,
    totalFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  };
}
