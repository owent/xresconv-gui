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

import type { TreeSnapshot } from "@xresconv/compat-service";
import type { Envelope } from "@xresconv/contracts";
import type { ScriptWorkerPool, WorkerDiag } from "@xresconv/guardian";
import { runJavaBatch } from "@xresconv/guardian";
import type { ParsedConfig, TreeItem } from "../config/model.ts";
import type {
  ConversionOverrides,
  ConversionSelection,
  EffectiveSettings,
} from "../convert/plan-builder.ts";
import { resolveEffectiveSettings } from "../convert/plan-builder.ts";
import { assertTransition, isTerminal, type RunState } from "../domain/run-state.ts";
import { isMatrixMode } from "../domain/selection.ts";
import { formatUnknownError } from "./format.ts";
import { loadConfig as loadConfigWithSetName } from "./load-config.ts";
import { createLog4jsSink, type Log4jsSink, type LogLevel, LogPipeline } from "./log-pipeline.ts";
import { runConversion as executeRun, type JavaRunner, type RunSummary } from "./run.ts";
import { type AppliedOpsReport, SessionTreeState } from "./tree-state.ts";

/** 并发默认 2（旧版启动硬压 2 的语义，main.js:2574-2587），上限 16（main.js:6-9）。 */
export const DEFAULT_PARALLELISM = 2;
export const MAX_PARALLELISM = 16;

/** log4js shutdown flush 的有界等待。 */
const LOG4JS_SHUTDOWN_TIMEOUT_MS = 5000;
/** dispose 等待活动运行实际回收的上限（超时不冒充清理成功，记诊断）。 */
const DISPOSE_RUN_TIMEOUT_MS = 60_000;

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
  /** 弹框失效回调（P2-06：worker 死亡/TTL 过期/显式 dismiss 时 UI 关闭弹框）。 */
  onDialogInvalidate?: ScriptWorkerPool["onDialogInvalidate"];
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
  /** P2-05：与 config 同生共死的会话树状态（选择/展开/矩阵资格 + ops 应用）。 */
  private treeState: SessionTreeState | null = null;
  /** P4-04a：表单编辑的转换参数覆盖（updateSettings 写入，loadConfig 成功清空）。 */
  private overrides: ConversionOverrides = {};
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
    if (options.onDialogInvalidate !== undefined) {
      this.pool.onDialogInvalidate = options.onDialogInvalidate;
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
      this.treeState = new SessionTreeState(config);
      // 表单随配置重填：上次配置的 overrides 不带入新配置（P4-04a）。
      this.overrides = {};
      this.transition("ready");
      return config;
    } catch (err) {
      void this.pipeline.error(formatUnknownError(err), "CONFIG");
      this.transition("failed");
      throw err;
    }
  }

  /**
   * 当前树快照（script-invoke context.tree 的同一份数据，P2-05）。
   * UI 渲染/脚本上下文共用；未加载配置时为 null。
   */
  getTreeSnapshot(): TreeSnapshot | null {
    return this.treeState?.buildSnapshot() ?? null;
  }

  /** 当前选中 item（DFS 序；未加载配置时为空数组）。 */
  getSelectedItems(): TreeItem[] {
    return this.treeState?.getSelectedItems() ?? [];
  }

  /** 当前持有的转换参数覆盖（P4-04a；拷贝返回，外部改写不影响会话）。 */
  getOverrides(): ConversionOverrides {
    return { ...this.overrides };
  }

  /** 表单有效值（配置默认 ⊕ overrides）；未加载配置时为 null。 */
  getEffectiveSettings(): EffectiveSettings | null {
    const config = this.config;
    if (config === null) {
      return null;
    }
    return resolveEffectiveSettings(config, this.overrides);
  }

  /**
   * 合并式更新转换参数覆盖（P4-04a updateSettings 后端）。字段白名单/类型校验
   * 归 RPC 层；此处假定字段已合法。matrix 变化时对会话树重估矩阵资格
   * （multiSelected 按内容推导，与 resolveEffectiveRules 的 matrixMode 同规则；
   * 未加载树状态时跳过）。返回合并后的有效设置快照。
   */
  updateSettings(fields: ConversionOverrides): EffectiveSettings {
    const config = this.config;
    if (config === null) {
      throw new Error("updateSettings requires a loaded config (call loadConfig first)");
    }
    this.overrides = { ...this.overrides, ...fields };
    const effective = resolveEffectiveSettings(config, this.overrides);
    if (fields.matrix !== undefined && this.treeState !== null) {
      this.treeState.applyMatrixEligibility(effective.matrix, isMatrixMode(effective.matrix));
    }
    return effective;
  }

  /**
   * 应用一批脚本 ops（P2-05）。诊断与被拒绝的 op 记 warning（module "SCRIPT"）。
   * 版本失配整批拒绝（陈旧镜像的迟到写入不生效）。
   */
  applyScriptOps(ops: readonly unknown[]): AppliedOpsReport {
    const state = this.treeState;
    if (state === null) {
      return { applied: 0, rejected: [], diagnostics: [], version: 0, stateChanges: [] };
    }
    const report = state.applyScriptOps(ops);
    for (const diagnostic of report.diagnostics) {
      void this.pipeline.warning(`${diagnostic.code}: ${diagnostic.message}`, "SCRIPT");
    }
    for (const rejected of report.rejected) {
      void this.pipeline.warning(
        `script op rejected (${rejected.op}): ${rejected.reason}`,
        "SCRIPT",
      );
    }
    return report;
  }

  /**
   * 执行一次转换运行（P3-08）。要求已加载配置；终态后再运行先经
   * loading→ready 重新武装（BD-O14；状态机不允许 terminal→before_hooks 直达）。
   *
   * selection 缺省时从会话树状态派生（P2-05：脚本/矩阵资格造成的最新勾选）。
   * overrides 缺省时用会话持有的表单覆盖（P4-04a updateSettings 写入）；
   * 显式入参（含 {}）优先于会话持有值。
   * config/selection 按引用传入（不再克隆）：旧版 before 链里脚本对 item_data 的
   * 改写是活引用语义，计划构建在 before 之后必须能看到（ops 回流 treeState 与
   * config/selection 共享同一 TreeItem 对象）。
   */
  async runConversion(
    selection?: ConversionSelection,
    overrides?: ConversionOverrides,
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
    const treeState = this.treeState;
    // 显式 selection = UI 报告的勾选状态：先同步进树状态（树是镜像/快照的唯一
    // 事实来源），再冻结"哪些 item"为数组快照（调用方随后改数组不影响本次运行），
    // item 对象按引用共享（before 链脚本的字段改写对计划可见，旧版活引用语义）。
    if (selection !== undefined) {
      treeState?.replaceSelection(selection.items);
    }
    const effectiveSelection = {
      items: [...(selection ?? { items: treeState?.getSelectedItems() ?? [] }).items],
    };
    // BD-S16：append_log 的树快照在 run 开始固化一次，不随后续事件 ops 更新。
    const appendLogSnapshot = treeState?.buildSnapshot();
    this.generation++;
    this.cancelRequested = false;
    const abort = new AbortController();
    this.javaAbort = abort;
    try {
      this.activeRun = executeRun({
        config,
        selection: effectiveSelection,
        overrides: overrides ?? this.overrides,
        pool: this.pool,
        pipeline: this.pipeline,
        runner: this.runner,
        parallelism: this.parallelism,
        runSeq: this.generation,
        signal: abort.signal,
        isCancelRequested: () => this.cancelRequested,
        transition: (to) => this.transitionSoft(to),
        appendLogInvocations: this.appendLogInvocations,
        scriptContext:
          treeState === null
            ? undefined
            : {
                buildEventContext: () => ({ tree: treeState.buildSnapshot() }),
                buildAppendLogContext: () =>
                  appendLogSnapshot === undefined ? {} : { tree: appendLogSnapshot },
                applyOps: (ops) => {
                  this.applyScriptOps(ops);
                },
              },
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
    if (this.disposed) {
      return; // 幂等（EX03 同请求重投）
    }
    this.disposed = true;
    this.cancel();
    const run = this.activeRun;
    if (run !== null) {
      // 实际回收后才算清理成功：run 的 settle 发生在 runner 终止确认之后。
      // 超时不冒充成功——记诊断后继续（EX03/SC11：清理未确认必须可见）。
      const outcome = await Promise.race([
        run.then(() => "settled" as const),
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), DISPOSE_RUN_TIMEOUT_MS),
        ),
      ]);
      if (outcome === "timeout") {
        void this.pipeline.error(
          `dispose: active run cleanup unconfirmed within ${String(DISPOSE_RUN_TIMEOUT_MS)}ms`,
          "CONV",
          { bypassHooks: true },
        );
      }
    }
    this.pipeline.hookRunner = null;
    await this.pipeline.drain();
    if (this.log4jsSink !== null) {
      await this.log4jsSink.shutdown(LOG4JS_SHUTDOWN_TIMEOUT_MS);
    }
  }

  /**
   * 重置（EX03/P3-08）：业务操作而非直接清变量——有活动运行先取消并等待
   * 实际回收（run settle 发生在 runner 终止确认之后），再清运行期状态并
   * 经 loading→ready 重新武装（BD-O14；配置保留，重载走 loadConfig）。
   * 幂等；旧运行的迟到回包由 treeState 版本闸与 worker 侧 exactly-once
   * 拦截（SC10，见 P2-05/P2-06 记录），reset 本身不重放任何任务。
   */
  async reset(): Promise<{ cancelledRun: boolean }> {
    if (this.disposed) {
      throw new Error("session is disposed");
    }
    const run = this.activeRun;
    this.cancel();
    if (run !== null) {
      await run; // 等待实际回收（java 树终止 + 日志 drain 完成）
    }
    this.appendLogInvocations.clear();
    this.cancelRequested = false;
    if (isTerminal(this.state)) {
      this.transition("loading");
      this.transition("ready");
    }
    return { cancelledRun: run !== null };
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
