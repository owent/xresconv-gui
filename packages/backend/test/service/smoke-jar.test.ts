/**
 * 真实 JAR 冒烟（ 全链：loadConfig → runConversion → 真实 runJavaBatch → 产物校验）。
 *
 * 使用本机真实构件（与 guardian java-runner 测试同路径， 记录）：
 * JAR: XRESCONV_TEST_JAR 或 ../xresloader/target 中唯一 JAR
 * 样本: XRESCONV_TEST_SAMPLE 或 ../xresloader/sample（work_dir 基准）
 * 构件缺失时整组 skip。
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveJavaExecutable, type ScriptWorkerPool } from "@xresconv/guardian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HAS_JAR, JAR, SAMPLE } from "../../../../tests/fixtures/conversion/runtime.mts";
import { flattenTreeItems } from "../../src/domain/selection.ts";
import { ConversionSession } from "../../src/service/session.ts";
import { startPool } from "./helpers.ts";

const SMOKE_TIMEOUT_MS = 180_000;
const execFileAsync = promisify(execFile);

const tmpRoots: string[] = [];

afterAll(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(!HAS_JAR)("runConversion: 真实 JAR 冒烟", () => {
  let pool: ScriptWorkerPool;
  let nativeParallelism: boolean;

  beforeAll(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xresconv-smoke-help-"));
    tmpRoots.push(dir);
    // 通过真实 JVM 读取版本，避免与被测的 JAR 属性解析共享错误。
    const version = await execFileAsync(
      resolveJavaExecutable().command,
      ["-jar", JAR, "--version"],
      {
        cwd: dir,
        timeout: 60_000,
        windowsHide: true,
        encoding: "utf8",
      },
    );
    const release = /^(\d+)\.(\d+)/.exec(version.stdout.trim());
    expect(release).not.toBeNull();
    const major = Number(release?.[1]);
    const minor = Number(release?.[2]);
    nativeParallelism = major > 2 || (major === 2 && minor >= 24);
    const help = await execFileAsync(resolveJavaExecutable().command, ["-jar", JAR, "--help"], {
      cwd: dir,
      timeout: 60_000,
      windowsHide: true,
      encoding: "utf8",
    });
    const text = help.stdout + help.stderr;
    expect(text).toMatch(/usage:/i);
    if (nativeParallelism) expect(text).toMatch(/--parallelism\s/);
    pool = await startPool();
  }, SMOKE_TIMEOUT_MS);

  afterAll(async () => {
    await pool?.shutdown();
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

  it.each([
    { parallelism: "auto", displayVersion: "" },
    { parallelism: 4, displayVersion: "" },
    { parallelism: 4, displayVersion: "2.23.7" },
    { parallelism: 4, displayVersion: "3.0.0" },
  ] as const)(
    "并发 $parallelism、展示覆盖 $displayVersion：8 件产物齐全，按真实能力选择进程数",
    {
      timeout: SMOKE_TIMEOUT_MS,
    },
    async ({ parallelism, displayVersion }) => {
      const dir = mkdtempSync(path.join(tmpdir(), "xresconv-smoke-par-"));
      tmpRoots.push(dir);
      const outDir = path.join(dir, "out");
      mkdirSync(outDir, { recursive: true });
      const items = Array.from(
        { length: 8 },
        (_, i) => `    <item name="c${i}"><option>--pretty 2 -c c${i}.lua</option></item>`,
      ).join("\n");
      const configPath = path.join(dir, "smoke-par.xml");
      writeFileSync(
        configPath,
        `<?xml version="1.0" encoding="UTF-8"?>
<root>
  <global>
    <work_dir>${SAMPLE}</work_dir>
    <xresloader_path>${JAR}</xresloader_path>
    ${displayVersion ? `<java_option>-Dxresloader.version=${displayVersion}</java_option>` : ""}
    <proto>protobuf</proto>
    <proto_file>proto_v2/kind.pb</proto_file>
    <output_type>lua</output_type>
  </global>
  <list>
${items}
  </list>
</root>
`,
      );

      const session = new ConversionSession({ pool, parallelism });
      const config = await session.loadConfig(configPath);
      const summary = await session.runConversion(
        { items: flattenTreeItems(config.tree) },
        { outputDir: outDir },
      );

      expect(summary.state).toBe("succeeded");
      expect(summary.failedCount).toBe(0);
      expect(summary.taskCount).toBe(8);
      for (let i = 0; i < 8; i++) {
        const outFile = path.join(outDir, `c${i}.lua`);
        expect(existsSync(outFile)).toBe(true);
        expect(statSync(outFile).size).toBeGreaterThan(0);
      }
      const messages = session.pipeline.snapshot().map((entry) => entry.message);
      const processCount = nativeParallelism ? 1 : parallelism === "auto" ? 2 : parallelism;
      expect(messages.filter((message) => /^Process \d+ :/.test(message))).toHaveLength(
        processCount,
      );
      for (let n = 1; n <= processCount; n++) {
        expect(messages).toContain(`[Process ${n} exit.]`);
      }
      expect(
        messages.some((message) => message.includes(`--stdin --parallelism ${parallelism}`)),
      ).toBe(nativeParallelism);
      expect(messages).toContain("All jobs done.");
    },
  );
});
