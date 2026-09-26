/**
 * 100k 节点压测（P4-08，03-domain-conversion.md 合同：候选构建 + 序列化 +
 * 快照传输不只测 parser）。生成 1000 分类 × 100 条目 = 100,100 节点的真实 XML，
 * 走完整 parseXmlConfig（严格解析、include 图、模型构建），再以 rpc-app 同款
 * structuredClone 覆盖快照传输序列化。记录耗时供性能台账（不做精确阈值断言，
 * 只设防挂起上限——主计划 §11.5 性能门槛属 P6 报告）。
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseXmlConfig } from "../src/config/loader.ts";

const FOLDERS = 1000;
const ITEMS_PER_FOLDER = 100;
/** include 分片：每片条目数（单文件预算 8 MiB，整片 ~110KB）。 */
const SLICE_FILES = 100;

let tmpRoot: string | null = null;

function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xresconv-perf-"));
  tmpRoot = dir;
  return dir;
}

afterAll(() => {
  if (tmpRoot !== null) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

/**
 * 生成 include 分片的 100k 配置：入口文件声明分类 + include 100 个分片，
 * 每片 1000 条目（共 100,000 条目 + 1000 分类）。同时压测 include 图
 * （文件数 101 ≤ 1024 预算、DFS 合并顺序）与单文件字节预算。
 */
function generateBigConfig(dir: string): string {
  const entry: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<root>", "  <category>"];
  for (let c = 0; c < FOLDERS; c++) {
    entry.push(`    <tree id="c${c}" name="分类${c}"></tree>`);
  }
  entry.push("  </category>");
  const totalItems = FOLDERS * ITEMS_PER_FOLDER;
  const perSlice = totalItems / SLICE_FILES;
  for (let slice = 0; slice < SLICE_FILES; slice++) {
    const slicePath = path.join(dir, `slice-${slice}.xml`);
    const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<root>", "  <list>"];
    for (let i = 0; i < perSlice; i++) {
      const globalIndex = slice * perSlice + i;
      const folder = Math.floor(globalIndex / ITEMS_PER_FOLDER);
      const inFolder = globalIndex % ITEMS_PER_FOLDER;
      parts.push(
        `    <item file="src${folder}.xlsx" scheme="src${folder}.xlsx|s${inFolder}|2,1" name="表${folder}-${inFolder}" cat="c${folder}" tag="t1" class="client"></item>`,
      );
    }
    parts.push("  </list>", "</root>");
    writeFileSync(slicePath, parts.join("\n"), "utf8");
    entry.push(`  <include>slice-${slice}.xml</include>`);
  }
  entry.push("</root>");
  const entryPath = path.join(dir, "big-100k.xml");
  writeFileSync(entryPath, entry.join("\n"), "utf8");
  return entryPath;
}

/** 树节点总数（分类 + 条目）。 */
function countNodes(nodes: readonly unknown[]): number {
  let total = 0;
  for (const node of nodes) {
    total += 1;
    const children = (node as { children?: unknown[] }).children ?? [];
    total += countNodes(children);
  }
  return total;
}

describe("100k 节点压测（P4-08）", () => {
  it("完整解析 + 快照序列化往返（防挂起上限 120s）", { timeout: 120_000 }, async () => {
    const dir = makeTmpDir();
    const xmlPath = generateBigConfig(dir);

    const startedAt = Date.now();
    const config = await parseXmlConfig(xmlPath);
    const parseMs = Date.now() - startedAt;

    const nodeCount = countNodes(config.tree);
    expect(nodeCount).toBe(FOLDERS + FOLDERS * ITEMS_PER_FOLDER);

    // 快照传输序列化（rpc-app snapshot() 同款结构克隆）。
    const cloneStart = Date.now();
    const snapshot = structuredClone({ config, tree: config.tree });
    const cloneMs = Date.now() - cloneStart;
    expect(countNodes(snapshot.config.tree)).toBe(nodeCount);

    // JSON 可序列化（IPC 传输形态；不比对大小阈值，仅证明可完整序列化）。
    const jsonStart = Date.now();
    const json = JSON.stringify(snapshot);
    const jsonMs = Date.now() - jsonStart;
    expect(json.length).toBeGreaterThan(1_000_000);

    console.log(
      `[perf] 100k nodes: parse=${parseMs}ms structuredClone=${cloneMs}ms json=${jsonMs}ms (${json.length} bytes)`,
    );
  });
});
