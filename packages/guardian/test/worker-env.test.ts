/**
 * P2-10 环境策略接线：ScriptWorkerPool.workerEnv 覆盖注入到 worker 进程
 * 环境的验证（发行接线点——backend 据此注入 XRESCONV_SCRIPT_MODULE_DIRS）。
 * 真实 worker 子进程，无协议 mock；等待均有显式超时。
 */
import { randomUUID } from "node:crypto";
import type { ScriptInvoke } from "@xresconv/contracts";
import { describe, expect, it } from "vitest";
import { ScriptWorkerPool } from "../src/script-worker.ts";

const TEST_TIMEOUT_MS = 15_000;
const WAIT_MS = 10_000;

function makeInvoke(overrides: Partial<ScriptInvoke>): ScriptInvoke {
  return {
    invocation_id: randomUUID(),
    entry_kind: "on_before_convert",
    filename: "pool-env-test.js",
    source: "resolve();",
    timeout_ms: 5000,
    context: {},
    ...overrides,
  };
}

describe("ScriptWorkerPool workerEnv (P2-10)", () => {
  it(
    "workerEnv 注入新键并覆盖继承键；脚本经 require(node:process) 可见",
    async () => {
      const pool = new ScriptWorkerPool({
        size: 1,
        workerEnv: {
          XRESCONV_P210_POOL_MARKER: "pool-环境样本",
          // 覆盖继承键：worker 必须看到注入值而非宿主的 TEMP。
          TEMP: "D:\\xresconv-p210-pool-temp",
        },
      });
      try {
        await pool.start();
        const logPromise = new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("timeout waiting for env log")), WAIT_MS);
          pool.onLog = (event) => {
            if (
              "kind" in event &&
              event.kind === "log" &&
              event.payload.invocation_id === invoke.invocation_id
            ) {
              clearTimeout(timer);
              resolve(String(event.payload.message));
            }
          };
        });
        const invoke = makeInvoke({
          source: [
            'var env = require("node:process").env;',
            "log_notice(JSON.stringify({ marker: env.XRESCONV_P210_POOL_MARKER, temp: env.TEMP }));",
            "resolve();",
          ].join("\n"),
        });
        const result = await pool.invoke(invoke);
        expect(result.outcome).toBe("resolved");
        const report = JSON.parse(await logPromise) as Record<string, unknown>;
        expect(report.marker).toBe("pool-环境样本");
        expect(report.temp).toBe("D:\\xresconv-p210-pool-temp");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
