/**
 * runJavaBatch 真实 JAR 集成测试（P3-07）。
 *
 * 使用本机真实构件：
 * - JAR: D:/workspace/github/xresloader/xresloader/target/xresloader-2.23.7.jar
 * - 样本: D:/workspace/github/xresloader/xresloader/sample（cwd 基准，任务内相对路径）
 * jar/样本缺失时整组 skip（在 docs/plan/records/P3-05.md 声明）。
 *
 * 用例 a-e 对应任务书；另含空批次、中止与截止路径。
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { buildArgvFallbackCommand, encodeTaskLine } from "@xresconv/backend";
import { afterAll, describe, expect, it } from "vitest";
import { AbortError, runJavaBatch } from "../src/java-runner.ts";
import { HardDeadlineError } from "../src/run-with-deadline.ts";

const JAR = "D:/workspace/github/xresloader/xresloader/target/xresloader-2.23.7.jar";
const SAMPLE = "D:/workspace/github/xresloader/xresloader/sample";
const HAS_JAR = existsSync(JAR) && existsSync(SAMPLE);
const JAVA_ARGS = ["-Dfile.encoding=UTF-8"];
const TEST_TIMEOUT = 180_000;

const execFileAsync = promisify(execFile);
const tmpRoots: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 递归收集目录下 相对路径 → SHA-256。 */
function hashTree(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      Object.assign(out, hashTree(full, base));
    } else {
      out[path.relative(base, full)] = createHash("sha256")
        .update(readFileSync(full))
        .digest("hex");
    }
  }
  return out;
}

/** 用例 a 的任务 argv：const 转储（对齐 sample/gen_sample_output.ps1 $TASK_LINES 形态）。 */
function constDumpArgv(outDir: string): string[] {
  return [
    "-t",
    "lua",
    "-p",
    "protobuf",
    "-o",
    outDir,
    "-f",
    "proto_v2/kind.pb",
    "--pretty",
    "2",
    "-c",
    "kind_const.lua",
  ];
}

describe.skipIf(!HAS_JAR)("runJavaBatch: 真实 JAR 集成", () => {
  it("a. 单行任务经 stdin 执行 → exitCode 0，输出文件存在非空", {
    timeout: TEST_TIMEOUT,
  }, async () => {
    const outDir = makeTmpDir("xresconv-jr-a-");
    const result = await runJavaBatch({
      javaArgs: JAVA_ARGS,
      jarPath: JAR,
      workDir: SAMPLE,
      tasks: [encodeTaskLine(constDumpArgv(outDir))],
    });
    expect(result.exitCode).toBe(0);
    expect(result.failedTaskCount).toBe(0);
    const outFile = path.join(outDir, "kind_const.lua");
    expect(existsSync(outFile)).toBe(true);
    expect(statSync(outFile).size).toBeGreaterThan(0);
  });

  it("b. 编码器证明：stdin 与直接 argv 回退两路径输出逐文件 SHA-256 相同", {
    timeout: TEST_TIMEOUT,
  }, async () => {
    const stdinOut = makeTmpDir("xresconv-jr-b-stdin-");
    const argvOut = makeTmpDir("xresconv-jr-b-argv-");
    const argv = constDumpArgv(stdinOut);
    await runJavaBatch({
      javaArgs: JAVA_ARGS,
      jarPath: JAR,
      workDir: SAMPLE,
      tasks: [encodeTaskLine(argv)],
    });
    // 直接 argv 路径（buildArgvFallbackCommand：不经 stdin、无 tokenizer 限制）
    const fallbackArgv = constDumpArgv(argvOut);
    await execFileAsync("java", buildArgvFallbackCommand(JAVA_ARGS, JAR, fallbackArgv), {
      cwd: SAMPLE,
    });
    expect(hashTree(stdinOut)).toEqual(hashTree(argvOut));
  });

  it("c. 含空格/引号（撇号）的输出目录名任务成功", { timeout: TEST_TIMEOUT }, async () => {
    for (const name of ["空格 dir", "quote'dir"]) {
      const outDir = path.join(makeTmpDir("xresconv-jr-c-"), name);
      const result = await runJavaBatch({
        javaArgs: JAVA_ARGS,
        jarPath: JAR,
        workDir: SAMPLE,
        tasks: [encodeTaskLine(constDumpArgv(outDir))],
      });
      expect(result.exitCode).toBe(0);
      expect(existsSync(path.join(outDir, "kind_const.lua"))).toBe(true);
    }
  });

  it("d. 坏任务（不存在的 .pb）→ exitCode>0 透传，onLog 收到 stderr", {
    timeout: TEST_TIMEOUT,
  }, async () => {
    const logs: Array<{ stream: string; text: string }> = [];
    const result = await runJavaBatch({
      javaArgs: JAVA_ARGS,
      jarPath: JAR,
      workDir: SAMPLE,
      tasks: [
        encodeTaskLine(["-t", "lua", "-p", "protobuf", "-f", "no_such_file.pb", "-c", "x.lua"]),
      ],
      onLog: (stream, text) => logs.push({ stream, text }),
    });
    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.failedTaskCount).toBe(result.exitCode);
    const stderrText = logs
      .filter((l) => l.stream === "stderr")
      .map((l) => l.text)
      .join("");
    expect(stderrText).toContain("ERROR");
  });

  it("e. 多任务批次（3 行）顺序执行，日志到达次数 ≥ 任务数", {
    timeout: TEST_TIMEOUT,
  }, async () => {
    const logs: string[] = [];
    const dirs = [
      makeTmpDir("xresconv-jr-e1-"),
      makeTmpDir("xresconv-jr-e2-"),
      makeTmpDir("xresconv-jr-e3-"),
    ];
    const result = await runJavaBatch({
      javaArgs: JAVA_ARGS,
      jarPath: JAR,
      workDir: SAMPLE,
      tasks: dirs.map((dir) => encodeTaskLine(constDumpArgv(dir))),
      onLog: (_stream, text) => logs.push(text),
    });
    expect(result.exitCode).toBe(0);
    for (const dir of dirs) {
      expect(existsSync(path.join(dir, "kind_const.lua"))).toBe(true);
    }
    expect(logs.length).toBeGreaterThanOrEqual(dirs.length);
  });

  it("静默进程：tasks=[] 直接 end stdin，等退出", { timeout: TEST_TIMEOUT }, async () => {
    const result = await runJavaBatch({
      javaArgs: JAVA_ARGS,
      jarPath: JAR,
      workDir: SAMPLE,
      tasks: [],
    });
    expect(result.exitCode).toBe(0);
  });

  it("AbortSignal → 终止路径拒绝 AbortError", { timeout: TEST_TIMEOUT }, async () => {
    const controller = new AbortController();
    const outDir = makeTmpDir("xresconv-jr-abort-");
    const promise = runJavaBatch({
      javaArgs: JAVA_ARGS,
      jarPath: JAR,
      workDir: SAMPLE,
      tasks: [encodeTaskLine(constDumpArgv(outDir))],
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(AbortError);
  });

  it("deadlineMs 到期 → SIGTERM→宽限→SIGKILL，拒绝 HardDeadlineError", {
    timeout: TEST_TIMEOUT,
  }, async () => {
    const outDir = makeTmpDir("xresconv-jr-deadline-");
    await expect(
      runJavaBatch({
        javaArgs: JAVA_ARGS,
        jarPath: JAR,
        workDir: SAMPLE,
        tasks: [encodeTaskLine(constDumpArgv(outDir))],
        deadlineMs: 1,
      }),
    ).rejects.toBeInstanceOf(HardDeadlineError);
  });
});
