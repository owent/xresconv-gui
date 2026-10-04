/**
 * runConversion 编排测试（P3-08）。
 *
 * 真实 ScriptWorkerPool（worker 真进程）+ 注入 fake Java runner（不 spawn java）。
 * 语义锚点：main.js:2301-2448（事件链/收尾文案）、main.js:2118-2189（并发与退出码）。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JavaBatchOptions, JavaBatchResult, ScriptWorkerPool } from "@xresconv/guardian";
import { AbortError } from "@xresconv/guardian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ParsedConfig } from "../../src/config/model.ts";
import type { RunState } from "../../src/domain/run-state.ts";
import { flattenTreeItems } from "../../src/domain/selection.ts";
import { ConversionSession } from "../../src/service/session.ts";
import { fixture, startPool, TEST_TIMEOUT_MS, waitUntil } from "./helpers.ts";

function okRunner(calls: JavaBatchOptions[]) {
  return async (options: JavaBatchOptions): Promise<JavaBatchResult> => {
    calls.push(options);
    return { exitCode: 0, signal: null, failedTaskCount: 0, durationMs: 1 };
  };
}

function selectAll(config: ParsedConfig) {
  return { items: flattenTreeItems(config.tree) };
}

function collectStates(session: ConversionSession): RunState[] {
  const states: RunState[] = [];
  session.onStateChange = (state) => states.push(state);
  return states;
}

describe("runConversion", () => {
  let pool: ScriptWorkerPool;

  beforeAll(async () => {
    pool = await startPool();
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await pool.shutdown();
  }, TEST_TIMEOUT_MS);

  it("全链：before→java→after 顺序、状态序列、成功收尾文案", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const calls: JavaBatchOptions[] = [];
    const session = new ConversionSession({ pool, runner: okRunner(calls) });
    const states = collectStates(session);
    const config = await session.loadConfig(fixture("run-hooks.xml"));

    const summary = await session.runConversion(selectAll(config));
    await session.pipeline.drain();

    expect(summary.state).toBe("succeeded");
    expect(summary.failedCount).toBe(0);
    expect(summary.taskCount).toBe(1);
    expect(summary.runSeq).toBe(1);
    expect(calls.length).toBe(1);
    expect(calls[0]?.tasks.length).toBe(1);
    expect(states).toEqual([
      "loading",
      "ready",
      "before_hooks",
      "converting",
      "after_hooks",
      "succeeded",
    ]);

    // 日志次序：BEFORE（hook log_info，main.js:2301+）→ 派发日志 [CONV 1]（main.js:2093-2097）
    // → AFTER → "All jobs done."（main.js:2438-2446）。
    const snapshot = session.pipeline.snapshot();
    const indexOf = (pred: (message: string, moduleName: string) => boolean) =>
      snapshot.findIndex((entry) => pred(entry.message, entry.moduleName));
    const beforeIdx = indexOf((m, mod) => m === "BEFORE" && mod === "CONV EVENT");
    const dispatchIdx = indexOf((_m, mod) => mod === "[CONV 1]");
    const afterIdx = indexOf((m, mod) => m === "AFTER" && mod === "CONV EVENT");
    const doneIdx = indexOf((m) => m === "All jobs done.");
    expect(beforeIdx).toBeGreaterThanOrEqual(0);
    expect(dispatchIdx).toBeGreaterThan(beforeIdx);
    expect(afterIdx).toBeGreaterThan(dispatchIdx);
    expect(doneIdx).toBeGreaterThan(afterIdx);

    // 运行结束后重跑：loading→ready 重新武装（BD-O14）。
    const rerun = await session.runConversion(selectAll(config));
    expect(rerun.state).toBe("succeeded");
    expect(rerun.runSeq).toBe(2);
  });

  it("before reject → java/after 全跳过、failed_count=1、失败收尾文案（main.js:2396-2418）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const calls: JavaBatchOptions[] = [];
    const session = new ConversionSession({ pool, runner: okRunner(calls) });
    const states = collectStates(session);
    const config = await session.loadConfig(fixture("run-reject.xml"));

    const summary = await session.runConversion(selectAll(config));
    await session.pipeline.drain();

    expect(summary.state).toBe("failed");
    expect(summary.failedCount).toBe(1);
    expect(calls.length).toBe(0); // run_all 被跳过
    expect(states).toEqual(["loading", "ready", "before_hooks", "failed"]);

    const messages = session.pipeline.snapshot().map((entry) => entry.message);
    // 末尾 catch 记 "CONV" error（main.js:2416-2418）。
    expect(messages.some((m) => m.includes("stop-now"))).toBe(true);
    expect(messages.some((m) => m.includes("AFTER"))).toBe(false); // after 链跳过
    expect(messages).toContain("All jobs done, 1 job(s) failed.");
  });

  it.each(["missing", "file"] as const)(
    "work_dir 为 %s 时派发前失败并指出路径问题，不 spawn java",
    {
      timeout: TEST_TIMEOUT_MS,
    },
    async (kind) => {
      // 场景:绝对 JAR 通过既有存在性检查（XRESLOADER_NOT_FOUND 不触发）,
      // 但 workDir 缺失会让 java spawn 报误导性 ENOENT（指向 java 而非 cwd）。
      // 运行时构造 tmp 配置,xresloader_path 指向一个存在的绝对路径文件（本配置自身）。
      const build = fileURLToPath(new URL("../../../../build/", import.meta.url));
      mkdirSync(build, { recursive: true });
      const dir = mkdtempSync(path.join(build, "run-workdir-"));
      try {
        const configPath = path.join(dir, "conv.xml");
        const workDir =
          kind === "file" ? configPath : path.join(dir, "definitely-missing-workdir-xyz");
        writeFileSync(
          configPath,
          `<?xml version="1.0" encoding="UTF-8"?>
<root>
  <global>
    <work_dir>${workDir.replaceAll("\\", "/")}</work_dir>
    <xresloader_path>${configPath.replaceAll("\\", "/")}</xresloader_path>
  </global>
  <list>
    <item name="one"><option>-c one</option></item>
  </list>
</root>
`,
          "utf8",
        );
        const calls: JavaBatchOptions[] = [];
        const session = new ConversionSession({ pool, runner: okRunner(calls) });
        const config = await session.loadConfig(configPath);

        const summary = await session.runConversion(selectAll(config));
        await session.pipeline.drain();

        expect(summary.state).toBe("failed");
        expect(summary.failedCount).toBe(summary.taskCount);
        expect(calls.length).toBe(0);
        const messages = session.pipeline.snapshot().map((entry) => entry.message);
        expect(
          messages.some(
            (m) =>
              m.includes(kind === "file" ? "工作目录不是目录" : "工作目录不存在") &&
              m.includes(workDir),
          ),
        ).toBe(true);
        await session.dispose();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("java 退出码累加进 failed_count（main.js:2175-2176），after 跳过（main.js:2179-2185）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const session = new ConversionSession({
      pool,
      runner: async (): Promise<JavaBatchResult> => ({
        exitCode: 2,
        signal: null,
        failedTaskCount: 2,
        durationMs: 1,
      }),
    });
    const config = await session.loadConfig(fixture("run-hooks.xml"));

    const summary = await session.runConversion(selectAll(config));
    await session.pipeline.drain();

    expect(summary.state).toBe("failed");
    expect(summary.failedCount).toBe(2);
    const snapshot = session.pipeline.snapshot();
    const messages = snapshot.map((entry) => entry.message);
    expect(messages).toContain("[Process 1 exit with code 2.]");
    expect(messages).toContain("All jobs done, 2 job(s) failed.");
    expect(messages.some((m) => m.includes("AFTER"))).toBe(false);
  });

  it("stderr 告警明细续行按 warning 渲染：[WARN ] 头（含 ANSI）与其 '> File:…' 续行同为黄色，[ERROR] 续行保持红色", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    // xresloader log4j2 ConsoleErr：WARN/ERROR/FATAL 及多行明细全部走 stderr，
    // 头行携带 ANSI 颜色码（实测 2.23.7："\x1b[1;33m[WARN ] …"），续行为缩进 "> …"
    // （src …/resource/log4j2.xml）。用户反馈：告警的问题来源行（File/Table/Row/Column）
    // 渲染成红色会被误读为错误；ANSI 未剥离时连告警头也会误判为 error。
    const session = new ConversionSession({
      pool,
      runner: async (options): Promise<JavaBatchResult> => {
        options.onLog?.(
          "stderr",
          "\u001b[1;33m[WARN ] xresloader - Try to convert test_msg_verifier need at least 0 fields, at most 3 fields, but only provide 1 fields.",
        );
        options.onLog?.(
          "stderr",
          "  > File: D:/sample/资源转换示例.xlsx, Table: arr_in_arr, Row: 5, Column: 14(N)",
        );
        options.onLog?.("stderr", "  > Missing fields: test_id_2");
        options.onLog?.("stderr", "\u001b[1;31m[ERROR] xresloader - Initialize data source failed");
        options.onLog?.("stderr", "  > File: D:/sample/other.xlsx");
        return { exitCode: 0, signal: null, failedTaskCount: 0, durationMs: 1 };
      },
    });
    const config = await session.loadConfig(fixture("run-hooks.xml"));
    await session.runConversion(selectAll(config));
    await session.pipeline.drain();

    const stderrEntries = session.pipeline
      .snapshot()
      .filter(
        (entry) =>
          entry.message.includes("File:") ||
          entry.message.includes("Missing fields") ||
          entry.message.includes("Initialize data source") ||
          entry.message.includes("test_msg_verifier"),
      );
    const styleOf = (needle: string) =>
      stderrEntries.find((entry) => entry.message.includes(needle))?.style;
    // 告警头与续行 → warning（黄色）
    expect(styleOf("test_msg_verifier")).toBe("alert-warning");
    expect(styleOf("Column: 14(N)")).toBe("alert-warning");
    expect(styleOf("Missing fields")).toBe("alert-warning");
    // 错误头与其续行 → error（红色），不被前面的 warning 状态污染
    expect(styleOf("Initialize data source")).toBe("alert-danger");
    expect(styleOf("other.xlsx")).toBe("alert-danger");
    await session.dispose();
  });

  it("确定分片：round-robin（task i → 分片 i%N，BD-O3），5 任务并发 2 → [0,2,4]/[1,3]", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const calls: JavaBatchOptions[] = [];
    const session = new ConversionSession({ pool, runner: okRunner(calls), parallelism: 2 });
    const config = await session.loadConfig(fixture("run-shards.xml"));

    const summary = await session.runConversion(selectAll(config));

    expect(summary.state).toBe("succeeded");
    expect(summary.taskCount).toBe(5);
    expect(calls.length).toBe(2);
    const shard0 = (calls[0]?.tasks ?? []).join("\n");
    const shard1 = (calls[1]?.tasks ?? []).join("\n");
    expect(calls[0]?.tasks.length).toBe(3);
    expect(calls[1]?.tasks.length).toBe(2);
    for (const marker of ["item0", "item2", "item4"]) {
      expect(shard0).toContain(marker);
    }
    for (const marker of ["item1", "item3"]) {
      expect(shard1).toContain(marker);
    }
  });

  it("取消：运行中 cancel → 结束状态 cancelled 恰好一次、java abort 生效、无 All jobs done（BD-O6）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const runnerCalls: JavaBatchOptions[] = [];
    const hangingRunner = (options: JavaBatchOptions): Promise<JavaBatchResult> => {
      runnerCalls.push(options);
      const { promise, reject } = Promise.withResolvers<JavaBatchResult>();
      options.signal?.addEventListener("abort", () => reject(new AbortError()));
      return promise;
    };
    const session = new ConversionSession({ pool, runner: hangingRunner });
    const states = collectStates(session);
    const config = await session.loadConfig(fixture("run-hooks.xml"));

    const runPromise = session.runConversion(selectAll(config));
    await waitUntil(() => runnerCalls.length > 0, "java runner dispatched");
    session.cancel();
    session.cancel(); // 重复 cancel 是 no-op
    const summary = await runPromise;
    await session.pipeline.drain();

    expect(summary.state).toBe("cancelled");
    expect(summary.failedCount).toBe(0);
    expect(runnerCalls[0]?.signal?.aborted).toBe(true);
    expect(states.filter((s) => s === "cancelled").length).toBe(1);
    expect(states.indexOf("after_hooks")).toBe(-1);
    const messages = session.pipeline.snapshot().map((entry) => entry.message);
    expect(messages).toContain("Conversion cancelled.");
    expect(messages.some((m) => m.startsWith("All jobs done"))).toBe(false);
  });

  it("会话持有的 overrides：缺省用持有值，显式入参优先（P4-04a）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const calls: JavaBatchOptions[] = [];
    const session = new ConversionSession({ pool, runner: okRunner(calls) });
    const config = await session.loadConfig(fixture("run-hooks.xml")); // 配置 proto=protobuf
    session.updateSettings({ proto: "capnproto" });

    // 缺省（不传 overrides）→ 用会话持有值。
    const first = await session.runConversion(selectAll(config));
    expect(first.state).toBe("succeeded");
    expect(calls[0]?.tasks[0]).toContain("-p capnproto");
    expect(calls[0]?.tasks[0]).not.toContain("protobuf");

    // 显式入参（含 {} 语义外的具体值）优先于会话持有值；持有值不变。
    const second = await session.runConversion(selectAll(config), { proto: "protobuf" });
    expect(second.state).toBe("succeeded");
    expect(calls[1]?.tasks[0]).toContain("-p protobuf");
    expect(session.getOverrides().proto).toBe("capnproto");
  });

  it("事件上下文 work_dir/xresloader_path 用有效值（overrides 优先，main.js:2254-2256）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const session = new ConversionSession({ pool, runner: okRunner([]) });
    const config = await session.loadConfig(fixture("run-context.xml"));
    // workDir 空串 = 清空回退入口目录；xresloaderPath 覆盖为绝对路径（存在性检查通过）。
    const jarAbs = fixture("run-context.xml");
    session.updateSettings({ workDir: "", xresloaderPath: jarAbs });
    const summary = await session.runConversion(selectAll(config));
    expect(summary.state).toBe("succeeded");
    const messages = session.pipeline.snapshot().map((entry) => entry.message);
    expect(messages).toContain(`CTX ${config.dir}|${jarAbs}`);
  });

  it("状态机违规：未加载配置/运行中再启动均抛错（复用 assertTransition 语义）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const session = new ConversionSession({ pool, runner: okRunner([]) });
    await expect(session.runConversion({ items: [] })).rejects.toThrow(/requires a loaded config/);

    const hangingRunner = (options: JavaBatchOptions): Promise<JavaBatchResult> => {
      const { promise, reject } = Promise.withResolvers<JavaBatchResult>();
      options.signal?.addEventListener("abort", () => reject(new AbortError()));
      return promise;
    };
    const hanging = new ConversionSession({ pool, runner: hangingRunner });
    const config = await hanging.loadConfig(fixture("run-hooks.xml"));
    const items = selectAll(config);
    const first = hanging.runConversion(items);
    await waitUntil(() => hanging.getState() !== "ready", "first run leaves ready");
    await expect(hanging.runConversion(items)).rejects.toThrow(/cannot start a run/);
    hanging.cancel();
    const summary = await first;
    expect(summary.state).toBe("cancelled");
  });
});
