/**
 * 弹框回调注册表与失效逻辑（P2-06 / SC06）：真实 worker 子进程，无协议 mock。
 *
 * 覆盖：TTL 过期自动收尾（BD-W10）、worker 死亡时在途弹框失效、
 * dismissPendingDialogs 显式代际收尾、过期/迟到应答不执行（SC06）。
 * worker 侧的回调次数/顺序/exactly-once 在 script-host 的 worker.test.ts（l/o/p）。
 */

import { randomUUID } from "node:crypto";
import type { Envelope, ScriptInvoke } from "@xresconv/contracts";
import { describe, expect, it } from "vitest";
import type { WorkerDiag } from "../src/script-worker.ts";
import { ScriptWorkerPool, WorkerInvokeError } from "../src/script-worker.ts";

/** Per-test vitest timeout. */
const TEST_TIMEOUT_MS = 15_000;
/** Bound for any single protocol/lifecycle wait. */
const WAIT_MS = 10_000;

const ALERT_HANG_SOURCE = [
  'alert_warning("内容", "标题", {',
  '  yes: function () { log_notice("YES-FIRED"); },',
  "  on_close: function () {",
  '    log_notice("CLOSE-FIRED");',
  "    resolve();",
  "  },",
  "});",
].join("\n");

function makeInvoke(overrides: Partial<ScriptInvoke>): ScriptInvoke {
  return {
    invocation_id: randomUUID(),
    entry_kind: "on_before_convert",
    filename: "dialog-registry-test.js",
    source: ALERT_HANG_SOURCE,
    timeout_ms: 2000,
    context: {},
    ...overrides,
  };
}

/** Polls a real-lifecycle condition; the child's clock is real, so no fake timers. */
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

describe("dialog registry (P2-06)", () => {
  it(
    "a. TTL 过期：自动按 null 应答（BD-W10），通知失效，迟到应答不执行",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1, dialogTimeoutMs: 150 });
      const invalidated: { env: Envelope; reason: string }[] = [];
      const diags: string[] = [];
      pool.onLog = (event) => {
        if (!("kind" in event)) {
          diags.push((event as WorkerDiag).line);
        }
      };
      const pending: { env: Envelope; respond: (choice: "yes" | "no" | null) => void }[] = [];
      pool.onDialogRequest = (env, respond) => {
        pending.push({ env, respond });
      };
      pool.onDialogInvalidate = (env, reason) => {
        invalidated.push({ env, reason });
      };
      try {
        await pool.start();
        // 弹框后挂起（on_close 才 resolve）；invoke 自身超时 900ms 给 TTL 留窗口。
        const invoke = makeInvoke({ timeout_ms: 900 });
        const resultPromise = pool.invoke(invoke);
        await waitUntil(() => pending.length === 1, "dialog_request arrived");

        // 不应答 → TTL(150ms) 过期：invalidate 通知 + 按 null 应答（worker 无回调）。
        await waitUntil(() => invalidated.length === 1, "dialog invalidated by TTL");
        expect(invalidated[0]?.reason).toContain("auto-dismissed");
        expect(invalidated[0]?.env.payload.token).toBe(invokePayloadToken(pending[0]?.env));

        // 迟到应答必须被丢弃（SC06：过期回调不执行）。
        pending[0]?.respond("yes");
        const result = await resultPromise;
        expect(result.outcome).toBe("rejected");
        expect(result.reason).toBe("Run event callback timeout");
        // worker 侧确认最终化（fd2 诊断，无 YES-FIRED/CLOSE-FIRED 日志）。
        await waitUntil(
          () => diags.some((line) => line.includes("dismissed without choice")),
          "worker dismissal diagnostic",
        );
        expect(diags.some((line) => line.includes("YES-FIRED"))).toBe(false);
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "b. worker 超时销毁 → 在途弹框失效且不向死进程应答；池补员后可用",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      const invalidated: { env: Envelope; reason: string }[] = [];
      pool.onDialogInvalidate = (env, reason) => {
        invalidated.push({ env, reason });
      };
      const pending: { respond: (choice: "yes" | "no" | null) => void }[] = [];
      pool.onDialogRequest = (_env, respond) => {
        pending.push({ respond });
      };
      try {
        await pool.start();
        const oldPid = pool.stats()[0]?.pid;
        // 弹框挂起；invoke 级 400ms 超时 < worker 外层兜底（3000ms+grace）→
        // guardian 判超时并销毁 worker（BD-W3），在途弹框随之失效。
        const invoke = makeInvoke({ timeout_ms: 3000 });
        const resultPromise = pool.invoke(invoke, { timeoutMs: 400 });
        await waitUntil(() => pending.length === 1, "dialog_request arrived");
        await expectInvokeError(resultPromise, "WORKER_TIMEOUT");
        await waitUntil(() => invalidated.length === 1, "dialog invalidated on worker exit");
        expect(invalidated[0]?.reason).toContain("exited");

        // 迟到应答丢弃（worker 已死，不应答不崩溃）。
        pending[0]?.respond("yes");
        // 池补员后可继续服务（BD-W3）。
        await waitUntil(
          () => pool.stats().length === 1 && pool.stats()[0]?.pid !== oldPid,
          "worker replenished",
        );
        const ok = await pool.invoke(makeInvoke({ source: "resolve();", timeout_ms: 1000 }));
        expect(ok.outcome).toBe("resolved");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "c. dismissPendingDialogs：代际切换显式收尾全部在途弹框（各应答 null + 通知）",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      const invalidated: string[] = [];
      pool.onDialogInvalidate = (_env, reason) => {
        invalidated.push(reason);
      };
      const pending: { env: Envelope; respond: (choice: "yes" | "no" | null) => void }[] = [];
      pool.onDialogRequest = (env, respond) => {
        pending.push({ env, respond });
      };
      try {
        await pool.start();
        const first = makeInvoke({ timeout_ms: 800 });
        const second = makeInvoke({ timeout_ms: 800 });
        const r1 = pool.invoke(first);
        const r2 = pool.invoke(second);
        await waitUntil(() => pending.length === 2, "two dialogs pending");

        const dismissed = pool.dismissPendingDialogs("test reload");
        expect(dismissed).toBe(2);
        expect(invalidated).toEqual(["test reload", "test reload"]);

        // 已 dismiss 的弹框再应答无效（SC06）；两个 invoke 都在自身 wall-clock 收尾。
        pending[0]?.respond("yes");
        pending[1]?.respond("no");
        const [res1, res2] = await Promise.all([r1, r2]);
        expect(res1.outcome).toBe("rejected");
        expect(res2.outcome).toBe("rejected");
        expect(pool.dismissPendingDialogs("again")).toBe(0); // 幂等
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );
});

function invokePayloadToken(env: Envelope | undefined): unknown {
  return env?.payload.token;
}

async function expectInvokeError(
  pending: Promise<unknown>,
  code: string,
): Promise<WorkerInvokeError> {
  try {
    await pending;
  } catch (err) {
    expect(err).toBeInstanceOf(WorkerInvokeError);
    expect((err as WorkerInvokeError).code).toBe(code);
    return err as WorkerInvokeError;
  }
  throw new Error(`expected invoke to reject with ${code}`);
}
