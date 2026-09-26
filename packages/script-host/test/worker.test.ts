/**
 * End-to-end tests for the script worker: every case spawns the real
 * bin/worker.mjs as a child process and speaks the framed envelope protocol
 * (@xresconv/ipc) over its stdio. No mocks. Every wait is bounded by an
 * explicit timeout constant; no unbounded waits, no long wall-clock timers.
 */

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Envelope, ScriptInvoke, ScriptResult } from "@xresconv/contracts";
import { encodeFrame, FrameDecoder } from "@xresconv/ipc";
import { describe, expect, it } from "vitest";

const WORKER_PATH = fileURLToPath(new URL("../bin/worker.mjs", import.meta.url));
const SET_NAME_SAMPLE_PATH = fileURLToPath(
  new URL("../../../tests/fixtures/scripts/legacy-samples/set_name_item_name.js", import.meta.url),
);
/** Generic bound for any single protocol wait. */
const WAIT_MS = 10_000;
/** Bound for tests that must finish quickly (vm/wall-clock timeouts). */
const FAST_WAIT_MS = 5_000;
/** Per-test vitest timeout. */
const TEST_TIMEOUT_MS = 20_000;

interface ExitInfo {
  code: number | null;
  signal: string | null;
}

interface Waiter {
  pred: (env: Envelope) => boolean;
  resolve: (env: Envelope) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

class WorkerClient {
  readonly child: ChildProcess;
  readonly exited: Promise<ExitInfo>;
  stderrText = "";
  private readonly received: Envelope[] = [];
  private readonly waiters: Waiter[] = [];

  constructor() {
    this.child = spawn(process.execPath, [WORKER_PATH], { stdio: ["pipe", "pipe", "pipe"] });
    const decoder = new FrameDecoder(
      (value) => this.dispatch(value as Envelope),
      (error) => this.failAll(new Error(`frame decode error: ${error.message}`)),
    );
    this.child.stdout?.on("data", (chunk: Buffer) => decoder.push(chunk));
    this.child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrText += chunk.toString("utf8");
    });
    const { promise, resolve } = Promise.withResolvers<ExitInfo>();
    this.exited = promise;
    this.child.on("exit", (code, signal) => resolve({ code, signal }));
  }

  private dispatch(env: Envelope): void {
    const index = this.waiters.findIndex((waiter) => waiter.pred(env));
    if (index >= 0) {
      const waiter = this.waiters[index];
      this.waiters.splice(index, 1);
      if (waiter !== undefined) {
        clearTimeout(waiter.timer);
        waiter.resolve(env);
      }
      return;
    }
    this.received.push(env);
  }

  private failAll(err: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
  }

  sendValue(value: unknown): void {
    this.child.stdin?.write(encodeFrame(value));
  }

  send(kind: Envelope["kind"], payload: Record<string, unknown>, extra?: Partial<Envelope>): void {
    this.sendValue({
      protocol_version: 1,
      kind,
      id: randomUUID(),
      role: "guardian",
      payload,
      ...extra,
    });
  }

  invoke(payload: ScriptInvoke): void {
    this.send("invoke", payload as unknown as Record<string, unknown>);
  }

  // Real subprocess = real clock: fake timers cannot reach into the child, so
  // protocol waits are bounded by explicit timeout guards (task requirement).
  waitFor(pred: (env: Envelope) => boolean, label: string, timeoutMs = WAIT_MS): Promise<Envelope> {
    const buffered = this.received.findIndex(pred);
    if (buffered >= 0) {
      const env = this.received[buffered];
      this.received.splice(buffered, 1);
      if (env !== undefined) {
        return Promise.resolve(env);
      }
    }
    const { promise, resolve, reject } = Promise.withResolvers<Envelope>();
    const timer = setTimeout(() => {
      const index = this.waiters.findIndex((waiter) => waiter.resolve === resolve);
      if (index >= 0) {
        this.waiters.splice(index, 1);
      }
      reject(
        new Error(`timeout (${timeoutMs}ms) waiting for ${label}; stderr: ${this.stderrText}`),
      );
    }, timeoutMs);
    this.waiters.push({ pred, resolve, reject, timer });
    return promise;
  }

  ofKind(kind: Envelope["kind"], timeoutMs = WAIT_MS): Promise<Envelope> {
    return this.waitFor((env) => env.kind === kind, `kind=${kind}`, timeoutMs);
  }

  completeOf(invocationId: string, timeoutMs = WAIT_MS): Promise<ScriptResult> {
    return this.waitFor(
      (env) => env.kind === "complete" && env.invocation_id === invocationId,
      `complete of ${invocationId}`,
      timeoutMs,
    ).then((env) => env.payload as unknown as ScriptResult);
  }

  logOf(invocationId: string, timeoutMs = WAIT_MS): Promise<Record<string, unknown>> {
    return this.waitFor(
      (env) => env.kind === "log" && env.payload.invocation_id === invocationId,
      `log of ${invocationId}`,
      timeoutMs,
    ).then((env) => env.payload);
  }

  /** Frames received but not yet consumed by a waitFor; drains the buffer. */
  drainBuffered(): Envelope[] {
    return this.received.splice(0);
  }

  async close(): Promise<void> {
    this.child.kill();
    await raceTimeout(this.exited, FAST_WAIT_MS);
  }
}

it(
  "worker exits when its owning control pipe closes",
  async () => {
    const client = new WorkerClient();
    try {
      await client.ofKind("health");
      const invoke = makeInvoke({
        source: 'require("node:timers").setInterval(() => {}, 1000); resolve();',
      });
      client.invoke(invoke);
      await client.completeOf(invoke.invocation_id);
      client.child.stdin?.end();
      expect(await raceTimeout(client.exited, 3000)).not.toBeNull();
    } finally {
      await client.close();
    }
  },
  TEST_TIMEOUT_MS,
);

/** Bounds a promise by the real clock; required because the SUT is a separate process. */
async function raceTimeout<T>(pending: Promise<T>, ms: number): Promise<T | null> {
  const { promise, resolve } = Promise.withResolvers<null>();
  const timer = setTimeout(() => resolve(null), ms);
  try {
    return await Promise.race([pending, promise]);
  } finally {
    clearTimeout(timer);
  }
}

function makeInvoke(overrides: Partial<ScriptInvoke>): ScriptInvoke {
  return {
    invocation_id: randomUUID(),
    entry_kind: "on_before_convert",
    filename: "test-script.js",
    source: "resolve();",
    timeout_ms: 1000,
    context: {},
    ...overrides,
  };
}

describe("script worker (P2-03)", () => {
  it(
    "a. emits a health envelope on startup",
    async () => {
      const client = new WorkerClient();
      try {
        const health = await client.ofKind("health");
        expect(health.protocol_version).toBe(1);
        expect(health.role).toBe("script-worker");
        expect(health.id.length).toBeGreaterThan(0);
        expect(health.payload).toMatchObject({ ok: true, pid: client.child.pid });
        expect(String(health.payload.node)).toMatch(/^v\d+\./);
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "b. set_name runs the legacy sample and reports field ops",
    async () => {
      const client = new WorkerClient();
      try {
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
        client.invoke(invoke);
        const log = await client.logOf(invoke.invocation_id);
        expect(log).toMatchObject({
          op: "log",
          level: "info",
          message: "set_name -> hero.xlsx | hero",
          module_name: "CONV EVENT",
        });
        const result = await client.completeOf(invoke.invocation_id);
        expect(result.outcome).toBe("resolved");
        expect(result.ops).toHaveLength(1);
        expect(result.ops?.[0]).toMatchObject({
          op: "set_fields",
          target: "item_data",
          fields: { name: "hero.xlsx | hero" },
        });
        // Log ops stream as kind:"log" envelopes; they must not be duplicated into result.ops.
        expect(result.ops?.filter((op) => op.op === "log")).toHaveLength(0);
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "c. event context carries every legacy key with the legacy types",
    async () => {
      const client = new WorkerClient();
      try {
        const source = [
          "const report = {",
          "  work_dir: typeof work_dir,",
          "  configure_file: typeof configure_file,",
          "  xresloader_path: typeof xresloader_path,",
          "  global_options: typeof global_options,",
          "  selected_items: typeof selected_items,",
          "  selected_nodes: typeof selected_nodes,",
          "  run_seq: typeof run_seq,",
          "  data: typeof data,",
          "  resolve: typeof resolve,",
          "  reject: typeof reject,",
          "  require: typeof require,",
          "  alert_warning: typeof alert_warning,",
          "  alert_error: typeof alert_error,",
          "  log_info: typeof log_info,",
          "  log_notice: typeof log_notice,",
          "  log_warning: typeof log_warning,",
          "  log_error: typeof log_error,",
          "};",
          'report.go_p = global_options["-p"];',
          "report.run_seq_value = run_seq;",
          "log_notice(JSON.stringify(report));",
          'resolve("ok");',
        ].join("\n");
        const invoke = makeInvoke({
          entry_kind: "on_before_convert",
          run_seq: 7,
          source,
          context: {
            work_dir: "/tmp/work",
            configure_file: "/tmp/work/conv.xml",
            xresloader_path: "/tmp/work/xresloader.jar",
            global_options: { "-p": "protobuf" },
            selected_items: [{ name: "item-a" }],
            selected_nodes: [{ key: "1" }],
          },
        });
        client.invoke(invoke);
        const log = await client.logOf(invoke.invocation_id);
        const report = JSON.parse(String(log.message)) as Record<string, unknown>;
        const expectedTypeof: Record<string, string> = {
          work_dir: "string",
          configure_file: "string",
          xresloader_path: "string",
          global_options: "object",
          selected_items: "object",
          selected_nodes: "object",
          run_seq: "number",
          data: "object",
          resolve: "function",
          reject: "function",
          require: "function",
          alert_warning: "function",
          alert_error: "function",
          log_info: "function",
          log_notice: "function",
          log_warning: "function",
          log_error: "function",
        };
        for (const [key, expected] of Object.entries(expectedTypeof)) {
          expect(report[key], `typeof ${key}`).toBe(expected);
        }
        expect(report.go_p).toBe("protobuf");
        expect(report.run_seq_value).toBe(7);
        const result = await client.completeOf(invoke.invocation_id);
        expect(result.outcome).toBe("resolved");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  // Tests d-g deliberately exercise real timer semantics inside the child
  // process (async resolve, vm timeout, wall-clock timeout); the child's clock
  // is the behavior under test, so deterministic fake timers cannot apply.

  it(
    "d. event resolves asynchronously after the sync run returned",
    async () => {
      const client = new WorkerClient();
      try {
        const invoke = makeInvoke({
          source: 'setTimeout(function () { resolve("ok"); }, 30);',
          timeout_ms: 2000,
        });
        client.invoke(invoke);
        const result = await client.completeOf(invoke.invocation_id);
        expect(result.outcome).toBe("resolved");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "e. reject settles as rejected with the reason passed through (first call wins)",
    async () => {
      const client = new WorkerClient();
      try {
        const invoke = makeInvoke({ source: 'reject("first"); reject("second");' });
        client.invoke(invoke);
        const result = await client.completeOf(invoke.invocation_id);
        expect(result.outcome).toBe("rejected");
        expect(result.reason).toBe("first");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "f. vm timeout interrupts a synchronous infinite loop",
    async () => {
      const client = new WorkerClient();
      try {
        const invoke = makeInvoke({ source: "while (true) {}", timeout_ms: 100 });
        client.invoke(invoke);
        const result = await client.completeOf(invoke.invocation_id, FAST_WAIT_MS);
        expect(result.outcome).toBe("rejected");
        expect(result.reason).toBe("Run event callback timeout");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "g. wall-clock timeout fires when resolve never comes",
    async () => {
      const client = new WorkerClient();
      try {
        const invoke = makeInvoke({
          source: 'setTimeout(function () { resolve("late"); }, 60000);',
          timeout_ms: 100,
        });
        client.invoke(invoke);
        const result = await client.completeOf(invoke.invocation_id, FAST_WAIT_MS);
        expect(result.outcome).toBe("rejected");
        expect(result.reason).toBe("Run event callback timeout");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "h. a syntactically broken script reports SCRIPT_COMPILE_ERROR with the filename",
    async () => {
      const client = new WorkerClient();
      try {
        const invoke = makeInvoke({
          filename: "broken-config.xml",
          source: "definitely not (valid javascript {",
        });
        client.invoke(invoke);
        const result = await client.completeOf(invoke.invocation_id);
        expect(result.outcome).toBe("error");
        expect(result.error?.code).toBe("SCRIPT_COMPILE_ERROR");
        expect(result.error?.message).toContain("broken-config.xml");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "i. console is not injected into the sandbox (legacy parity)",
    async () => {
      const client = new WorkerClient();
      try {
        const invoke = makeInvoke({ source: 'console.log("boom"); resolve();' });
        client.invoke(invoke);
        const result = await client.completeOf(invoke.invocation_id);
        expect(result.outcome).toBe("error");
        expect(result.error?.code).toBe("SCRIPT_RUNTIME_ERROR");
        expect(result.error?.message).toContain("CONV EVENT EXCEPTION");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "j. require is anchored at the configure file and loads node builtins",
    async () => {
      const client = new WorkerClient();
      try {
        const invoke = makeInvoke({
          source: 'const p = require("node:path"); log_notice(p.basename("/a/b.txt")); resolve();',
          context: { configure_file: path.join(os.tmpdir(), "xresconv-p203", "conv.xml") },
        });
        client.invoke(invoke);
        const log = await client.logOf(invoke.invocation_id);
        expect(log.message).toBe("b.txt");
        const result = await client.completeOf(invoke.invocation_id);
        expect(result.outcome).toBe("resolved");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "k. button data persists per button_id across invocations",
    async () => {
      const client = new WorkerClient();
      try {
        const globalOptions = [{ name: "a", desc: "d", value: "v" }];
        const first = makeInvoke({
          entry_kind: "button",
          button_id: "btn-a",
          source:
            'log_notice("isArr=" + Array.isArray(global_options) + " n=" + String(data.n));' +
            " data.n = 1; resolve();",
          context: { global_options: globalOptions },
        });
        client.invoke(first);
        const firstLog = await client.logOf(first.invocation_id);
        expect(firstLog.message).toBe("isArr=true n=undefined");
        expect(firstLog.module_name).toBe("CONV SCRIPT:btn-a");
        expect((await client.completeOf(first.invocation_id)).outcome).toBe("resolved");

        const second = makeInvoke({
          entry_kind: "button",
          button_id: "btn-a",
          source: 'log_notice("n=" + String(data.n)); resolve(data.n === 1 ? "ok" : "bad");',
          context: {},
        });
        client.invoke(second);
        expect((await client.logOf(second.invocation_id)).message).toBe("n=1");
        expect((await client.completeOf(second.invocation_id)).outcome).toBe("resolved");

        const otherButton = makeInvoke({
          entry_kind: "button",
          button_id: "btn-b",
          source: 'log_notice("n=" + String(data.n)); resolve();',
          context: {},
        });
        client.invoke(otherButton);
        expect((await client.logOf(otherButton.invocation_id)).message).toBe("n=undefined");
        expect((await client.completeOf(otherButton.invocation_id)).outcome).toBe("resolved");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

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

  it(
    "l. alert_warning fires yes->on_close on choice yes, nothing on choice null",
    async () => {
      const client = new WorkerClient();
      try {
        const yesInvoke = makeInvoke({ source: ALERT_ORDER_SOURCE, timeout_ms: 2000 });
        client.invoke(yesInvoke);
        const request = await client.waitFor(
          (env) => env.kind === "dialog_request" && env.invocation_id === yesInvoke.invocation_id,
          "dialog_request (yes case)",
        );
        expect(request.payload).toMatchObject({
          title: "标题",
          content: "内容",
          buttons: ["yes", "no"],
        });
        const token = String(request.payload.token);
        expect(token.length).toBeGreaterThan(0);
        client.send("dialog_respond", { token, choice: "yes" });
        expect((await client.logOf(yesInvoke.invocation_id)).message).toBe("order=yes,close");
        expect((await client.completeOf(yesInvoke.invocation_id)).outcome).toBe("resolved");

        // ESC/backdrop semantics: choice null (delivered via in_reply_to) fires nothing,
        // so the invocation hangs until the legacy wall-clock timeout.
        const escInvoke = makeInvoke({ source: ALERT_ORDER_SOURCE, timeout_ms: 300 });
        client.invoke(escInvoke);
        const escRequest = await client.waitFor(
          (env) => env.kind === "dialog_request" && env.invocation_id === escInvoke.invocation_id,
          "dialog_request (esc case)",
        );
        client.send(
          "dialog_respond",
          { choice: null },
          { in_reply_to: String(escRequest.payload.token) },
        );
        const escResult = await client.completeOf(escInvoke.invocation_id, FAST_WAIT_MS);
        expect(escResult.outcome).toBe("rejected");
        expect(escResult.reason).toBe("Run event callback timeout");
        const strayLog = client
          .drainBuffered()
          .find(
            (env) => env.kind === "log" && env.payload.invocation_id === escInvoke.invocation_id,
          );
        expect(strayLog).toBeUndefined();
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "m. a button invocation completes while an event invocation waits on a dialog",
    async () => {
      const client = new WorkerClient();
      try {
        const eventInvoke = makeInvoke({
          entry_kind: "on_before_convert",
          source: 'alert_warning("hold", "t", { on_close: function () { resolve(); } });',
          timeout_ms: 4000,
        });
        client.invoke(eventInvoke);
        const request = await client.waitFor(
          (env) => env.kind === "dialog_request" && env.invocation_id === eventInvoke.invocation_id,
          "dialog_request (concurrency)",
        );

        const buttonInvoke = makeInvoke({
          entry_kind: "button",
          button_id: "conc-btn",
          source: 'resolve("btn");',
          timeout_ms: 1000,
        });
        client.invoke(buttonInvoke);
        const buttonResult = await client.completeOf(buttonInvoke.invocation_id);
        expect(buttonResult.outcome).toBe("resolved");

        client.send("dialog_respond", { token: request.payload.token, choice: "yes" });
        const eventResult = await client.completeOf(eventInvoke.invocation_id);
        expect(eventResult.outcome).toBe("resolved");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "n. on_append_log rewrites the log object and reports set_log_fields ops",
    async () => {
      const client = new WorkerClient();
      try {
        const invoke = makeInvoke({
          entry_kind: "on_append_log",
          source: 'data.message = "changed"; data.style = "alert-warning";',
          context: {
            work_dir: "/tmp/work",
            configure_file: "/tmp/work/conv.xml",
            xresloader_path: "/tmp/work/xresloader.jar",
            global_options: { "-p": "protobuf" },
            selected_items: [],
            run_seq: 3,
            log_object: { message: "orig", module_name: "M", style: "alert-secondary" },
          },
        });
        client.invoke(invoke);
        const result = await client.completeOf(invoke.invocation_id);
        expect(result.outcome).toBe("resolved");
        expect(result.ops).toHaveLength(1);
        expect(result.ops?.[0]).toMatchObject({
          op: "set_log_fields",
          fields: { message: "changed", style: "alert-warning" },
        });
        expect(
          Object.keys((result.ops?.[0]?.fields ?? {}) as Record<string, unknown>),
        ).not.toContain("module_name");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "o. shutdown waits for the in-flight invocation, then exits 0",
    async () => {
      const client = new WorkerClient();
      try {
        const invoke = makeInvoke({
          source: 'alert_warning("hold", "t", { on_close: function () { resolve(); } });',
          timeout_ms: 5000,
        });
        client.invoke(invoke);
        const request = await client.waitFor(
          (env) => env.kind === "dialog_request" && env.invocation_id === invoke.invocation_id,
          "dialog_request (shutdown)",
        );
        client.send("shutdown", {});
        client.send("dialog_respond", { token: request.payload.token, choice: "yes" });
        const result = await client.completeOf(invoke.invocation_id);
        expect(result.outcome).toBe("resolved");
        const exit = await raceTimeout(client.exited, WAIT_MS);
        expect(exit, "worker did not exit after shutdown").not.toBeNull();
        expect(exit?.code).toBe(0);
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "p. malformed envelopes answer fault without killing the worker",
    async () => {
      const client = new WorkerClient();
      try {
        client.sendValue({ bogus: true });
        const invalidFault = await client.ofKind("fault");
        expect(String(invalidFault.payload.message)).toContain("invalid envelope");

        client.send("event", { note: "worker does not consume this kind" });
        const kindFault = await client.ofKind("fault");
        expect(String(kindFault.payload.message)).toContain("unsupported inbound kind");

        const invoke = makeInvoke({
          entry_kind: "set_name",
          source: 'item_data.name = "still-alive";',
          context: { item_data: { name: "before" } },
        });
        client.invoke(invoke);
        const result = await client.completeOf(invoke.invocation_id);
        expect(result.outcome).toBe("resolved");
        expect(result.ops?.[0]).toMatchObject({
          op: "set_fields",
          fields: { name: "still-alive" },
        });
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "q. dialog callbacks survive invocation settle (合法回调不提前销毁，SC06)",
    async () => {
      const client = new WorkerClient();
      try {
        const invoke = makeInvoke({
          source: [
            'alert_warning("内容", "标题", {',
            '  yes: function () { log_notice("LATE-YES"); },',
            '  on_close: function () { log_notice("LATE-CLOSE"); },',
            "});",
            "resolve();", // invocation 先结束；旧版 modal 晚于脚本结束仍可点
          ].join("\n"),
          timeout_ms: 1000,
        });
        client.invoke(invoke);
        const request = await client.waitFor(
          (env) => env.kind === "dialog_request" && env.invocation_id === invoke.invocation_id,
          "dialog_request (late answer)",
        );
        // 先等到 invocation 完成，再应答：回调仍必须按序触发。
        expect((await client.completeOf(invoke.invocation_id)).outcome).toBe("resolved");
        client.send("dialog_respond", { token: request.payload.token, choice: "yes" });
        const lateYes = await client.waitFor(
          (env) => env.kind === "log" && env.payload.message === "LATE-YES",
          "LATE-YES log",
        );
        const lateClose = await client.waitFor(
          (env) => env.kind === "log" && env.payload.message === "LATE-CLOSE",
          "LATE-CLOSE log",
        );
        expect(lateYes.payload.invocation_id).toBe(invoke.invocation_id);
        expect(lateClose.payload.invocation_id).toBe(invoke.invocation_id);
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "r. duplicate dialog answers fire callbacks exactly once (重复点击，SC06)",
    async () => {
      const client = new WorkerClient();
      try {
        const invoke = makeInvoke({ source: ALERT_ORDER_SOURCE, timeout_ms: 2000 });
        client.invoke(invoke);
        const request = await client.waitFor(
          (env) => env.kind === "dialog_request" && env.invocation_id === invoke.invocation_id,
          "dialog_request (double answer)",
        );
        const token = String(request.payload.token);
        client.send("dialog_respond", { token, choice: "yes" });
        expect((await client.logOf(invoke.invocation_id)).message).toBe("order=yes,close");
        expect((await client.completeOf(invoke.invocation_id)).outcome).toBe("resolved");

        // 第二次应答（重复点击/重放）：无回调、worker 记 stale 诊断、进程不受影响。
        client.send("dialog_respond", { token, choice: "yes" });
        const probe = makeInvoke({ source: "resolve();", timeout_ms: 1000 });
        client.invoke(probe);
        expect((await client.completeOf(probe.invocation_id)).outcome).toBe("resolved");
        expect(client.stderrText).toContain("unknown/stale token");
        const orderLogs = client
          .drainBuffered()
          .filter((env) => env.kind === "log" && String(env.payload.message).startsWith("order="));
        expect(orderLogs).toHaveLength(0); // 首条已被 logOf 消费；无第二次触发
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "s. require.cache is process-shared across invocations (P2-04 cache 契约：按钮与 hook 共用模块态)",
    async () => {
      // 旧版单渲染进程内 require.cache 全局共享（02 §103 兼容风险）；新版默认
      // size=1 单 worker（BD-W5），createRequire 的 cache 即进程级 Module._cache，
      // 跨 invocation/入口类型共享同一模块实例——本用例固化该契约。
      const dir = mkdtempSync(path.join(os.tmpdir(), "xresconv-cache-"));
      const modulePath = path.join(dir, "shared-state.cjs");
      writeFileSync(modulePath, "module.exports = { hits: 0 };\n", "utf8");
      try {
        const client = new WorkerClient();
        try {
          const first = makeInvoke({
            entry_kind: "button",
            button_id: "cache-writer",
            source: `var m = require(${JSON.stringify(modulePath)}); m.hits += 1; log_notice("w=" + m.hits); resolve();`,
          });
          client.invoke(first);
          expect((await client.logOf(first.invocation_id)).message).toBe("w=1");
          expect((await client.completeOf(first.invocation_id)).outcome).toBe("resolved");

          // 不同入口类型（事件 hook）读到同一缓存实例：hits 已为 1。
          const second = makeInvoke({
            entry_kind: "on_before_convert",
            source: `var m = require(${JSON.stringify(modulePath)}); log_notice("r=" + m.hits); resolve();`,
          });
          client.invoke(second);
          expect((await client.logOf(second.invocation_id)).message).toBe("r=1");
          expect((await client.completeOf(second.invocation_id)).outcome).toBe("resolved");
        } finally {
          await client.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
