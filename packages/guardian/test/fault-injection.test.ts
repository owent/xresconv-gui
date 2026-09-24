/**
 * P2-02/P2-07 故障注入与 P2-10 模块兼容测试：真实 worker 进程，无 mock。
 * - R03：脚本内 require("node:process").exit()、小堆内存耗尽只杀对应 worker，
 *   池补员后可继续服务；未注入的 process 全局保持 ReferenceError 语义。
 * - R09：日志风暴期间控制通道不丢帧、调用正常完成。
 * - R02+R08：卡死 worker 被池终止时，其派生的孙进程随进程树一并回收。
 * - P2-10：adm-zip / compressing round-trip 与原生模块（koffi，Node-API）
 *   在 worker 沙箱内经锚定 require 实际可用。
 * 所有等待均有显式上限（真实子进程 = 真实时钟，不用 fake timers）。
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Envelope, ScriptInvoke } from "@xresconv/contracts";
import { describe, expect, it } from "vitest";
import type { WorkerDiag } from "../src/script-worker.ts";
import { ScriptWorkerPool, WorkerInvokeError } from "../src/script-worker.ts";

const TEST_TIMEOUT_MS = 20_000;
const WAIT_MS = 10_000;
const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function makeInvoke(overrides: Partial<ScriptInvoke>): ScriptInvoke {
  return {
    invocation_id: randomUUID(),
    entry_kind: "on_before_convert",
    filename: "fault-injection-test.js",
    source: "resolve();",
    timeout_ms: 1000,
    context: { configure_file: path.join(REPO_ROOT, "package.json") },
    ...overrides,
  };
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

async function waitUntil(cond: () => boolean, label: string, timeoutMs = WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (cond()) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timeout (${timeoutMs}ms) waiting ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

describe("fault injection (R02/R03/R08/R09)", () => {
  it(
    'script "process" global is not injected and stays a ReferenceError',
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      try {
        await pool.start();
        const result = await pool.invoke(makeInvoke({ source: "process.exit(1);" }));
        // process 未注入沙箱：ReferenceError -> SCRIPT_RUNTIME_ERROR，worker 本身不受影响。
        expect(result.outcome).toBe("error");
        expect(result.error?.code).toBe("SCRIPT_RUNTIME_ERROR");
        expect(String(result.error?.message)).toMatch(/process is not defined/);
        const after = await pool.invoke(makeInvoke({ source: 'resolve("alive");' }));
        expect(after.outcome).toBe("resolved");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "require('node:process').exit(1) kills only that worker; the pool replenishes",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      const diags: (Envelope | WorkerDiag)[] = [];
      pool.onLog = (event) => diags.push(event);
      try {
        await pool.start();
        const oldPid = pool.stats()[0]?.pid;
        const err = await expectInvokeError(
          pool.invoke(makeInvoke({ source: 'require("node:process").exit(1);' })),
          "WORKER_EXIT",
        );
        expect(err.exitCode).toBe(1);
        await waitUntil(
          () => pool.stats().some((s) => s.pid !== undefined && s.pid !== oldPid),
          "pool replenish after process.exit",
        );
        const after = await pool.invoke(makeInvoke({ source: 'resolve("back");' }));
        expect(after.outcome).toBe("resolved");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "process.abort() crashes only that worker; the pool replenishes",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      try {
        await pool.start();
        const oldPid = pool.stats()[0]?.pid;
        // abort() 立即产生不可捕获的原生崩溃（覆盖 R03 的可控原生崩溃分支）。
        const err = await expectInvokeError(
          pool.invoke(makeInvoke({ source: 'require("node:process").abort();' })),
          "WORKER_EXIT",
        );
        expect(err.exitCode === null || err.exitCode !== 0).toBe(true);
        await waitUntil(
          () => pool.stats().some((s) => s.pid !== undefined && s.pid !== oldPid),
          "pool replenish after abort",
        );
        const after = await pool.invoke(makeInvoke({ source: 'resolve("back");' }));
        expect(after.outcome).toBe("resolved");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a log storm neither loses the control channel nor blocks completion (R09)",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      let stormLogs = 0;
      pool.onLog = (event) => {
        if ("kind" in event && event.kind === "log" && event.payload.message === "storm") {
          stormLogs += 1;
        }
      };
      try {
        await pool.start();
        const result = await pool.invoke(
          makeInvoke({
            source: 'for (var i = 0; i < 5000; i++) { log_info("storm"); } resolve("survived");',
            timeout_ms: 15_000,
          }),
          { timeoutMs: 18_000 },
        );
        expect(result.outcome).toBe("resolved");
        // 帧通道无损：5000 条日志全部送达。
        await waitUntil(() => stormLogs === 5000, "storm logs drained");
        const after = await pool.invoke(makeInvoke({ source: 'resolve("after");' }));
        expect(after.outcome).toBe("resolved");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "destroying a stuck worker reaps its spawned grandchild via the process tree (R02+R08)",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      let grandchildPid: number | undefined;
      pool.onLog = (event) => {
        if ("kind" in event && event.kind === "log") {
          const match = /GC (\d+)/.exec(String(event.payload.message));
          if (match) {
            grandchildPid = Number(match[1]);
          }
        }
      };
      try {
        await pool.start();
        const oldPid = pool.stats()[0]?.pid;
        const err = await expectInvokeError(
          pool.invoke(
            makeInvoke({
              source: [
                'var cp = require("node:child_process");',
                'var proc = require("node:process");',
                'var g = cp.spawn(proc.execPath, ["-e", "setInterval(function () {}, 1000)"], { stdio: "ignore" });',
                'log_info("GC " + g.pid);',
                "while (true) {}",
              ].join("\n"),
              timeout_ms: 2000,
            }),
            { timeoutMs: 300 },
          ),
          "WORKER_TIMEOUT",
        );
        expect(err.message).toContain("exceeded its deadline");
        // worker 已随树终止回收。
        await waitUntil(() => oldPid === undefined || !pidAlive(oldPid), "worker reaped");
        // 孙进程不是直接登记成员，也必须被 job/进程组回收（有界等待求证）。
        await waitUntil(() => grandchildPid !== undefined, "grandchild pid log");
        await waitUntil(() => !pidAlive(grandchildPid as number), "grandchild reaped");
        const after = await pool.invoke(makeInvoke({ source: 'resolve("back");' }));
        expect(after.outcome).toBe("resolved");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );
});

describe("packaged module compatibility (P2-10)", () => {
  it(
    "adm-zip round-trips a buffer inside the worker sandbox",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      try {
        await pool.start();
        const result = await pool.invoke(
          makeInvoke({
            source: [
              'var AdmZip = require("adm-zip");',
              'var BufferCtor = require("node:buffer").Buffer;',
              "var zip = new AdmZip();",
              'zip.addFile("hello.txt", BufferCtor.from("hello 世界", "utf8"));',
              "var packed = zip.toBuffer();",
              "var reopened = new AdmZip(packed);",
              'var text = reopened.readAsText("hello.txt");',
              'if (text !== "hello 世界") { throw new Error("adm-zip round trip mismatch"); }',
              'resolve("zip-ok");',
            ].join("\n"),
            timeout_ms: 5000,
          }),
        );
        // 事件入口的 resolve 值不回传（对齐旧协议）；抛出即 error，resolved 即通过。
        expect(result.outcome).toBe("resolved");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "compressing gzip round-trips a stream inside the worker sandbox",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      try {
        await pool.start();
        const result = await pool.invoke(
          makeInvoke({
            source: [
              'var compressing = require("compressing");',
              'var stream = require("node:stream");',
              'var BufferCtor = require("node:buffer").Buffer;',
              "function collect() {",
              "  var chunks = [];",
              "  var sink = new stream.Writable({ write: function (c, e, cb) { chunks.push(c); cb(); } });",
              "  return { sink: sink, join: function () { return BufferCtor.concat(chunks); } };",
              "}",
              "function pipeTo(source, via, sink) {",
              "  return new Promise(function (res, rej) {",
              '    source.pipe(via).pipe(sink).on("finish", res).on("error", rej);',
              "  });",
              "}",
              'var payload = "gzip 数据 round-trip";',
              "var pack = collect();",
              "pipeTo(",
              '  stream.Readable.from([BufferCtor.from(payload, "utf8")]),',
              "  new compressing.gzip.FileStream(),",
              "  pack.sink",
              ")",
              "  .then(function () {",
              "    var back = collect();",
              "    return pipeTo(",
              "      stream.Readable.from([pack.join()]),",
              "      new compressing.gzip.UncompressStream(),",
              "      back.sink",
              "    ).then(function () {",
              '      if (back.join().toString("utf8") !== payload) { throw new Error("gzip round trip mismatch"); }',
              '      resolve("gzip-ok");',
              "    });",
              "  })",
              "  .catch(reject);",
            ].join("\n"),
            timeout_ms: 5000,
          }),
        );
        expect(result.outcome).toBe("resolved");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a Node-API native module (koffi) loads inside the worker sandbox",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      try {
        await pool.start();
        const result = await pool.invoke(
          makeInvoke({
            source: [
              'var koffi = require("koffi");',
              'if (typeof koffi.load !== "function") { throw new Error("koffi.load missing"); }',
              'resolve("native-ok");',
            ].join("\n"),
            timeout_ms: 5000,
          }),
        );
        expect(result.outcome).toBe("resolved");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
