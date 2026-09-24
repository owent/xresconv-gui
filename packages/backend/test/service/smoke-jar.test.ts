/**
 * 真实 JAR 冒烟（P3-08 全链：loadConfig → runConversion → 真实 runJavaBatch → 产物校验）。
 *
 * 使用本机真实构件（与 guardian java-runner 测试同路径，P3-05 记录）：
 * - JAR: D:/workspace/github/xresloader/xresloader/target/xresloader-2.23.7.jar
 * - 样本: D:/workspace/github/xresloader/xresloader/sample（work_dir 基准）
 * 构件缺失时整组 skip。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ScriptWorkerPool } from "@xresconv/guardian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flattenTreeItems } from "../../src/domain/selection.ts";
import { ConversionSession } from "../../src/service/session.ts";
import { startPool } from "./helpers.ts";

const JAR = "D:/workspace/github/xresloader/xresloader/target/xresloader-2.23.7.jar";
const SAMPLE = "D:/workspace/github/xresloader/xresloader/sample";
const HAS_JAR = existsSync(JAR) && existsSync(SAMPLE);
const SMOKE_TIMEOUT_MS = 180_000;

const tmpRoots: string[] = [];

afterAll(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(!HAS_JAR)("runConversion: 真实 JAR 冒烟", () => {
  let pool: ScriptWorkerPool;

  beforeAll(async () => {
    pool = await startPool();
  }, 30_000);

  afterAll(async () => {
    await pool.shutdown();
  }, 30_000);

  it("单任务 const 转储跑通：succeeded、产物非空", { timeout: SMOKE_TIMEOUT_MS }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xresconv-smoke-"));
    tmpRoots.push(dir);
    const outDir = path.join(dir, "out");
    mkdirSync(outDir, { recursive: true });
    // 单类型 lua（output_type 矩阵单条）+ const 转储 option（对齐 guardian 测试 a 用例形态）。
    const configPath = path.join(dir, "smoke.xml");
    writeFileSync(
      configPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<root>
  <global>
    <work_dir>${SAMPLE}</work_dir>
    <xresloader_path>${JAR}</xresloader_path>
    <proto>protobuf</proto>
    <proto_file>proto_v2/kind.pb</proto_file>
    <output_type>lua</output_type>
  </global>
  <list>
    <item name="kind"><option>--pretty 2 -c kind_const.lua</option></item>
  </list>
</root>
`,
    );

    const session = new ConversionSession({ pool });
    const config = await session.loadConfig(configPath);
    const summary = await session.runConversion(
      { items: flattenTreeItems(config.tree) },
      { outputDir: outDir },
    );

    expect(summary.state).toBe("succeeded");
    expect(summary.failedCount).toBe(0);
    expect(summary.taskCount).toBe(1);
    const outFile = path.join(outDir, "kind_const.lua");
    expect(existsSync(outFile)).toBe(true);
    expect(statSync(outFile).size).toBeGreaterThan(0);
    const messages = session.pipeline.snapshot().map((entry) => entry.message);
    expect(messages).toContain("[Process 1 exit.]");
    expect(messages).toContain("All jobs done.");
  });
});
