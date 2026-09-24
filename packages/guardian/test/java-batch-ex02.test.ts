/**
 * EX02 批次调度/背压/退出汇总（P3-07）：fake-converter 确定性模拟
 * xresloader --stdin 协议（fixtures/fake-converter.mjs），覆盖真实 JAR 不便
 * 构造的输出模式矩阵。全部真实子进程、显式有界超时、无协议 mock。
 *
 * 验收点（docs/plan/06-testing-acceptance.md EX02）：
 * - 各输出模式：silent（无输出也完成）/chatty（多块日志不改变任务数）；
 * - slow stdin 慢消费 → 写端背压，任务行不丢不重（每任务只提交一次）；
 * - 提前关闭（EPIPE/close 收尾）不挂起；
 * - 退出汇总：failedTaskCount = exitCode（批次失败不冒充精确条目失败数）；
 * - 派生子进程随整树回收（SC11 java 侧）。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { HardDeadlineError, runJavaBatch } from "../src/index.ts";

const FAKE = fileURLToPath(new URL("./fixtures/fake-converter.mjs", import.meta.url));
const TEST_TIMEOUT_MS = 30_000;

const tmpRoots: string[] = [];

afterAll(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xresconv-ex02-"));
  tmpRoots.push(dir);
  return dir;
}

function fakeSpec(env: Record<string, string>): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return { command: process.execPath, args: [FAKE], env: { FAKE_CONV_MODE: "echo", ...env } };
}

function makeTasks(count: number, padBytes = 0): string[] {
  const pad = "p".repeat(padBytes);
  return Array.from({ length: count }, (_, i) => `-t task-${i} ${pad}`.trim());
}

async function waitUntil(cond: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (cond()) return;
    if (Date.now() >= deadline) throw new Error(`timeout waiting ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("runJavaBatch EX02（fake-converter 输出模式矩阵）", () => {
  it("静默进程：无输出也按 close 正常完成（BD-P2：不依赖 data 事件驱动）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const dir = makeTmp();
    const logs: string[] = [];
    const result = await runJavaBatch({
      jarPath: "fake-converter",
      workDir: dir,
      tasks: makeTasks(5),
      spawnSpec: fakeSpec({ FAKE_CONV_MODE: "silent" }),
      onLog: (stream, text) => logs.push(`${stream}:${text}`),
    });
    expect(result.exitCode).toBe(0);
    expect(result.failedTaskCount).toBe(0);
    expect(logs.length).toBe(0);
  });

  it("多块日志：半行拆分/双流交织不产生重复派发，任务计数与日志量无关", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const dir = makeTmp();
    const countFile = path.join(dir, "count.json");
    const outLines: string[] = [];
    const errLines: string[] = [];
    const result = await runJavaBatch({
      jarPath: "fake-converter",
      workDir: dir,
      tasks: makeTasks(3),
      spawnSpec: fakeSpec({ FAKE_CONV_MODE: "chatty", FAKE_CONV_COUNT_FILE: countFile }),
      onLog: (stream, text) => (stream === "stdout" ? outLines : errLines).push(text),
    });
    expect(result.exitCode).toBe(0);
    expect(result.failedTaskCount).toBe(0);
    // 行缓冲拼接：3 任务各 1 条完整 stdout 行 + 1 条完整 stderr 行（半行已拼合）。
    expect(outLines.length).toBe(3);
    expect(errLines.length).toBe(3);
    expect(outLines[0]).toMatch(/^\[part1 1\] /);
    // 每任务只提交一次：converter 实收 3 行且互不重复。
    const received = JSON.parse(readFileSync(countFile, "utf8")) as string[];
    expect(received.length).toBe(3);
    expect(new Set(received).size).toBe(3);
  });

  it("slow stdin 慢消费：写端背压下 96×4KB 任务行全部恰好一次到达", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const dir = makeTmp();
    const countFile = path.join(dir, "count.json");
    const tasks = makeTasks(96, 4096); // 总量 ~400KB，远超管道缓冲，必经 drain
    const result = await runJavaBatch({
      jarPath: "fake-converter",
      workDir: dir,
      tasks,
      spawnSpec: fakeSpec({ FAKE_CONV_MODE: "slow", FAKE_CONV_COUNT_FILE: countFile }),
    });
    expect(result.exitCode).toBe(0);
    const received = JSON.parse(readFileSync(countFile, "utf8")) as string[];
    expect(received.length).toBe(96);
    expect(new Set(received).size).toBe(96);
    // 顺序保持（FIFO，BD-P1）。
    expect(received[0]).toContain("task-0");
    expect(received[95]).toContain("task-95");
  });

  it("提前关闭：converter 首行后 exit 7 → 按 close 收尾，failedTaskCount=exitCode，不挂起", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const dir = makeTmp();
    const result = await runJavaBatch({
      jarPath: "fake-converter",
      workDir: dir,
      tasks: makeTasks(10),
      spawnSpec: fakeSpec({ FAKE_CONV_MODE: "early-exit", FAKE_CONV_EXIT: "7" }),
    });
    expect(result.exitCode).toBe(7);
    // 批次失败不冒充精确条目失败数：汇总只有 exitCode 语义（Main.java:407 约定）。
    expect(result.failedTaskCount).toBe(7);
  });

  it("退出汇总：fail 模式 exit 3（4 任务）→ failedTaskCount=3（退出码语义，非任务数）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const dir = makeTmp();
    const result = await runJavaBatch({
      jarPath: "fake-converter",
      workDir: dir,
      tasks: makeTasks(4),
      spawnSpec: fakeSpec({ FAKE_CONV_MODE: "fail", FAKE_CONV_EXIT: "3" }),
    });
    expect(result.exitCode).toBe(3);
    expect(result.failedTaskCount).toBe(3);
  });

  it("派生子进程随整树回收（SC11 java 侧）：挂起批次被 deadline 终止后孙进程死亡", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const dir = makeTmp();
    const pidFile = path.join(dir, "child.pid");
    await expect(
      runJavaBatch({
        jarPath: "fake-converter",
        workDir: dir,
        tasks: makeTasks(1),
        deadlineMs: 800,
        spawnSpec: fakeSpec({ FAKE_CONV_MODE: "child", FAKE_CONV_CHILD_PID_FILE: pidFile }),
      }),
    ).rejects.toBeInstanceOf(HardDeadlineError);
    expect(existsSync(pidFile)).toBe(true);
    const childPid = Number(readFileSync(pidFile, "utf8"));
    expect(Number.isSafeInteger(childPid)).toBe(true);
    await waitUntil(() => !pidAlive(childPid), `child pid ${childPid} reaped`);
  });
});
