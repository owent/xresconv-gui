/**
 * P2-11 真实脚本差分：xresconv-conf sample.xml 的 5 个真实 GUI 脚本
 * （dab714ae 固定提交，tests/fixtures/scripts/legacy-samples/xresconv-conf/）
 * 逐条跑真实 worker 子进程，对照 P0-08 旧实现行为合同与 contract.md。
 * 无协议 mock；所有等待显式有界；差异记录为 BD-S 条目（本文件即证据）。
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Envelope, ScriptInvoke, ScriptResult } from "@xresconv/contracts";
import { describe, expect, it } from "vitest";
import type { WorkerDiag } from "../src/script-worker.ts";
import { ScriptWorkerPool } from "../src/script-worker.ts";

const SAMPLE_DIR = fileURLToPath(
  new URL("../../../tests/fixtures/scripts/legacy-samples/xresconv-conf/", import.meta.url),
);
const TEST_TIMEOUT_MS = 30_000;
const WAIT_MS = 20_000;

function sample(name: string): string {
  return readFileSync(path.join(SAMPLE_DIR, name), "utf8");
}

function makeInvoke(overrides: Partial<ScriptInvoke>): ScriptInvoke {
  return {
    invocation_id: randomUUID(),
    entry_kind: "on_before_convert",
    filename: "sample.xml#script",
    source: "resolve();",
    timeout_ms: 5000,
    context: {},
    ...overrides,
  };
}

type LogEvent = Envelope | WorkerDiag;

/** 收集日志/弹框事件，等待有界。 */
class EventCollector {
  readonly events: LogEvent[] = [];
  private readonly waiters: {
    pred: (event: LogEvent) => boolean;
    resolve: (event: LogEvent) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }[] = [];

  readonly handler = (event: LogEvent): void => {
    // 观察语义：所有事件都进缓冲（不消费），等待只是唤醒。
    this.events.push(event);
    const index = this.waiters.findIndex((waiter) => waiter.pred(event));
    if (index >= 0) {
      const waiter = this.waiters[index];
      this.waiters.splice(index, 1);
      if (waiter !== undefined) {
        clearTimeout(waiter.timer);
        waiter.resolve(event);
      }
    }
  };

  waitFor(
    pred: (event: LogEvent) => boolean,
    label: string,
    timeoutMs = WAIT_MS,
  ): Promise<LogEvent> {
    const buffered = this.events.find(pred);
    if (buffered !== undefined) {
      return Promise.resolve(buffered);
    }
    const { promise, resolve, reject } = Promise.withResolvers<LogEvent>();
    const timer = setTimeout(() => {
      const index = this.waiters.findIndex((waiter) => waiter.resolve === resolve);
      if (index >= 0) {
        this.waiters.splice(index, 1);
      }
      reject(new Error(`timeout (${timeoutMs}ms) waiting for ${label}`));
    }, timeoutMs);
    this.waiters.push({ pred, resolve, reject, timer });
    return promise;
  }

  logMessagesOf(invocationId: string): { level: string; message: string }[] {
    return this.events
      .filter(
        (event): event is Envelope =>
          "kind" in event && event.kind === "log" && event.payload.invocation_id === invocationId,
      )
      .map((event) => ({
        level: String(event.payload.level),
        message: String(event.payload.message),
      }));
  }
}

function setFieldsOf(result: ScriptResult): Record<string, unknown> {
  const op = result.ops?.find((entry) => entry.op === "set_fields");
  return op?.op === "set_fields" ? (op.fields as Record<string, unknown>) : {};
}

describe("真实脚本差分（P2-11，xresconv-conf sample.xml）", () => {
  it(
    "set_name 原文：文件名提取并回填显示名（P0-08 §1 活引用赋值语义）",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      try {
        await pool.start();
        const invoke = makeInvoke({
          entry_kind: "set_name",
          filename: "sample.xml#set_name",
          source: sample("set_name.js"),
          context: {
            work_dir: os.tmpdir(),
            configure_file: path.join(os.tmpdir(), "sample.xml"),
            item_data: {
              id: 1,
              file: "资源转换示例.xlsx",
              scheme: "scheme_kind",
              name: "人物表",
            },
          },
        });
        const result = await pool.invoke(invoke);
        expect(result.outcome).toBe("resolved");
        expect(setFieldsOf(result).name).toBe("人物表 (资源转换示例)");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "set_name 原文负面对照：无扩展名文件 match=null → TypeError 按错误日志收尾、名称不变（main.js:1746 catch 等价）",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      try {
        await pool.start();
        const invoke = makeInvoke({
          entry_kind: "set_name",
          filename: "sample.xml#set_name",
          source: sample("set_name.js"),
          context: {
            work_dir: os.tmpdir(),
            configure_file: path.join(os.tmpdir(), "sample.xml"),
            item_data: { id: 2, file: "无扩展名", scheme: "s", name: "保持原名" },
          },
        });
        const result = await pool.invoke(invoke);
        // 旧版：异常被 catch 记错误日志，item_data 仍提交且 name 未被改写
        // （match 返回 null 先于赋值抛 TypeError）。新版：outcome=error 且
        // 无 name 变更 op——对外可观察语义一致。
        expect(result.outcome).toBe("error");
        expect(result.error?.code).toBe("SCRIPT_RUNTIME_ERROR");
        expect(setFieldsOf(result).name).toBeUndefined();
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "on_before_convert 原文：裸名 require(os/child_process) spawn 子进程并回显 work_dir",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      const collector = new EventCollector();
      pool.onLog = collector.handler;
      try {
        await pool.start();
        const workDir = os.tmpdir();
        const invoke = makeInvoke({
          entry_kind: "on_before_convert",
          filename: "sample.xml#on_before_convert",
          source: sample("on_before_convert.js"),
          timeout_ms: 15_000,
          context: {
            work_dir: workDir,
            configure_file: path.join(os.tmpdir(), "sample.xml"),
          },
        });
        const resultPromise = pool.invoke(invoke);
        if (os.type().toLowerCase().startsWith("windows")) {
          // win32 分支：cmd /c echo <work_dir> 的 stdout 经 log_info 回流。
          await collector.waitFor(
            (event) =>
              "kind" in event &&
              event.kind === "log" &&
              event.payload.invocation_id === invoke.invocation_id &&
              String(event.payload.message).includes(workDir),
            "echo work_dir log",
          );
        }
        expect((await resultPromise).outcome).toBe("resolved");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "on_after_convert 原文：alert_warning 弹框应答后 resolve（SC06 真实样例）",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      const dialogs: { title: string; content: string; buttons: string[] }[] = [];
      pool.onDialogRequest = (env, respond) => {
        dialogs.push({
          title: String(env.payload.title),
          content: String(env.payload.content),
          buttons: (env.payload.buttons as string[]).map(String),
        });
        respond("yes");
      };
      try {
        await pool.start();
        const invoke = makeInvoke({
          entry_kind: "on_after_convert",
          filename: "sample.xml#on_after_convert",
          source: sample("on_after_convert.js"),
          timeout_ms: 60_000,
          context: {
            work_dir: os.tmpdir(),
            configure_file: path.join(os.tmpdir(), "sample.xml"),
          },
        });
        const result = await pool.invoke(invoke);
        expect(result.outcome).toBe("resolved");
        expect(dialogs).toHaveLength(1);
        expect(dialogs[0]?.content).toBe("自定义转表完成后事件，可以执行任意nodejs脚本");
        expect(dialogs[0]?.buttons).toEqual(["yes", "no"]);
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "button delaycall 原文：定时器计数 5→1 后结束；运行期间重入按 data.running 拒绝",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      const collector = new EventCollector();
      pool.onLog = collector.handler;
      try {
        await pool.start();
        const first = makeInvoke({
          entry_kind: "button",
          button_id: "delaycall",
          filename: "sample.xml#script:delaycall",
          source: sample("button_delaycall.js"),
          timeout_ms: 20_000,
          context: {
            work_dir: os.tmpdir(),
            configure_file: path.join(os.tmpdir(), "sample.xml"),
          },
        });
        const firstResult = pool.invoke(first);
        // 等首个计数日志确认 running=true 已生效，再发重入调用。
        await collector.waitFor(
          (event) =>
            "kind" in event &&
            event.kind === "log" &&
            event.payload.invocation_id === first.invocation_id &&
            String(event.payload.message).includes("定时器计数: 5"),
          "first tick log",
        );
        const reentry = makeInvoke({
          entry_kind: "button",
          button_id: "delaycall",
          filename: "sample.xml#script:delaycall",
          source: sample("button_delaycall.js"),
          timeout_ms: 5_000,
          context: {
            work_dir: os.tmpdir(),
            configure_file: path.join(os.tmpdir(), "sample.xml"),
          },
        });
        const reentryResult = await pool.invoke(reentry);
        expect(reentryResult.outcome).toBe("rejected");
        expect(reentryResult.reason).toBe("上一次未完成");

        expect((await firstResult).outcome).toBe("resolved");
        const notices = collector
          .logMessagesOf(first.invocation_id)
          .filter((entry) => entry.level === "notice")
          .map((entry) => entry.message);
        for (const expected of [
          "定时器计数: 5",
          "定时器计数: 4",
          "定时器计数: 3",
          "定时器计数: 2",
          "定时器计数: 1",
          "定时器结束",
        ]) {
          expect(notices).toContain(expected);
        }
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "button 自定义脚本 原文：data.call_times 跨调用累加 + 弹框应答 + 双级别日志",
    async () => {
      const pool = new ScriptWorkerPool({ size: 1 });
      const collector = new EventCollector();
      pool.onLog = collector.handler;
      pool.onDialogRequest = (_env, respond) => {
        respond("yes");
      };
      try {
        await pool.start();
        const run = async (): Promise<ScriptResult> => {
          const invoke = makeInvoke({
            entry_kind: "button",
            button_id: "自定义脚本",
            filename: "sample.xml#script:自定义脚本",
            source: sample("button_custom_script.js"),
            timeout_ms: 5_000,
            context: {
              work_dir: os.tmpdir(),
              configure_file: path.join(os.tmpdir(), "sample.xml"),
            },
          });
          return pool.invoke(invoke);
        };
        const first = await run();
        expect(first.outcome).toBe("resolved");
        const second = await run();
        expect(second.outcome).toBe("resolved");

        const messages = [
          ...collector.logMessagesOf(first.invocation_id),
          ...collector.logMessagesOf(second.invocation_id),
        ];
        expect(
          messages.some(
            (entry) => entry.level === "notice" && entry.message.includes("notice日志(1)"),
          ),
        ).toBe(true);
        expect(
          messages.some(
            (entry) => entry.level === "notice" && entry.message.includes("notice日志(2)"),
          ),
        ).toBe(true);
        expect(
          messages.some(
            (entry) => entry.level === "warning" && entry.message.includes("warning日志"),
          ),
        ).toBe(true);
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "BD-S18 README 已知问题场景：spawn 回调内未捕获异常不再白屏，有界超时结算且补员可用",
    async () => {
      // 旧版（README"已知问题"）：require("child_process").spawn 回调里抛异常
      // → 渲染进程未捕获异常 → GUI 白屏。新架构合同：worker 记诊断存活，
      // 该 invocation 因有界超时按 WORKER_TIMEOUT 结算，worker 销毁补员，
      // 后续调用不受影响。
      const pool = new ScriptWorkerPool({ size: 1 });
      const collector = new EventCollector();
      pool.onLog = collector.handler;
      try {
        await pool.start();
        const invoke = makeInvoke({
          entry_kind: "on_before_convert",
          filename: "README-known-issue#spawn-callback-throw",
          source: [
            'var spawn = require("child_process").spawn;',
            'var p = spawn(require("node:process").execPath, ["-e", ""]);',
            'p.on("exit", function () { throw new Error("回调内未捕获异常样本"); });',
          ].join("\n"),
          timeout_ms: 1_000,
          context: {
            work_dir: os.tmpdir(),
            configure_file: path.join(os.tmpdir(), "sample.xml"),
          },
        });
        const result = await pool.invoke(invoke);
        expect(result.outcome).toBe("rejected");

        // 异常诊断到达 guardian（worker-stderr 通道），进程未被异常打死。
        await collector.waitFor(
          (event) =>
            !("kind" in event) &&
            event.source === "worker-stderr" &&
            event.line.includes("回调内未捕获异常样本"),
          "uncaughtException diag",
        );

        // 补员后后续调用正常（白屏等价物不存在）。
        const after = makeInvoke({ source: "resolve();" });
        expect((await pool.invoke(after)).outcome).toBe("resolved");
      } finally {
        await pool.shutdown();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
