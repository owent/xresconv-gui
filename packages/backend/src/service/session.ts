/**
 * 转换会话编排（P3-03/P3-08/P3-09 会话层）。
 *
 * ConversionSession 持有一次加载的配置、日志管线与运行代际（run_seq），
 * 是 run-state 状态机（domain/run-state.ts，冻结）的唯一迁移 owner。
 *
 * 依赖注入：
 * - ScriptWorkerPool 由调用方创建/持有（backend 不自己 spawn；会话级 cancel
 *   不杀共享池，BD-O6）；
 * - JavaRunner 默认 guardian runJavaBatch，测试可注入 fake；
 * - LogPipeline 缺省自建；log4js 落盘仅在显式传 `log4js` 选项时挂载（BD-O12）。
 *
 * worker 事件接线：pool.onLog 的 log envelope 按级别路由进日志管线；
 * on_append_log 产出的日志按 entry_kind / 在途 invocation_id 判定并 bypass
 * hook 链（递归保护，BD-O11）；WorkerDiag（worker-stderr/fault/exit）记为
 * WORKER 模块诊断（bypass hook 链，避免对脚本引擎诊断再触发脚本）。
 */

import type { Envelope } from "@xresconv/contracts";
import type { ScriptWorkerPool, WorkerDiag } from "@xresconv/guardian";
import { runJavaBatch } from "@xresconv/guardian";
import type { ParsedConfig } from "../config/model.ts";
import type { ConversionOverrides, ConversionSelection } from "../convert/plan-builder.ts";
import { assertTransition, isTerminal, type RunState } from "../domain/run-state.ts";
import { formatUnknownError } from "./format.ts";
import { loadConfig as loadConfigWithSetName } from "./load-config.ts";
import { createLog4jsSink, type Log4jsSink, type LogLevel, LogPipeline } from "./log-pipeline.ts";
import { runConversion as executeRun, type JavaRunner, type RunSummary } from "./run.ts";

/** 并发默认 2（旧版启动硬压 2 的语义，main.js:2574-2587），上限 16（main.js:6-9）。 */
export const DEFAULT_PARALLELISM = 2;
export const MAX_PARALLELISM = 16;

/** log4js shutdown flush 的有界等待。 */
const LOG4JS_SHUTDOWN_TIMEOUT_MS = 5000;

export interface ConversionSessionOptions {
  /** 会话共享的 script worker 池（调用方负责 start/shutdown）。 */
  pool: ScriptWorkerPool;
  /** Java 批量执行器；默认 guardian runJavaBatch。 */
  runner?: JavaRunner;
  /** 转表并发数，默认 2，压到 [1,16]（BD-O2）。 */
  parallelism?: number;
  /** set_name 单条超时（毫秒），默认 5000（BD-O1）。 */
  setNameTimeoutMs?: number;
  /** 日志管线；缺省自建。 */
  pipeline?: LogPipeline;
  /** 显式传入才挂载 log4js 落盘（configurePath 对应 --log-configure，BD-O12）。 */
  log4js?: { configurePath?: string };
  /** worker dialog 请求回调；缺省保持 pool 默认（无 handler 自动应答 null，BD-W2）。 */
  onDialogRequest?: ScriptWorkerPool["onDialogRequest"];
}

const WORKER_LOG_LEVELS: readonly LogLevel[] = ["info", "notice", "warning", "error"];

export class ConversionSession {
  readonly pipeline: LogPipeline;
  /** 状态迁移订阅（UI 快照渲染）。 */
  onStateChange?: (state: RunState, previous: RunState) => void;

  private readonly pool: ScriptWorkerPool;
  private readonly runner: JavaRunner;
  private readonly parallelism: number;
  private readonly setNameTimeoutMs: number | undefined;
  private readonly log4jsSink: Log4jsSink | null = null;
  private readonly appendLogInvocations = new Set<string>();

  private state: RunState = "idle";
  private generation = 0;
  private config: ParsedConfig | null = null;
  private javaAbort: AbortController | null = null;
  private cancelRequested = false;
  private activeRun: Promise<RunSummary> | null = null;
  private disposed = false;

  constructor(options: ConversionSessionOptions) {
    this.pool = options.pool;
    this.runner = options.runner ?? runJavaBatch;
    const requested = Math.floor(options.parallelism ?? DEFAULT_PARALLELISM);
    if (!Number.isFinite(requested)) throw new RangeError("parallelism must be finite");
    this.parallelism = Math.min(MAX_PARALLELISM, Math.max(1, requested));
    this.setNameTimeoutMs = options.setNameTimeoutMs;
    this.pipeline = options.pipeline ?? new LogPipeline();
    if (options.onDialogRequest !== undefined) {
      this.pool.onDialogRequest = options.onDialogRequest;
    }
    this.pool.onLog = (event) => this.routeWorkerEvent(event);
    if (options.log4js !== undefined) {
      this.log4jsSink = createLog4jsSink({
        ...options.log4js,
        onDiagnostic: (message) => {
          // Do not send persistence diagnostics back to the failing sink.
          void this.pipeline.error(message, "LOG", { bypassHooks: true, bypassSinks: true });
        },
      });
      const sink = this.log4jsSink;
      this.pipeline.addSink((entry) => sink.append(entry));
    }
  }

  getState(): RunState {
    return this.state;
  }

  getConfig(): ParsedConfig | null {
    return this.config;
  }

  /** 当前运行代际（run_seq）；0 表示尚未运行。 */
  getRunSeq(): number {
    return this.generation;
  }

  /**
   * 加载配置（P3-03）：idle/ready/终态 → loading → ready；解析硬错误 → failed 并抛出。
   * set_name 整合由 load-config.ts 完成（错误/超时记诊断、加载继续）。
   */
  async loadConfig(configPath: string): Promise<ParsedConfig> {
    if (this.disposed || this.javaAbort !== null) throw new Error("session is disposed or running");
    this.transition("loading");
    try {
      const config = await loadConfigWithSetName(configPath, {
        pool: this.pool,
        pipeline: this.pipeline,
        setNameTimeoutMs: this.setNameTimeoutMs,
      });
      if (this.disposed) throw new Error("session disposed during configuration load");
      for (const diagnostic of config.diagnostics) {
        void this.pipeline.warning(`${diagnostic.message} (${diagnostic.file})`, "CONFIG");
      }
      this.config = config;
      this.transition("ready");
      return config;
    } catch (err) {
      void this.pipeline.error(formatUnknownError(err), "CONFIG");
      this.transition("failed");
      throw err;
    }
  }

  /**
   * 执行一次转换运行（P3-08）。要求已加载配置；终态后再运行先经
   * loading→ready 重新武装（BD-O14；状态机不允许 terminal→before_hooks 直达）。
   */
  async runConversion(
    selection: ConversionSelection,
    overrides: ConversionOverrides = {},
  ): Promise<RunSummary> {
    if (this.disposed || this.javaAbort !== null)
      throw new Error("cannot start a run while session is disposed or running");
    const config = this.config;
    if (config === null) {
      throw new Error("runConversion requires a loaded config (call loadConfig first)");
    }
    if (isTerminal(this.state)) {
      this.transition("loading");
      this.transition("ready");
    }
    if (this.state !== "ready") {
      throw new Error(`cannot start a run from state "${this.state}"`);
    }
    this.generation++;
    this.cancelRequested = false;
    const abort = new AbortController();
    this.javaAbort = abort;
    try {
      this.activeRun = executeRun({
        config: structuredClone(config),
        selection: structuredClone(selection),
        overrides: structuredClone(overrides),
        pool: this.pool,
        pipeline: this.pipeline,
        runner: this.runner,
        parallelism: this.parallelism,
        runSeq: this.generation,
        signal: abort.signal,
        isCancelRequested: () => this.cancelRequested,
        transition: (to) => this.transitionSoft(to),
        appendLogInvocations: this.appendLogInvocations,
      });
      return await this.activeRun;
    } finally {
      this.javaAbort = null;
      this.activeRun = null;
    }
  }

  /**
   * 取消当前运行（BD-O6）：冻结派发 + abort 在途 java（SIGTERM→宽限→SIGKILL）。
   * 仅运行中状态（before_hooks/converting/after_hooks）有效，其余状态 no-op；
   * 清理完成后才进入 cancelled。worker 在途 invoke 不杀（共享池），由其 timeout 兜底。
   */
  cancel(): void {
    if (
      this.state !== "before_hooks" &&
      this.state !== "converting" &&
      this.state !== "after_hooks"
    ) {
      return;
    }
    this.cancelRequested = true;
    this.javaAbort?.abort();
    // Keep the run active until hooks, child close and log drain finish.
  }

  /** 收尾：清空 hook 窗口、等队列 drain、flush log4js（有界）。不 shutdown 共享池。 */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.cancel();
    await this.activeRun;
    this.pipeline.hookRunner = null;
    await this.pipeline.drain();
    if (this.log4jsSink !== null) {
      await this.log4jsSink.shutdown(LOG4JS_SHUTDOWN_TIMEOUT_MS);
    }
  }

  /** 严格迁移：非法跳转（含终态再迁出之外的违规）由 assertTransition 抛出。 */
  private transition(to: RunState): void {
    assertTransition(this.state, to);
    const previous = this.state;
    this.state = to;
    this.onStateChange?.(to, previous);
  }

  /**
   * run 流程用迁移：终态吸收，避免重复收尾；非终态非法跳转仍由 assertTransition 抛出。
   */
  private transitionSoft(to: RunState): void {
    if (isTerminal(this.state)) {
      return;
    }
    this.transition(to);
  }

  /** pool.onLog 路由：log envelope → 管线；WorkerDiag → WORKER 诊断。 */
  private routeWorkerEvent(event: Envelope | WorkerDiag): void {
    if ("kind" in event) {
      if (event.kind !== "log") {
        return;
      }
      const payload = event.payload;
      const level: LogLevel = WORKER_LOG_LEVELS.includes(payload.level as LogLevel)
        ? (payload.level as LogLevel)
        : "info";
      const invocationId =
        typeof payload.invocation_id === "string" ? payload.invocation_id : undefined;
      const bypassHooks =
        payload.entry_kind === "on_append_log" ||
        (invocationId !== undefined && this.appendLogInvocations.has(invocationId));
      void this.pipeline.append(
        {
          message: payload.message,
          level,
          moduleName: typeof payload.module_name === "string" ? payload.module_name : "CONV EVENT",
        },
        { bypassHooks },
      );
      return;
    }
    // WorkerDiag（BD-W6）：worker 自身诊断不进 on_append_log 链（防对引擎诊断再触发脚本）。
    void this.pipeline.append(
      {
        message: event.line,
        level: event.source === "worker-stderr" ? "warning" : "error",
        moduleName: "WORKER",
      },
      { bypassHooks: true },
    );
  }
}
