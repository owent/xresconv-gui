/**
 * 资源限额与内存耗尽验收（P2-07 / SC07/SC08 内存部分）：真实 worker 子进程。
 *
 * - a. V8 堆硬顶（--max-old-space-size）：堆耗尽 → V8 fatal 杀进程 → 在途
 *   invocation 收 WORKER_EXIT、池补员、后续可用、无自动重放（单次结算）。
 * - b. RSS 看门狗（BD-W11）：Buffer 外部内存绕过 V8 堆顶（--max-old-space-size
 *   管不到），RSS 超限 → guardian 销毁 + 诊断 + 补员。
 * - c. 周期健康自报携带 memoryUsage，stats() 透出 RSS 峰值。
 *
 * 外层超时全部显式有界（真实子进程 = 真实时钟）。
 */

import { randomUUID } from "node:crypto";
import type { ScriptInvoke } from "@xresconv/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkerDiag } from "../src/script-worker.ts";
import { ScriptWorkerPool, WorkerInvokeError } from "../src/script-worker.ts";

const TEST_TIMEOUT_MS = 20_000;
const WAIT_MS = 15_000;
const HEALTH_ENV = "XRESCONV_WORKER_HEALTH_INTERVAL_MS";

function makeInvoke(overrides: Partial<ScriptInvoke>): ScriptInvoke {
  return {
    invocation_id: randomUUID(),
    entry_kind: "on_before_convert",
    filename: "resource-limits-test.js",
    source: "resolve();",
    timeout_ms: 1000,
    context: {},
    ...overrides,
  };
}

async function waitUntil(cond: () => boolean, label: string, timeoutMs = WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (cond()) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timeout (${timeoutMs}ms) waiting ${label}`);
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 25);
    await promise;
  }
}

async function expectInvokeError(pending: Promise<unknown>, code: string): Promise<void> {
  try {
    await pending;
  } catch (err) {
    expect(err).toBeInstanceOf(WorkerInvokeError);
    expect((err as WorkerInvokeError).code).toBe(code);
    return;
  }
  throw new Error(`expected invoke to reject with ${code}`);
}

describe("worker resource limits (P2-07)", () => {
  afterEach(() => {
    delete process.env[HEALTH_ENV];
  });

  it(
    "a. V8 堆耗尽（64MB 硬顶）→ worker 死亡、WORKER_EXIT、补员、无重放",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1, workerMaxOldSpaceMb: 64 });
      const diags: string[] = [];
      pool.onLog = (event) => {
        if (!("kind" in event)) {
          diags.push((event as WorkerDiag).line);
        }
      };
      try {
        await pool.start();
        const oldPid = pool.stats()[0]?.pid;
        // 堆硬顶下死循环分配：V8 fatal "heap out of memory" 杀掉进程；
        // 不 resolve，若硬顶失效则由 invoke 级 12s 超时兜底销毁（测试会失败暴露）。
        const oom = makeInvoke({
          source: "var a=[]; for(;;){ a.push(new Array(1024*1024)); }",
          timeout_ms: 30_000,
        });
        await expectInvokeError(pool.invoke(oom, { timeoutMs: 12_000 }), "WORKER_EXIT");
        await waitUntil(
          () => pool.stats().length === 1 && pool.stats()[0]?.pid !== oldPid,
          "worker replenished after OOM",
        );
        expect(diags.some((line) => line.includes("heap out of memory"))).toBe(true);
        const ok = await pool.invoke(makeInvoke({ source: "resolve();" }));
        expect(ok.outcome).toBe("resolved");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "b. RSS 看门狗（BD-W11）：Buffer 外部内存绕过 V8 堆顶，超限即销毁",
    async () => {
      process.env[HEALTH_ENV] = "100";
      const limitBytes = 256 * 1024 * 1024;
      const pool = new ScriptWorkerPool({ size: 1, memoryLimitBytes: limitBytes });
      const diags: string[] = [];
      pool.onLog = (event) => {
        if (!("kind" in event)) {
          diags.push((event as WorkerDiag).line);
        }
      };
      try {
        await pool.start();
        const oldPid = pool.stats()[0]?.pid;
        // Buffer.alloc 是外部内存（不占 V8 老年代）；setTimeout 递归分配（沙箱只
        // 注入 setTimeout/clearTimeout，BD-S7），每 25ms +64MB → RSS 超 256MB；
        // 下一次健康自报触发看门狗销毁。不 resolve；12s invoke 超时兜底。
        // 注意必须 fill(1) 逐页写脏：alloc 的零填充内存在 Windows 上是惰性提交
        // 的，只分配不触碰 RSS 不涨（P2-07 实测教训）。
        const hog = makeInvoke({
          source: [
            'var B = require("node:buffer").Buffer;',
            "var chunks = [];",
            "(function alloc(){ var b=B.alloc(64*1024*1024); b.fill(1); chunks.push(b); setTimeout(alloc, 25); })();",
          ].join("\n"),
          timeout_ms: 30_000,
        });
        await expectInvokeError(pool.invoke(hog, { timeoutMs: 12_000 }), "WORKER_EXIT");
        expect(diags.some((line) => line.includes("exceeds memory limit"))).toBe(true);
        await waitUntil(
          () => pool.stats().length === 1 && pool.stats()[0]?.pid !== oldPid,
          "worker replenished after RSS kill",
        );
        const ok = await pool.invoke(makeInvoke({ source: "resolve();" }));
        expect(ok.outcome).toBe("resolved");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "c. 健康自报携带 memoryUsage：stats() 透出 RSS 峰值",
    async () => {
      process.env[HEALTH_ENV] = "100";
      const pool = new ScriptWorkerPool({ size: 1 });
      try {
        await pool.start();
        const result = await pool.invoke(makeInvoke({ source: "resolve();" }));
        expect(result.outcome).toBe("resolved");
        await waitUntil(
          () => (pool.stats()[0]?.maxRssBytes ?? 0) > 0,
          "memory self-report observed",
        );
        const peak = pool.stats()[0]?.maxRssBytes ?? 0;
        // Node 24 worker 基线 RSS 合理区间（10MB ~ 1GB），证明是真实采样而非占位。
        expect(peak).toBeGreaterThan(10 * 1024 * 1024);
        expect(peak).toBeLessThan(1024 * 1024 * 1024);
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
