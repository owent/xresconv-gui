/**
 * End-to-end tests for ScriptWorkerPool (P2-01): every case runs the real
 * P2-03 worker (packages/script-host/bin/worker.mjs) as a child process via
 * the pool; only test g substitutes a fixture worker that speaks the frame
 * protocol and then poisons it. No protocol mocks. Every wait is bounded by
 * an explicit timeout constant (real subprocess = real clock; fake timers
 * cannot reach into children).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Envelope, ScriptInvoke } from "@xresconv/contracts";
import { describe, expect, it } from "vitest";
import type { WorkerDiag } from "../src/script-worker.ts";
import { ScriptWorkerPool, WorkerInvokeError } from "../src/script-worker.ts";

const SET_NAME_SAMPLE_PATH = fileURLToPath(
  new URL("../../../tests/fixtures/scripts/legacy-samples/set_name_item_name.js", import.meta.url),
);
const FAKE_WORKER_PATH = fileURLToPath(new URL("./fixtures/fake-worker.mjs", import.meta.url));
/** Per-test vitest timeout (task bound: <=15s per case). */
const TEST_TIMEOUT_MS = 15_000;
/** Bound for any single protocol/lifecycle wait. */
const WAIT_MS = 10_000;

type LogEvent = Envelope | WorkerDiag;

class LogCollector {
  readonly events: LogEvent[] = [];
  private readonly waiters: {
    pred: (event: LogEvent) => boolean;
    resolve: (event: LogEvent) => void;
    timer: NodeJS.Timeout;
  }[] = [];

  readonly handler = (event: LogEvent): void => {
    const index = this.waiters.findIndex((waiter) => waiter.pred(event));
    if (index >= 0) {
      const waiter = this.waiters[index];
      this.waiters.splice(index, 1);
      if (waiter !== undefined) {
        clearTimeout(waiter.timer);
        waiter.resolve(event);
      }
      return;
    }
    this.events.push(event);
  };

  waitFor(
    pred: (event: LogEvent) => boolean,
    label: string,
    timeoutMs = WAIT_MS,
  ): Promise<LogEvent> {
    const buffered = this.events.findIndex(pred);
    if (buffered >= 0) {
      const event = this.events[buffered];
      this.events.splice(buffered, 1);
      if (event !== undefined) {
        return Promise.resolve(event);
      }
    }
    const { promise, resolve, reject } = Promise.withResolvers<LogEvent>();
    const timer = setTimeout(
      () => reject(new Error(`timeout (${timeoutMs}ms) waiting ${label}`)),
      timeoutMs,
    );
    this.waiters.push({ pred, resolve, timer });
    return promise;
  }
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

function makeInvoke(overrides: Partial<ScriptInvoke>): ScriptInvoke {
  return {
    invocation_id: randomUUID(),
    entry_kind: "on_before_convert",
    filename: "pool-test.js",
    source: "resolve();",
    timeout_ms: 1000,
    context: {},
    ...overrides,
  };
}

const ALERT_ORDER_SOURCE = [
  "var order = [];",
  'alert_warning("内容", "标题", {',
  '  yes: function () { order.push("yes"); },',
  '  no: function () { order.push("no"); },',
  "  on_close: function () {",
  '    order.push("close");',
  '    log_notice("order=" + order.join(","));',
  "    resolve();",
  "  },",
  "});",
].join("\n");

describe("ScriptWorkerPool (P2-01)", () => {
  it(
    "a. start handshakes health; set_name sample resolves with field ops",
    async () => {
      const pool = new ScriptWorkerPool();
      try {
        await pool.start();
        const stats = pool.stats();
        expect(stats).toHaveLength(1);
        expect(typeof stats[0]?.pid).toBe("number");
        const invoke = makeInvoke({
          entry_kind: "set_name",
          filename: SET_NAME_SAMPLE_PATH,
          source: readFileSync(SET_NAME_SAMPLE_PATH, "utf8"),
          context: {
            work_dir: os.tmpdir(),
            configure_file: path.join(os.tmpdir(), "conv.xml"),
            item_data: { id: 1, file: "data/hero.xlsx", scheme: "hero", name: "old-name" },
          },
        });
        const result = await pool.invoke(invoke);
        expect(result.outcome).toBe("resolved");
        expect(result.ops?.[0]).toMatchObject({
          op: "set_fields",
          target: "item_data",
          fields: { name: "hero.xlsx | hero" },
        });
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "b. button data persists across invokes on the same worker",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      try {
        await pool.start();
        const first = makeInvoke({
          entry_kind: "button",
          button_id: "pool-btn",
          source: "data.n = 41; resolve();",
        });
        expect((await pool.invoke(first)).outcome).toBe("resolved");
        const second = makeInvoke({
          entry_kind: "button",
          button_id: "pool-btn",
          source: 'if (data.n === 41) { resolve("ok"); } else { reject("n=" + String(data.n)); }',
        });
        const result = await pool.invoke(second);
        expect(result.outcome).toBe("resolved");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "c. dialog auto-responds null without a handler; handler can drive yes->on_close",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      const logs = new LogCollector();
      pool.onLog = logs.handler;
      try {
        await pool.start();
        // No onDialogRequest: the pool answers choice null (ESC-equivalent) and
        // must not deadlock; the invocation ends at the worker wall-clock.
        const escInvoke = makeInvoke({ source: ALERT_ORDER_SOURCE, timeout_ms: 400 });
        const escResult = await pool.invoke(escInvoke);
        expect(escResult.outcome).toBe("rejected");
        expect(escResult.reason).toBe("Run event callback timeout");

        const dialogRequests: Envelope[] = [];
        pool.onDialogRequest = (env, respond) => {
          dialogRequests.push(env);
          respond("yes");
        };
        const yesInvoke = makeInvoke({ source: ALERT_ORDER_SOURCE, timeout_ms: 2000 });
        const yesResult = await pool.invoke(yesInvoke);
        expect(yesResult.outcome).toBe("resolved");
        expect(dialogRequests).toHaveLength(1);
        expect(dialogRequests[0]?.payload.buttons).toEqual(["yes", "no"]);
        const orderLog = await logs.waitFor(
          (event) =>
            "kind" in event &&
            event.kind === "log" &&
            event.payload.invocation_id === yesInvoke.invocation_id,
          "order log",
        );
        expect((orderLog as Envelope).payload.message).toBe("order=yes,close");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "d. a stuck worker is destroyed on WORKER_TIMEOUT and the pool replenishes",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      try {
        await pool.start();
        const oldPid = pool.stats()[0]?.pid;
        expect(oldPid).toBeDefined();
        const stuck = makeInvoke({ source: "while (true) {}", timeout_ms: 2000 });
        const err = await expectInvokeError(
          pool.invoke(stuck, { timeoutMs: 300 }),
          "WORKER_TIMEOUT",
        );
        expect(err.message).toContain(stuck.invocation_id);
        // Replenishment is asynchronous (spawn + health handshake on a real child).
        await waitUntil(
          () => pool.stats().some((s) => s.pid !== undefined && s.pid !== oldPid),
          "pool replenish",
        );
        const after = makeInvoke({ source: 'resolve("back");' });
        expect((await pool.invoke(after)).outcome).toBe("resolved");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "e. concurrent invokes spread across workers (size 2)",
    async () => {
      const pool = new ScriptWorkerPool({ size: 2 });
      try {
        await pool.start();
        const invokes = Array.from({ length: 4 }, () =>
          makeInvoke({
            source: 'setTimeout(function () { resolve("ok"); }, 50);',
            timeout_ms: 2000,
          }),
        );
        const results = await Promise.all(invokes.map((invoke) => pool.invoke(invoke)));
        for (const result of results) {
          expect(result.outcome).toBe("resolved");
        }
        const stats = pool.stats();
        expect(stats).toHaveLength(2);
        expect(new Set(stats.map((s) => s.pid)).size).toBe(2);
        expect(stats.reduce((sum, s) => sum + s.served, 0)).toBe(4);
        for (const stat of stats) {
          expect(stat.served).toBeGreaterThanOrEqual(1);
          expect(stat.inflight).toBe(0);
        }
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "f. shutdown is idempotent and lets the in-flight invocation finish",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      await pool.start();
      const slow = makeInvoke({
        source: 'setTimeout(function () { resolve("done"); }, 100);',
        timeout_ms: 5000,
      });
      const resultPromise = pool.invoke(slow);
      const first = pool.shutdown();
      const second = pool.shutdown();
      expect(second).toBe(first);
      expect((await resultPromise).outcome).toBe("resolved");
      await first;
      expect(pool.stats()).toHaveLength(0);
      await expectInvokeError(pool.invoke(makeInvoke({})), "POOL_SHUTDOWN");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "g. a worker emitting invalid envelopes is discarded without crashing the pool",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1, workerEntry: FAKE_WORKER_PATH });
      const logs = new LogCollector();
      pool.onLog = logs.handler;
      try {
        // The fake worker handshakes a valid health frame, then poisons the channel.
        await pool.start();
        expect(pool.stats()).toHaveLength(1);
        const fault = await logs.waitFor(
          (event) => !("kind" in event) && event.source === "worker-fault",
          "worker-fault diag",
        );
        expect((fault as WorkerDiag).line).toContain("invalid envelope");
        // Fault policy: discard, NO replenish (BD-W1) — invoke must fail fast, never hang.
        await expectInvokeError(pool.invoke(makeInvoke({})), "NO_WORKER_AVAILABLE");
        expect(pool.stats()).toHaveLength(0);
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
