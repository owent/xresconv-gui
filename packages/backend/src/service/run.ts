/** 转换编排：冻结本次条目集合，执行 before 钩子，再构造和派发任务，成功后执行 after 钩子。before 回传的条目字段修改对当前命令可见，选择变化影响后续钩子和下次运行。取消停止派发并等待在途调用、Java 与所属进程收尾。 */

import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import type { ScriptResult } from "@xresconv/contracts";
import type { JavaBatchOptions, JavaBatchResult, ScriptWorkerPool } from "@xresconv/guardian";
import type { Hook, ParsedConfig } from "../config/model.ts";
import {
  buildConversionPlan,
  type ConversionOverrides,
  type ConversionPlan,
  type ConversionSelection,
  type ConversionTask,
  resolveEffectiveWorkDir,
} from "../convert/plan-builder.ts";
import { encodeTaskLine } from "../convert/stdin-encoder.ts";
import type { RunState } from "../domain/run-state.ts";
import { formatUnknownError } from "./format.ts";
import type { LogHookRunner, LogObject, LogPipeline } from "./log-pipeline.ts";

/** Java 批量执行器（默认 guardian runJavaBatch，测试可注入 fake）。 */
export type JavaRunner = (options: JavaBatchOptions) => Promise<JavaBatchResult>;

/** 一次转换运行的结果摘要。 */
export interface RunSummary {
  readonly runSeq: number;
  readonly state: "succeeded" | "failed" | "cancelled";
  /** 失败计数（事件 reject/超时/异常各 +1；java 累加退出码=失败任务数）。 */
  readonly failedCount: number;
  /** 本次计划的任务总数。 */
  readonly taskCount: number;
  readonly durationMs: number;
}

/**
 * 会话树状态桥（ NodeMirror 后端半区）：由 ConversionSession 提供，
 * 把 SessionTreeState 接入事件/append_log 的脚本上下文与 ops 回流。
 *
 * buildEventContext：每次 invoke 重建（含最新 tree 快照与版本），worker 侧
 *   据此重建 NodeMirror；selected_items/selected_nodes 由 worker 从 tree 推导。
 * buildAppendLogContext：run 开始快照一次（ 只读镜像：on_append_log
 *   看到的是 run 起始选择状态，修改尝试只产生诊断 op）。
 * applyOps：worker 回传的 ops 应用到 SessionTreeState（所有 outcome 都应用，
 *    部分修改语义对齐活引用）。
 */
export interface RunScriptContext {
  buildEventContext(): Record<string, unknown>;
  buildAppendLogContext(): Record<string, unknown>;
  applyOps(ops: readonly unknown[]): void;
}

export interface RunOptions {
  readonly config: ParsedConfig;
  readonly selection: ConversionSelection;
  readonly overrides?: ConversionOverrides;
  readonly pool: ScriptWorkerPool;
  readonly pipeline: LogPipeline;
  readonly runner: JavaRunner;
  /** 已压到 [1,16] 的并发数（会话侧默认 2)。 */
  readonly parallelism: number;
  readonly runSeq: number;
  /** 取消信号（会话 cancel 触发）；runner 侧中止用同一信号。 */
  readonly signal: AbortSignal;
  readonly isCancelRequested: () => boolean;
  /** 状态迁移（会话忽略本次运行结束后的重复更新，其余变更由 assertTransition 校验）。 */
  readonly transition: (to: RunState) => void;
  /**
   * 在途 on_append_log invocation id 集合（会话持有）：hook 内 log_* 产出的
   * 日志按 invocation_id 判定并 bypass hook 链（递归保护)。
   */
  readonly appendLogInvocations: Set<string>;
  /** ：会话树状态桥；缺省时保持  JSON 快照行为（无 tree、无 ops 回流）。 */
  readonly scriptContext?: RunScriptContext;
}

/** 链中止信号（对齐 promise reject 传播：后续环节跳过，末尾统一记 "CONV"）。 */
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

/** 逐 hook 顺序 invoke（ 的 .then 链）；reject/超时/异常 → failed++ 并中止。 */
async function runEventHooks(
  hooks: Hook[],
  entryKind: "on_before_convert" | "on_after_convert",
  baseContext: Record<string, unknown>,
  options: RunOptions,
): Promise<HookChainResult> {
  let failedCount = 0;
  for (const hook of hooks) {
    if (options.isCancelRequested()) {
      break; // 取消：冻结派发
    }
    if (!hook.enabled) {
      continue; // 禁用事件直接 resolve
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
        // data:{} 由 worker 每次执行新建；require 由 worker 注入。
        // 每次 invoke 重建 tree 快照（版本随 ops 应用递增）。
        context: { ...baseContext, ...options.scriptContext?.buildEventContext() },
      });
    } catch (err) {
      // worker 级失败（WORKER_TIMEOUT/WORKER_EXIT/.)：等价场景是渲染进程
      // 卡死；记 error 并中止链（失败计数语义同 reject)。
      failedCount++;
      const message = formatUnknownError(err);
      void options.pipeline.error(message, "CONV EVENT");
      return { failedCount, abortReason: message };
    }
    // 所有 outcome（含 rejected/error）都应用 ops——对齐活引用下
    // 脚本在 settle 前已产生的部分修改。
    if (result.ops !== undefined) {
      options.scriptContext?.applyOps(result.ops);
    }
    if (result.outcome === "resolved") {
      continue;
    }
    failedCount++;
    if (result.outcome === "rejected") {
      const reason = result.reason ?? "event rejected";
      if (reason === "Run event callback timeout") {
        // 超时当时先经 log_error 记一条，再由末尾 catch 记 "CONV"。
        void options.pipeline.error(reason, "CONV EVENT");
      }
      return { failedCount, abortReason: reason };
    }
    // error outcome：worker 消息已带 "CONV EVENT EXCEPTION" 前缀。
    const message = result.error?.message ?? "event script error";
    void options.pipeline.error(message, "CONV EVENT");
    return { failedCount, abortReason: message };
  }
  return { failedCount };
}

/** on_append_log 链：同一 logObject 贯穿全部启用 hook（ 共享语义）。 */
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
        // 只读镜像不产生树 ops；diagnostic（D3_READ_ONLY 等）直接进
        // 日志且 bypass hook 链（防对诊断再触发脚本，同 WorkerDiag 处理）。
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
          } else if (op.op === "diagnostic") {
            const code = typeof op.code === "string" ? op.code : "UNKNOWN";
            const message = typeof op.message === "string" ? op.message : String(op.message);
            void options.pipeline.warning(`${code}: ${message}`, "SCRIPT", { bypassHooks: true });
          }
        }
        if (result.outcome === "error") {
          // 部分修改保留，剩余 hook 跳过。
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

/**
 * 剥离 SGR ANSI 转义后的纯文本（仅用于 stderr 级别判定，不改写消息本体——
 * UI 层按  安全渲染 ANSI 颜色）。xresloader 的 log4j2 %highlight 在管道
 * 上仍输出颜色码（实测 2.23.7：`\x1b[1;33m[WARN ] …`），不剥离会导致告警头
 * 被误判为 error。经 RegExp 构造以兼容 Biome 控制字符规则。
 */
const ANSI_SGR_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
function stripAnsiCodes(text: string): string {
  return text.replace(ANSI_SGR_PATTERN, "");
}

/** 单进程分片执行：启动日志 → 派发日志 → runner → 退出分级日志。 */
async function runShard(
  shardTasks: ConversionTask[],
  processIndex: number,
  planWorkDir: string,
  planJar: string,
  planJavaArgs: string[],
  options: RunOptions,
): Promise<ShardOutcome> {
  const cmds = [...planJavaArgs, "-jar", planJar, "--stdin"];
  // 进程启动，module = work_dir。
  void options.pipeline.info(`Process ${processIndex} : ${cmds.join(" ")}`, planWorkDir);

  const lines: string[] = [];
  let failedCount = 0;
  // xresloader 的 WARN/ERROR 多行明细与其头行同走 stderr（log4j2 ConsoleErr，
  // src …/resource/log4j2.xml）。"[WARN ] …" 头之后的 "> File/Table/Row/Column…"
  // 续行语义同属告警：跟随 warning 渲染，避免来源提示被红色误读为错误（用户反馈）。
  // 头行可能带 ANSI 颜色码，判级前先剥离。
  let stderrWarnDetail = false;
  for (const task of shardTasks) {
    try {
      lines.push(encodeTaskLine(task.argv));
    } catch (err) {
      failedCount++;
      void options.pipeline.error(
        `task encode failed, skipped: ${formatUnknownError(err)}`,
        `[CONV ${processIndex}]`,
      );
      continue;
    }
    // 派发日志，module [CONV N]，内容为旧式单行展示串（BD)。
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
          void options.pipeline.notice(text); // （绿色 span 属 UI 层）
        } else if (stripAnsiCodes(text).slice(0, 5).toLowerCase() === "[warn") {
          stderrWarnDetail = true;
          void options.pipeline.warning(text);
        } else if (stderrWarnDetail && stripAnsiCodes(text).trimStart().startsWith(">")) {
          void options.pipeline.warning(text);
        } else {
          stderrWarnDetail = false;
          void options.pipeline.error(text);
        }
      },
    });
  } catch (err) {
    if (options.isCancelRequested()) {
      return { failedCount }; // 取消路径：不计失败（外层归 cancelled）
    }
    // SpawnError 等：保守计该分片全部任务失败(B5 缺陷不计数）。
    void options.pipeline.error(`[Process ${processIndex}] ${formatUnknownError(err)}`, undefined);
    return { failedCount: failedCount + lines.length };
  }

  // 退出分级(notice 显示 + log4js 分级双写，合并为单条)。
  if (result.signal !== null) {
    void options.pipeline.error(`[Process ${processIndex} exit with signal ${result.signal}.]`);
  } else if (result.exitCode === 0) {
    void options.pipeline.info(`[Process ${processIndex} exit.]`);
  } else {
    void options.pipeline.error(`[Process ${processIndex} exit with code ${result.exitCode}.]`);
  }
  // failed_count += 退出码（xresloader 失败任务数约定)。
  return { failedCount: failedCount + result.failedTaskCount };
}

/**
 * 执行一次转换运行。永不因业务失败 reject（对齐 conv_start 全 catch），
 * 运行结果与计数体现在返回值与状态机迁移中。
 */
export async function runConversion(options: RunOptions): Promise<RunSummary> {
  const startedAt = Date.now();
  const { config, selection, pipeline } = options;
  let failedCount = 0;
  let taskCount = 0;

  // 事件/append_log 基础上下文。
  const proto = options.overrides?.proto ?? config.proto;
  const dataVersion = options.overrides?.dataVersion ?? config.dataVersion;
  const globalOptions: Record<string, string> = {};
  if (proto) {
    globalOptions["-p"] = proto;
  }
  if (dataVersion) {
    globalOptions["-a"] = dataVersion;
  }
  const baseContext: Record<string, unknown> = {
    // work_dir/xresloader_path 用有效值（overrides 优先）：上下文取自表单
    //与 -p/-a 的 overrides 回退同模式。
    work_dir: resolveEffectiveWorkDir(config, options.overrides ?? {}),
    configure_file: config.path, // 顶层配置
    xresloader_path: options.overrides?.xresloaderPath ?? config.xresloaderPath,
    global_options: globalOptions,
    selected_items: structuredClone(selection.items), // 快照
    selected_nodes: [], // ：无 Fancytree；NodeMirror 归
  };

  // append_log_context 窗口开始。：tree 快照在 run 开始
  // 固化一次（ 只读镜像），不随后续事件 ops 更新。
  pipeline.hookRunner = makeAppendLogRunner(
    config.gui.onAppendLog,
    { ...baseContext, ...options.scriptContext?.buildAppendLogContext() },
    options,
  );

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
        // 在 spawn 前检查发现 xresloader 缺失：failed_count += 任务行数并 reject
        //。构建与检查一体，任务数不可得，按选中 item 数
        // 近似（下界；每 item 至少 1 任务），。
        failedCount += Math.max(1, selection.items.length);
        throw new HookChainAbort(formatUnknownError(err));
      }
      taskCount = plan.tasks.length;

      //  执行前诊断：工作目录缺失会让 java spawn 报误导性的 ENOENT(指向
      // java 路径而非 cwd)。派发前显式检查并给出可行动文案。
      if (plan.tasks.length > 0) {
        let workDirError: string | undefined;
        try {
          if (!statSync(plan.workDir).isDirectory()) {
            workDirError = `工作目录不是目录: ${plan.workDir} —— 请将 work_dir 指向一个目录`;
          }
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          workDirError =
            code === "ENOENT" || code === "ENOTDIR"
              ? `工作目录不存在: ${plan.workDir} —— 请先创建该目录，或修正配置中的 work_dir（相对路径相对配置文件所在目录解析）`
              : `无法访问工作目录: ${plan.workDir} (${formatUnknownError(error)})`;
        }
        if (workDirError !== undefined) {
          failedCount += plan.tasks.length;
          throw new HookChainAbort(workDirError);
        }
      }

      // 确定分片：round-robin（task i → 分片 i%N），。0 任务不 spawn。
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

    // after 仅在链 resolve（failed_count<=0)且未取消时执行。
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
      void pipeline.error(err.reason, "CONV");
    } else {
      failedCount++;
      void pipeline.error(formatUnknownError(err), "CONV");
    }
  } finally {
    // append_log_context = null；收尾日志不再进 hook 链。
    pipeline.hookRunner = null;
    await pipeline.drain();
    if (options.isCancelRequested()) {
      options.transition("cancelled");
      await pipeline.notice("Conversion cancelled.", "CONV"); // ：无取消能力
    } else if (failedCount > 0) {
      options.transition("failed");
      // （旧文案保留；成功分支同为 DarkRed 属 UI，B10 不复刻）。
      await pipeline.error(`All jobs done, ${failedCount} job(s) failed.`, "CONV");
    } else {
      options.transition("succeeded");
      await pipeline.info("All jobs done.", "CONV");
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
