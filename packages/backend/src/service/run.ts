/**
 * 转换执行编排（P3-08）。
 *
 * 对齐旧版 conv_start 链（main.js:1898-2448）：
 * `on_before_convert 链 → 计划构建/进程派发 → 全退后 on_after_convert 链 → 收尾`，
 * 任一环节 reject → 后续跳过 → 末尾 catch 记 "CONV" error（main.js:2416-2418）→
 * finally 清 append_log_context（main.js:2424）并按 failed_count 输出
 * "All jobs done[, N job(s) failed]."（main.js:2426-2446）。
 *
 * 关键语义锚点：
 * - 事件链逐 hook 顺序执行，reject/超时/异常 → failed_count++ 并中止链
 *   （main.js:2307-2392；reject 先 ++failed_count，main.js:2315）。
 * - after 仅在 run_all resolve（failed_count<=0，main.js:2179-2185）后执行
 *   （链式 then 拒绝传播，main.js:2396-2407）。
 * - 事件上下文（main.js:2253-2298）：work_dir/configure_file=顶层配置/xresloader_path/
 *   global_options={"-p","-a"?}/selected_items/selected_nodes/run_seq；require 由
 *   worker 注入（BD-S1）。selected_nodes 传 []（BD-O7，NodeMirror 归 P2-05）。
 * - 计划构建在 before 链之后、java 之前（P3-05 冻结的 buildConversionPlan 是
 *   构建+存在性检查一体；旧版命令拼接在 before 前、存在性检查在 spawn 时
 *   （main.js:2068-2085）——因 selected_items 是快照（BD-S9），hook 改 item
 *   本就不影响计划，顺序差异不可观测；存在性检查提前的失败语义记 BD-O8）。
 * - 退出码：failed_count += 每进程 failedTaskCount（=exitCode，main.js:2175-2176，
 *   Main.java:407 约定）。
 * - 取消（BD-O6，新能力）：冻结派发（不再 invoke 新 hook / 不 spawn java）、
 *   AbortSignal 中止在途 java（runner 侧 SIGTERM→宽限→SIGKILL），终态 cancelled
 *   只进入一次（状态机 assertTransition + 会话终态吸收）。worker 在途 invoke
 *   不杀（共享池），由其 timeout 兜底。
 *
 * 日志：进程启动（module=work_dir，main.js:2125-2137）、每任务派发
 * （module `[CONV N]`，main.js:2093-2097）、stdout→notice / stderr 按前 5 字符
 * "[warn" 大小写不敏感分 warning/error（main.js:2191-2220）、进程退出分级
 * （main.js:2156-2172）均保留；shell_color_to_html/颜色 span 属 UI 层不进本层。
 */

import { randomUUID } from "node:crypto";
import type { ScriptResult } from "@xresconv/contracts";
import type { JavaBatchOptions, JavaBatchResult, ScriptWorkerPool } from "@xresconv/guardian";
import { resolveWorkDir } from "../config/loader.ts";
import type { Hook, ParsedConfig } from "../config/model.ts";
import {
  buildConversionPlan,
  type ConversionOverrides,
  type ConversionPlan,
  type ConversionSelection,
  type ConversionTask,
} from "../convert/plan-builder.ts";
import { encodeTaskLine } from "../convert/stdin-encoder.ts";
import type { RunState } from "../domain/run-state.ts";
import { formatUnknownError } from "./format.ts";
import type { LogHookRunner, LogObject, LogPipeline } from "./log-pipeline.ts";

/** Java 批量执行器（默认 guardian runJavaBatch，测试可注入 fake）。 */
export type JavaRunner = (options: JavaBatchOptions) => Promise<JavaBatchResult>;

/** 一次转换运行的终态摘要。 */
export interface RunSummary {
  readonly runSeq: number;
  readonly state: "succeeded" | "failed" | "cancelled";
  /** 失败计数（事件 reject/超时/异常各 +1；java 累加退出码=失败任务数）。 */
  readonly failedCount: number;
  /** 本次计划的任务总数。 */
  readonly taskCount: number;
  readonly durationMs: number;
}

export interface RunOptions {
  readonly config: ParsedConfig;
  readonly selection: ConversionSelection;
  readonly overrides?: ConversionOverrides;
  readonly pool: ScriptWorkerPool;
  readonly pipeline: LogPipeline;
  readonly runner: JavaRunner;
  /** 已压到 [1,16] 的并发数（会话侧默认 2，BD-O2）。 */
  readonly parallelism: number;
  readonly runSeq: number;
  /** 取消信号（会话 cancel() 触发）；runner 侧中止用同一信号。 */
  readonly signal: AbortSignal;
  readonly isCancelRequested: () => boolean;
  /** 状态迁移（会话实现：终态吸收 + assertTransition）。 */
  readonly transition: (to: RunState) => void;
  /**
   * 在途 on_append_log invocation id 集合（会话持有）：hook 内 log_* 产出的
   * 日志按 invocation_id 判定并 bypass hook 链（递归保护，BD-O11）。
   */
  readonly appendLogInvocations: Set<string>;
}

/** 链中止信号（对齐旧版 promise reject 传播：后续环节跳过，末尾统一记 "CONV"）。 */
class HookChainAbort extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "HookChainAbort";
    this.reason = reason;
  }
}

interface HookChainResult {
  failedCount: number;
  abortReason?: string;
}

/** 逐 hook 顺序 invoke（main.js:2301-2353 的 .then 链）；reject/超时/异常 → failed++ 并中止。 */
async function runEventHooks(
  hooks: Hook[],
  entryKind: "on_before_convert" | "on_after_convert",
  baseContext: Record<string, unknown>,
  options: RunOptions,
): Promise<HookChainResult> {
  let failedCount = 0;
  for (const hook of hooks) {
    if (options.isCancelRequested()) {
      break; // 取消：冻结派发（BD-O6）
    }
    if (!hook.enabled) {
      continue; // 禁用事件直接 resolve（main.js:2315-2322）
    }
    let result: ScriptResult;
    try {
      result = await options.pool.invoke({
        invocation_id: randomUUID(),
        entry_kind: entryKind,
        filename: hook.filename,
        source: hook.source,
        timeout_ms: hook.timeoutMs,
        run_seq: options.runSeq,
        // data:{} 由 worker 每次执行新建（main.js:2350）；require 由 worker 注入（BD-S1）。
        context: { ...baseContext },
      });
    } catch (err) {
      // worker 级失败（WORKER_TIMEOUT/WORKER_EXIT/...）：旧版等价场景是渲染进程
      // 卡死；新版记 error 并中止链（失败计数语义同 reject，main.js:2315）。
      failedCount++;
      const message = formatUnknownError(err);
      void options.pipeline.error(message, "CONV EVENT");
      return { failedCount, abortReason: message };
    }
    if (result.outcome === "resolved") {
      continue;
    }
    failedCount++;
    if (result.outcome === "rejected") {
      const reason = result.reason ?? "event rejected";
      if (reason === "Run event callback timeout") {
        // 旧版超时当时先经 log_error 记一条（main.js:2360-2369），再由末尾 catch 记 "CONV"。
        void options.pipeline.error(reason, "CONV EVENT");
      }
      return { failedCount, abortReason: reason };
    }
    // error outcome：worker 消息已带 "CONV EVENT EXCEPTION" 前缀（BD-S3）。
    const message = result.error?.message ?? "event script error";
    void options.pipeline.error(message, "CONV EVENT");
    return { failedCount, abortReason: message };
  }
  return { failedCount };
}

/** on_append_log 链：同一 logObject 贯穿全部启用 hook（main.js:183-204 共享语义）。 */
function makeAppendLogRunner(
  hooks: Hook[],
  baseContext: Record<string, unknown>,
  options: RunOptions,
): LogHookRunner {
  const enabled = hooks.filter((hook) => hook.enabled);
  return async (logObject: LogObject): Promise<void> => {
    for (const hook of enabled) {
      const invocationId = randomUUID();
      options.appendLogInvocations.add(invocationId);
      try {
        const result = await options.pool.invoke({
          invocation_id: invocationId,
          entry_kind: "on_append_log",
          filename: hook.filename,
          source: hook.source,
          timeout_ms: hook.timeoutMs,
          run_seq: options.runSeq,
          context: {
            ...baseContext,
            log_object: {
              message: logObject.message,
              module_name: logObject.module_name,
              style: logObject.style,
            },
          },
        });
        // set_log_fields 合并回 logObject → 后一 hook 输入（ops 按序应用）。
        const target = logObject as unknown as Record<string, unknown>;
        for (const op of result.ops ?? []) {
          if (op.op === "set_log_fields" && typeof op.fields === "object" && op.fields !== null) {
            for (const [key, value] of Object.entries(op.fields as Record<string, unknown>)) {
              if (value === null) {
                delete target[key];
              } else {
                target[key] = value;
              }
            }
          }
        }
        if (result.outcome === "error") {
          // 部分修改保留，剩余 hook 跳过（main.js:205-212）。
          void options.pipeline.error(
            result.error?.message ?? "append log event error",
            "APPEND LOG EVENT EXCEPTION",
            { bypassHooks: true },
          );
          break;
        }
      } catch (err) {
        // worker 级失败：同上，部分修改保留、剩余 hook 跳过。
        void options.pipeline.error(formatUnknownError(err), "APPEND LOG EVENT EXCEPTION", {
          bypassHooks: true,
        });
        break;
      } finally {
        options.appendLogInvocations.delete(invocationId);
      }
    }
  };
}

interface ShardOutcome {
  failedCount: number;
}

/** 单进程分片执行：启动日志 → 派发日志 → runner → 退出分级日志（main.js:2119-2189）。 */
async function runShard(
  shardTasks: ConversionTask[],
  processIndex: number,
  planWorkDir: string,
  planJar: string,
  planJavaArgs: string[],
  options: RunOptions,
): Promise<ShardOutcome> {
  const cmds = [...planJavaArgs, "-jar", planJar, "--stdin"];
  // main.js:2125-2137：进程启动，module = work_dir。
  void options.pipeline.info(`Process ${processIndex} : ${cmds.join(" ")}`, planWorkDir);

  const lines: string[] = [];
  let failedCount = 0;
  for (const task of shardTasks) {
    try {
      lines.push(encodeTaskLine(task.argv));
    } catch (err) {
      // 旧版无编码失败路径（整行拼接直发）；新版该行判失败并跳过，其余任务继续（BD-O 记录）。
      failedCount++;
      void options.pipeline.error(
        `task encode failed, skipped: ${formatUnknownError(err)}`,
        `[CONV ${processIndex}]`,
      );
      continue;
    }
    // main.js:2093-2097：派发日志，module [CONV N]，内容为旧式单行展示串（BD-P9）。
    void options.pipeline.info(task.display, `[CONV ${processIndex}]`);
  }

  let result: JavaBatchResult;
  if (lines.length === 0 || options.isCancelRequested()) return { failedCount };
  try {
    result = await options.runner({
      javaArgs: planJavaArgs,
      jarPath: planJar,
      workDir: planWorkDir,
      tasks: lines,
      signal: options.signal,
      onLog: (stream, text) => {
        if (stream === "stdout") {
          void options.pipeline.notice(text); // main.js:2191-2201（绿色 span 属 UI 层）
        } else if (text.slice(0, 5).toLowerCase() === "[warn") {
          void options.pipeline.warning(text); // main.js:2204-2213
        } else {
          void options.pipeline.error(text); // main.js:2213-2220
        }
      },
    });
  } catch (err) {
    if (options.isCancelRequested()) {
      return { failedCount }; // 取消路径：不计失败（外层归 cancelled）
    }
    // SpawnError 等：保守计该分片全部任务失败（BD-O9；旧版 B5 缺陷不计数）。
    void options.pipeline.error(`[Process ${processIndex}] ${formatUnknownError(err)}`, undefined);
    return { failedCount: failedCount + lines.length };
  }

  // 退出分级（main.js:2156-2172；旧版 notice 显示 + log4js 分级双写，合并为单条，BD-O18）。
  if (result.signal !== null) {
    void options.pipeline.error(`[Process ${processIndex} exit with signal ${result.signal}.]`);
  } else if (result.exitCode === 0) {
    void options.pipeline.info(`[Process ${processIndex} exit.]`);
  } else {
    void options.pipeline.error(`[Process ${processIndex} exit with code ${result.exitCode}.]`);
  }
  // failed_count += 退出码（xresloader 失败任务数约定，main.js:2175-2176）。
  return { failedCount: failedCount + result.failedTaskCount };
}

/**
 * 执行一次转换运行。永不因业务失败 reject（对齐旧版 conv_start 全 catch），
 * 终态与计数体现在返回值与状态机迁移中。
 */
export async function runConversion(options: RunOptions): Promise<RunSummary> {
  const startedAt = Date.now();
  const { config, selection, pipeline } = options;
  let failedCount = 0;
  let taskCount = 0;

  // 事件/append_log 基础上下文（main.js:2253-2298）。
  const proto = options.overrides?.proto ?? config.proto;
  const dataVersion = options.overrides?.dataVersion ?? config.dataVersion;
  const globalOptions: Record<string, string> = {};
  if (proto) {
    globalOptions["-p"] = proto; // main.js:1911-1913
  }
  if (dataVersion) {
    globalOptions["-a"] = dataVersion; // main.js:1945-1947
  }
  const baseContext: Record<string, unknown> = {
    work_dir: resolveWorkDir(config) ?? config.dir,
    configure_file: config.path, // 顶层配置（main.js:2255）
    xresloader_path: config.xresloaderPath,
    global_options: globalOptions, // main.js:2257
    selected_items: structuredClone(selection.items), // 快照（BD-S9）
    selected_nodes: [], // BD-O7：无 Fancytree；NodeMirror 归 P2-05
  };

  // append_log_context 窗口开始（main.js:2299）。
  pipeline.hookRunner = makeAppendLogRunner(config.gui.onAppendLog, baseContext, options);

  try {
    options.transition("before_hooks");
    const before = await runEventHooks(
      config.gui.onBeforeConvert,
      "on_before_convert",
      baseContext,
      options,
    );
    failedCount += before.failedCount;
    if (before.abortReason !== undefined) {
      throw new HookChainAbort(before.abortReason);
    }

    options.transition("converting");
    if (!options.isCancelRequested()) {
      let plan: ConversionPlan;
      try {
        plan = buildConversionPlan(config, selection, options.overrides);
      } catch (err) {
        // 旧版在 spawn 前检查发现 xresloader 缺失：failed_count += 任务行数并 reject
        // （main.js:2068-2085）。新版构建与检查一体，任务数不可得，按选中 item 数
        // 近似（下界；每 item 至少 1 任务），BD-O8。
        failedCount += Math.max(1, selection.items.length);
        throw new HookChainAbort(formatUnknownError(err));
      }
      taskCount = plan.tasks.length;

      // 确定分片：round-robin（task i → 分片 i%N），BD-O3。0 任务不 spawn（BD-O5）。
      const shardCount = Math.min(options.parallelism, plan.tasks.length);
      if (shardCount > 0) {
        const shards: ConversionTask[][] = [];
        for (let i = 0; i < shardCount; i++) {
          shards.push([]);
        }
        plan.tasks.forEach((task, index) => {
          shards[index % shardCount]?.push(task);
        });
        const outcomes = await Promise.all(
          shards.map((shardTasks, index) =>
            runShard(
              shardTasks,
              index + 1,
              plan.workDir,
              plan.xresloaderPath,
              plan.javaArgs,
              options,
            ),
          ),
        );
        for (const outcome of outcomes) {
          failedCount += outcome.failedCount;
        }
      }
    }

    // after 仅在链 resolve（failed_count<=0，main.js:2179-2185）且未取消时执行。
    if (!options.isCancelRequested() && failedCount === 0) {
      options.transition("after_hooks");
      const after = await runEventHooks(
        config.gui.onAfterConvert,
        "on_after_convert",
        baseContext,
        options,
      );
      failedCount += after.failedCount;
      if (after.abortReason !== undefined) {
        throw new HookChainAbort(after.abortReason);
      }
    }
  } catch (err) {
    if (options.isCancelRequested()) {
      // 取消在途：AbortError 等属预期，不计失败。
    } else if (err instanceof HookChainAbort) {
      void pipeline.error(err.reason, "CONV"); // main.js:2416-2418
    } else {
      failedCount++;
      void pipeline.error(formatUnknownError(err), "CONV");
    }
  } finally {
    // append_log_context = null（main.js:2424）；收尾日志不再进 hook 链。
    pipeline.hookRunner = null;
    await pipeline.drain();
    if (options.isCancelRequested()) {
      options.transition("cancelled");
      await pipeline.notice("Conversion cancelled.", "CONV"); // BD-O15：旧版无取消能力
    } else if (failedCount > 0) {
      options.transition("failed");
      // main.js:2426-2437（旧文案保留；成功分支同为 DarkRed 属 UI，B10 不复刻）。
      await pipeline.error(`All jobs done, ${failedCount} job(s) failed.`, "CONV");
    } else {
      options.transition("succeeded");
      await pipeline.info("All jobs done.", "CONV"); // main.js:2438-2446
    }
  }

  return {
    runSeq: options.runSeq,
    state: options.isCancelRequested() ? "cancelled" : failedCount > 0 ? "failed" : "succeeded",
    failedCount,
    taskCount,
    durationMs: Date.now() - startedAt,
  };
}
