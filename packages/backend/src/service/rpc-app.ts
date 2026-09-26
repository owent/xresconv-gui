/**
 * Backend 业务 RPC 面（P4-02）：壳 → guardian → backend 的请求入口与事件源。
 *
 * BackendRpcApp 持有 ScriptWorkerPool 与 ConversionSession（各一，会话级），
 * 把 packages/contracts/schema/backend-rpc.json 定义的方法集映射到会话操作：
 *
 * - loadConfig {path} / reload {}：加载/重载配置（运行中拒绝，INVALID_STATE；
 *   解析失败 CONFIG_ERROR），成功后返回完整快照（成功时清空 overrides，表单随配置重填）；
 * - getSnapshot {}：{state, runSeq, config, tree, selectedItems, settings}；
 * - applyOps {ops}：脚本 ops 应用到会话树（版本闸在 SessionTreeState，P2-05）；
 * - updateSettings {fields}：合并式写入转换参数覆盖（P4-04a；白名单逐字段类型校验，
 *   未知键/错类型 → INVALID_PARAMS；未加载/运行中 → INVALID_STATE），返回
 *   {overrides, effective, parallelism}（配置默认 ⊕ 覆盖的全量有效值）；matrix 变化
 *   触发会话树矩阵资格重估；parallelism（P4-04b）为会话级并发数（number，有限校验，
 *   取整夹取 [1,16]），不进 overrides；
 * - preview {}：当前选择 + 当前覆盖构建转换计划预览（P4-04a；未加载 → INVALID_STATE；
 *   计划构建错误按其 code 透传，如 XRESLOADER_NOT_FOUND），返回任务列表与
 *   (outputDir, rename) 分组的输出冲突（UI04）；
 * - run {}：异步启动一次转换（缺省用会话持有的 overrides），立即返回 {runSeq}，
 *   进度/结果经事件流（state_change / log / run_end）上报；
 * - cancel {} / reset {}：取消当前运行 / 业务级重置（EX03 语义在会话层）；
 * - respondDialog {token, choice}：应答脚本弹框（P2-06 注册表在 pool；迟到/
 *   未知 token 按 SC06 丢弃，返回 {answered:false} 而非报错）。
 * - setHookEnabled {group, index, enabled}：事件 hook 开关（P4-05a，F09；
 *   group ∈ before/after/append_log；未加载 → INVALID_STATE；越界/匿名/
 *   immutable → INVALID_PARAMS；无运行状态门禁——旧版复选框全程可改）。
 * - setCustomSelectors {files}：设置/重读自定义选择器文件（P4-05a；错误条目
 *   随视图返回并记 CUSTOM SELECTOR 日志；已加载树时重放 default_selected），
 *   返回 {selectors}；无运行状态门禁（CLI 顺序允许先于 loadConfig）。
 * - invokeCustomButton {name}：自定义按钮点击（P4-05a；未知 → INVALID_PARAMS；
 *   动作链失败记日志并中止），返回 {ok, error?}。
 * 快照 customSelectors 字段：未设置时为 null，设置后为选择器视图数组。
 *
 * 错误约定：可预期失败抛 {@link RpcError}（code 见 backend-rpc schema 描述），
 * 由 bin 映射为 {ok:false, error:{code,message}}；handleRpc 不把异常漏进通道。
 *
 * 事件：onEvent 订阅 {type:"log"|"state_change"|"dialog_request"|
 * "dialog_invalidate"|"run_end"|"diagnostic", ...}，bin 原样包成
 * kind "event"（source:"backend"）经 guardian 转发给壳。
 */

import type { BackendRpc, Envelope } from "@xresconv/contracts";
import type { DialogChoice, ScriptWorkerPool } from "@xresconv/guardian";
import type { OutputMatrixRule, ParsedConfig } from "../config/model.ts";
import {
  buildConversionPlan,
  type ConversionOverrides,
  type ConversionPlan,
  type EffectiveSettings,
  PlanBuildError,
} from "../convert/plan-builder.ts";
import { isTerminal, type RunState } from "../domain/run-state.ts";
import type { CustomSelectorView } from "./custom-selector.ts";
import { formatUnknownError } from "./format.ts";
import { checkJavaEnvironment, JAVA_DOWNLOAD_HINTS } from "./java-env.ts";
import type { LogEntry } from "./log-pipeline.ts";
import type { MatcherService } from "./matcher-service.ts";
import type { JavaRunner, RunSummary } from "./run.ts";
import { ConversionSession } from "./session.ts";
import type { AppliedOpsReport } from "./tree-state.ts";

/** backend-rpc schema 的方法枚举（单一事实源在 schema；此处取生成类型的子类型）。 */
export type BackendRpcMethod = Extract<BackendRpc, { type: "request" }>["method"];

/** backend 侧 RPC 错误码（guardian 侧 BACKEND_* 码见 backend-supervisor.ts）。
 * XRESLOADER_NOT_FOUND 来自计划构建（P4-04a preview；code 为自由字符串词表）。 */
export type RpcErrorCode =
  | "INVALID_PARAMS"
  | "UNKNOWN_METHOD"
  | "INVALID_STATE"
  | "CONFIG_ERROR"
  | "XRESLOADER_NOT_FOUND"
  | "INTERNAL";

/** 可预期的 RPC 失败；bin 按 code/message 组装 error 结果，不走通道 fault。 */
export class RpcError extends Error {
  readonly code: RpcErrorCode;

  constructor(code: RpcErrorCode, message: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

/** 表单设置视图（P4-04a）：当前覆盖 + 配置默认 ⊕ 覆盖的有效值（未加载配置时 effective 为 null）。
 * P4-04b：parallelism 为会话级并发数（不进 overrides，归 ConversionSession 持有）。 */
export interface SettingsView {
  overrides: ConversionOverrides;
  effective: EffectiveSettings | null;
  parallelism: number;
}

/** preview 的单任务视图（UI04：display 为旧式单行展示串）。 */
export interface PreviewTask {
  itemKey?: string;
  outputDir?: string;
  display: string;
}

/** preview 的输出冲突（同 (outputDir, rename) 分组的 >1 任务；items 为 item 名）。 */
export interface PreviewConflict {
  outputDir: string;
  rename: string;
  items: string[];
}

/** preview 的结果形状。 */
export interface PreviewResult {
  plan: {
    workDir: string;
    xresloaderPath: string;
    taskCount: number;
    tasks: PreviewTask[];
  };
  selectionCount: number;
  conflicts: PreviewConflict[];
}

/** getSnapshot / loadConfig / reload 的返回形状。 */
export interface BackendSnapshot {
  state: RunState;
  runSeq: number;
  config: ParsedConfig | null;
  tree: ReturnType<ConversionSession["getTreeSnapshot"]>;
  selectedItems: ReturnType<ConversionSession["getSelectedItems"]>;
  settings: SettingsView;
  /** P4-05a：自定义选择器/按钮视图（未 setCustomSelectors 时为 null）。 */
  customSelectors: CustomSelectorView[] | null;
}

/** 发往壳的事件（bin 加 source:"backend" 后作为 kind "event" payload 转发）。 */
export type BackendAppEvent =
  | { type: "log"; entry: LogEntry }
  | { type: "state_change"; state: RunState; previous: RunState }
  | { type: "dialog_request"; token: string; dialog: Envelope["payload"] }
  | { type: "dialog_invalidate"; token: string; reason: string }
  | { type: "run_end"; summary: RunSummary }
  | { type: "diagnostic"; message: string };

export interface BackendRpcAppOptions {
  /** 会话共享的 script worker 池；app 负责 start/dispose（一次性）。 */
  pool: ScriptWorkerPool;
  /** Java 批量执行器；默认 guardian runJavaBatch（测试注入 fake）。 */
  runner?: JavaRunner;
  /** 转表并发数（语义同 ConversionSession）。 */
  parallelism?: number;
  /** set_name 单条超时（毫秒）。 */
  setNameTimeoutMs?: number;
  /** 选择器匹配的隔离 matcher 工厂（P4-05a）；缺省真实 MatcherService（懒创建）。 */
  matcherFactory?: () => MatcherService;
  /** log4js 落盘配置路径（F10/F11 --log-configure；缺省用内置默认配置）。 */
  log4jsConfigurePath?: string;
}

/** 弹框 token 推导与 pool 的注册表键一致（P2-06：payload.token，缺省回退 env.id）。 */
function dialogToken(env: Envelope): string {
  const token = env.payload.token;
  return typeof token === "string" && token.length > 0 ? token : env.id;
}

function asParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  if (params === undefined) {
    return {};
  }
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new RpcError("INVALID_PARAMS", "rpc params must be an object");
  }
  return params;
}

/** updateSettings 字段白名单（P4-04a）：标量字段（string）。 */
const STRING_SETTING_FIELDS = [
  "workDir",
  "xresloaderPath",
  "proto",
  "dataVersion",
  "outputDir",
  "rename",
  "type",
] as const;
/** updateSettings 字段白名单：多值字段（string[]，新 UI 直给数组；不复活旧版 JSON 串编码）。 */
const STRING_ARRAY_SETTING_FIELDS = ["protoFile", "dataSrcDir"] as const;
/** 矩阵规则允许的键（OutputMatrixRule 形状）。 */
const MATRIX_RULE_KEYS = ["type", "rename", "outputDir", "tags", "classes"] as const;

/** getLogs 单次返回上限（P4-07；UI 分页按此粒度拉取）。 */
const GET_LOGS_MAX_LIMIT = 1000;

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new RpcError("INVALID_PARAMS", `updateSettings fields.${label} must be string[]`);
  }
  return [...value];
}

function asMatrixRule(value: unknown, index: number): OutputMatrixRule {
  const label = `fields.matrix[${String(index)}]`;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RpcError("INVALID_PARAMS", `updateSettings ${label} must be an object`);
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!(MATRIX_RULE_KEYS as readonly string[]).includes(key)) {
      throw new RpcError("INVALID_PARAMS", `updateSettings ${label}: unknown key "${key}"`);
    }
  }
  const rule: OutputMatrixRule = { tags: [], classes: [] };
  for (const key of ["type", "rename", "outputDir"] as const) {
    const v = raw[key];
    if (v !== undefined) {
      if (typeof v !== "string") {
        throw new RpcError("INVALID_PARAMS", `updateSettings ${label}.${key} must be a string`);
      }
      rule[key] = v;
    }
  }
  for (const key of ["tags", "classes"] as const) {
    const v = raw[key];
    if (v !== undefined) {
      rule[key] = asStringArray(v, `matrix[${String(index)}].${key}`);
    }
  }
  return rule;
}

/** validateSettingsFields 的分流结果（P4-04b）：parallelism 属会话级设置，不进 ConversionOverrides。 */
interface ParsedSettingsFields {
  overrides: ConversionOverrides;
  parallelism?: number;
}

/** updateSettings 的 fields 校验：白名单 + 逐字段类型，未知键/错类型 → INVALID_PARAMS。 */
function validateSettingsFields(value: unknown): ParsedSettingsFields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RpcError("INVALID_PARAMS", "updateSettings requires params.fields (object)");
  }
  const fields: ConversionOverrides = {};
  let parallelism: number | undefined;
  for (const [key, v] of Object.entries(value)) {
    if (key === "parallelism") {
      // 会话级并发数（P4-04b）：number 且有限；取整/夹取 [1,16] 归 ConversionSession。
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new RpcError(
          "INVALID_PARAMS",
          "updateSettings fields.parallelism must be a finite number",
        );
      }
      parallelism = v;
    } else if ((STRING_SETTING_FIELDS as readonly string[]).includes(key)) {
      if (typeof v !== "string") {
        throw new RpcError("INVALID_PARAMS", `updateSettings fields.${key} must be a string`);
      }
      (fields as Record<string, unknown>)[key] = v;
    } else if ((STRING_ARRAY_SETTING_FIELDS as readonly string[]).includes(key)) {
      (fields as Record<string, unknown>)[key] = asStringArray(v, key);
    } else if (key === "matrix") {
      if (!Array.isArray(v)) {
        throw new RpcError("INVALID_PARAMS", "updateSettings fields.matrix must be an array");
      }
      fields.matrix = v.map((rule, index) => asMatrixRule(rule, index));
    } else {
      throw new RpcError("INVALID_PARAMS", `updateSettings fields: unknown key "${key}"`);
    }
  }
  return parallelism === undefined ? { overrides: fields } : { overrides: fields, parallelism };
}

export class BackendRpcApp {
  private readonly pool: ScriptWorkerPool;
  private readonly session: ConversionSession;
  private readonly listeners = new Set<(event: BackendAppEvent) => void>();
  /** token → pool 应答函数（P2-06 respond；已失效/已应答条目即删）。 */
  private readonly pendingDialogs = new Map<string, (choice: DialogChoice) => void>();
  private startPromise: Promise<void> | null = null;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;

  constructor(options: BackendRpcAppOptions) {
    this.pool = options.pool;
    this.session = new ConversionSession({
      pool: options.pool,
      ...(options.runner === undefined ? {} : { runner: options.runner }),
      ...(options.parallelism === undefined ? {} : { parallelism: options.parallelism }),
      ...(options.setNameTimeoutMs === undefined
        ? {}
        : { setNameTimeoutMs: options.setNameTimeoutMs }),
      ...(options.matcherFactory === undefined ? {} : { matcherFactory: options.matcherFactory }),
      ...(options.log4jsConfigurePath === undefined
        ? {}
        : { log4js: { configurePath: options.log4jsConfigurePath } }),
      onDialogRequest: (env, respond) => this.handleDialogRequest(env, respond),
      onDialogInvalidate: (env, reason) => this.handleDialogInvalidate(env, reason),
    });
    this.session.onStateChange = (state, previous) => {
      this.emit({ type: "state_change", state, previous });
    };
    this.session.pipeline.subscribe((entry) => {
      this.emit({ type: "log", entry });
    });
  }

  /** 启动 worker 池（幂等）；池启动失败时后续 handleRpc 以同一拒绝失败。 */
  start(): Promise<void> {
    if (this.startPromise === null) {
      this.startPromise = this.pool.start();
      // 池启动失败必须可见（SC11）；handleRpc 侧的 await 会拿到同一拒绝。
      this.startPromise.catch((err: unknown) => {
        this.emit({
          type: "diagnostic",
          message: `script worker pool start failed: ${formatUnknownError(err)}`,
        });
      });
    }
    return this.startPromise;
  }

  /** 订阅事件；返回退订函数。监听器异常不阻断业务。 */
  onEvent(listener: (event: BackendAppEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 当前快照（未加载配置时 config/tree 为 null、selectedItems 为空、settings.effective 为 null）。 */
  snapshot(): BackendSnapshot {
    return structuredClone({
      state: this.session.getState(),
      runSeq: this.session.getRunSeq(),
      config: this.session.getConfig(),
      tree: this.session.getTreeSnapshot(),
      selectedItems: this.session.getSelectedItems(),
      settings: {
        overrides: this.session.getOverrides(),
        effective: this.session.getEffectiveSettings(),
        parallelism: this.session.getParallelism(),
      },
      customSelectors: this.session.getCustomSelectorViews(),
    });
  }

  /**
   * 分发一次 RPC。可预期失败抛 RpcError；未知错误原样抛出（bin 兜底 INTERNAL）。
   */
  async handleRpc(
    method: BackendRpcMethod | (string & {}),
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.disposed) {
      throw new RpcError("INVALID_STATE", "backend rpc app is disposed");
    }
    const p = asParams(params);
    switch (method) {
      case "loadConfig":
        return this.rpcLoadConfig(p);
      case "reload":
        return this.rpcReload();
      case "getSnapshot":
        return this.snapshot();
      case "applyOps":
        return this.rpcApplyOps(p);
      case "updateSettings":
        return this.rpcUpdateSettings(p);
      case "preview":
        return this.rpcPreview();
      case "run":
        return this.rpcRun();
      case "cancel":
        this.session.cancel();
        return { state: this.session.getState() };
      case "reset":
        await this.start();
        return await this.session.reset();
      case "getLogs":
        return this.rpcGetLogs(p);
      case "respondDialog":
        return this.rpcRespondDialog(p);
      case "setHookEnabled":
        return this.rpcSetHookEnabled(p);
      case "setCustomSelectors":
        return await this.rpcSetCustomSelectors(p);
      case "invokeCustomButton":
        return await this.rpcInvokeCustomButton(p);
      case "checkJava":
        return await this.rpcCheckJava();
      default:
        throw new RpcError("UNKNOWN_METHOD", `unknown rpc method: ${method}`);
    }
  }

  /** 收尾：会话 dispose（有界）后关 worker 池。幂等。 */
  dispose(): Promise<void> {
    if (this.disposePromise !== null) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = (async () => {
      try {
        await this.session.dispose();
      } finally {
        await this.pool.shutdown();
      }
    })();
    return this.disposePromise;
  }

  /** 运行中（含加载中）不允许的动作统一在此拦截。 */
  private assertIdleLike(action: string): void {
    if (this.disposed) {
      throw new RpcError("INVALID_STATE", "backend rpc app is disposed");
    }
    const state = this.session.getState();
    if (
      this.session.hasActiveRun() ||
      state === "loading" ||
      state === "before_hooks" ||
      state === "converting" ||
      state === "after_hooks"
    ) {
      throw new RpcError("INVALID_STATE", `cannot ${action} while session is ${state}`);
    }
  }

  private async rpcLoadConfig(params: Record<string, unknown>): Promise<BackendSnapshot> {
    const path = params.path;
    if (typeof path !== "string" || path.length === 0) {
      throw new RpcError("INVALID_PARAMS", "loadConfig requires params.path (non-empty string)");
    }
    this.assertIdleLike("load config");
    await this.start();
    this.assertIdleLike("load config");
    try {
      await this.session.loadConfig(path);
    } catch (err) {
      throw new RpcError("CONFIG_ERROR", formatUnknownError(err));
    }
    return this.snapshot();
  }

  private async rpcReload(): Promise<BackendSnapshot> {
    const config = this.session.getConfig();
    if (config === null) {
      throw new RpcError("INVALID_STATE", "reload requires a loaded config");
    }
    this.assertIdleLike("reload config");
    await this.start();
    this.assertIdleLike("reload config");
    try {
      await this.session.loadConfig(config.path);
    } catch (err) {
      throw new RpcError("CONFIG_ERROR", formatUnknownError(err));
    }
    return this.snapshot();
  }

  private rpcApplyOps(params: Record<string, unknown>): AppliedOpsReport {
    this.assertIdleLike("apply UI operations");
    const ops = params.ops;
    if (!Array.isArray(ops)) {
      throw new RpcError("INVALID_PARAMS", "applyOps requires params.ops (array)");
    }
    // 版本闸与逐 op 校验在 SessionTreeState（P2-05）；未加载配置时为空报告。
    return this.session.applyScriptOps(ops);
  }

  /**
   * updateSettings（P4-04a/P4-04b）：合并写入表单覆盖，返回 {overrides, effective, parallelism}。
   * parallelism 为会话级设置（不写进 overrides），与其余字段同发时两者都生效。
   */
  private rpcUpdateSettings(params: Record<string, unknown>): SettingsView {
    if (this.session.getConfig() === null) {
      throw new RpcError("INVALID_STATE", "updateSettings requires a loaded config");
    }
    this.assertIdleLike("update settings");
    const { overrides, parallelism } = validateSettingsFields(params.fields);
    if (parallelism !== undefined) {
      this.session.setParallelism(parallelism);
    }
    const effective = this.session.updateSettings(overrides);
    return {
      overrides: this.session.getOverrides(),
      effective,
      parallelism: this.session.getParallelism(),
    };
  }

  /**
   * preview（P4-04a，UI04）：当前选择 + 当前覆盖构建计划预览。
   * PlanBuildError 按其 code 透传（如 XRESLOADER_NOT_FOUND），details 进 message 可读串。
   */
  private rpcPreview(): PreviewResult {
    const config = this.session.getConfig();
    if (config === null) {
      throw new RpcError("INVALID_STATE", "preview requires a loaded config (loadConfig first)");
    }
    const items = this.session.getSelectedItems();
    let plan: ConversionPlan;
    try {
      plan = buildConversionPlan(config, { items }, this.session.getOverrides());
    } catch (err) {
      if (err instanceof PlanBuildError) {
        const details =
          err.details === undefined
            ? ""
            : ` (${Object.entries(err.details)
                .map(([key, value]) => `${key}=${String(value)}`)
                .join(", ")})`;
        throw new RpcError(err.code as RpcErrorCode, `${err.message}${details}`);
      }
      throw new RpcError("CONFIG_ERROR", formatUnknownError(err));
    }
    // 输出冲突（UI04）：同 (outputDir, rename) 分组内 >1 任务。
    const groups = new Map<string, PreviewConflict & { count: number }>();
    for (const task of plan.tasks) {
      const outputDir = task.outputDir ?? "";
      const rename = task.rename ?? "";
      const key = JSON.stringify([outputDir, rename]);
      let group = groups.get(key);
      if (group === undefined) {
        group = { outputDir, rename, items: [], count: 0 };
        groups.set(key, group);
      }
      group.count++;
      const name = task.itemKey ?? "";
      if (!group.items.includes(name)) {
        group.items.push(name);
      }
    }
    return {
      plan: {
        workDir: plan.workDir,
        xresloaderPath: plan.xresloaderPath,
        taskCount: plan.tasks.length,
        tasks: plan.tasks.map((task) => ({
          itemKey: task.itemKey,
          outputDir: task.outputDir,
          display: task.display,
        })),
      },
      selectionCount: items.length,
      conflicts: [...groups.values()]
        .filter((group) => group.count > 1)
        .map(({ outputDir, rename, items: names }) => ({ outputDir, rename, items: names })),
    };
  }

  /**
   * getLogs（P4-07，UI07 日志游标）：返回内存队列日志窗口（含 seq），与事件流
   * log 条目按 seq 幂等对齐；droppedCount/capacity 供 UI 展示丢弃量。
   * beforeSeq 缺省 = 最新窗口；给定时返回 seq < beforeSeq 的更早窗口（滚动加载
   * 历史）。无状态门禁——日志面独立于配置会话（未加载配置也可查）。
   */
  private rpcGetLogs(params: Record<string, unknown>): {
    entries: LogEntry[];
    droppedCount: number;
    capacity: number;
  } {
    let limit = GET_LOGS_MAX_LIMIT;
    if (params.limit !== undefined) {
      const value = params.limit;
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > GET_LOGS_MAX_LIMIT
      ) {
        throw new RpcError(
          "INVALID_PARAMS",
          `getLogs limit must be an integer in [1, ${GET_LOGS_MAX_LIMIT}]`,
        );
      }
      limit = value;
    }
    let beforeSeq: number | undefined;
    if (params.beforeSeq !== undefined) {
      const value = params.beforeSeq;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        throw new RpcError("INVALID_PARAMS", "getLogs beforeSeq must be a positive integer");
      }
      beforeSeq = value;
    }
    const pipeline = this.session.pipeline;
    return {
      entries: structuredClone(
        beforeSeq === undefined
          ? pipeline.getRecent(limit)
          : pipeline.getRecentBefore(beforeSeq, limit),
      ),
      droppedCount: pipeline.droppedCount,
      capacity: pipeline.capacity,
    };
  }

  /**
   * checkJava（F06/F12，旧版 conv_env_check 恢复）：java -version 探测 +
   * 版本/位数判定 + 下载指引。无状态门禁（启动即可查）；实际转换用同一
   * 解析（XRESCONV_JAVA/JAVA_HOME/PATH，java-runner 共用 resolveJavaExecutable）。
   */
  private async rpcCheckJava(): Promise<{
    ok: boolean;
    versionText: string;
    versions: number[];
    bit64: boolean;
    executable: { command: string; source: string };
    problem: string | null;
    downloadHints: readonly { name: string; url: string }[];
  }> {
    const result = await checkJavaEnvironment();
    return {
      ok: result.ok,
      versionText: result.versionText,
      versions: result.versions,
      bit64: result.bit64,
      executable: result.executable,
      problem: result.problem,
      downloadHints: JAVA_DOWNLOAD_HINTS,
    };
  }

  private async rpcRun(): Promise<{ runSeq: number }> {
    if (this.session.getConfig() === null) {
      throw new RpcError("INVALID_STATE", "run requires a loaded config (loadConfig first)");
    }
    const state = this.session.getState();
    if (state !== "ready" && !isTerminal(state)) {
      throw new RpcError("INVALID_STATE", `cannot start a run from state "${state}"`);
    }
    // run 的 before 链即需 worker：先确保池已启动（start 幂等）。
    await this.start();
    this.assertIdleLike("start a run");
    // runConversion 在首个 await 前同步完成校验、generation++ 与 before_hooks 迁移，
    // 故调用返回后 runSeq 已是本次代际；预检保证不会因状态违例即刻 reject。
    const run = this.session.runConversion();
    const runSeq = this.session.getRunSeq();
    run.then(
      (summary) => this.emit({ type: "run_end", summary }),
      (err: unknown) =>
        this.emit({
          type: "diagnostic",
          message: `run settled with unexpected rejection: ${formatUnknownError(err)}`,
        }),
    );
    return { runSeq };
  }

  private rpcRespondDialog(params: Record<string, unknown>): { answered: boolean } {
    const token = params.token;
    const choice = params.choice;
    if (typeof token !== "string" || token.length === 0) {
      throw new RpcError(
        "INVALID_PARAMS",
        "respondDialog requires params.token (non-empty string)",
      );
    }
    if (choice !== "yes" && choice !== "no" && choice !== null) {
      throw new RpcError("INVALID_PARAMS", `respondDialog choice must be "yes" | "no" | null`);
    }
    const respond = this.pendingDialogs.get(token);
    if (respond === undefined) {
      // 迟到/未知应答：弹框已失效或从未存在（SC06 丢弃语义），非协议错误。
      return { answered: false };
    }
    this.pendingDialogs.delete(token);
    respond(choice);
    return { answered: true };
  }

  /**
   * setHookEnabled（P4-05a，F09）：事件 hook 开关。无运行状态门禁（旧版复选框
   * 全程可改），仅需已加载配置；hook 定位失败（越界/匿名/immutable）是会话层
   * Error，此处统一映射为 INVALID_PARAMS（调用方可修正的参数错误）。
   */
  private rpcSetHookEnabled(params: Record<string, unknown>): { enabled: boolean } {
    if (this.session.getConfig() === null) {
      throw new RpcError("INVALID_STATE", "setHookEnabled requires a loaded config");
    }
    const group = params.group;
    if (group !== "before" && group !== "after" && group !== "append_log") {
      throw new RpcError(
        "INVALID_PARAMS",
        `setHookEnabled group must be "before" | "after" | "append_log"`,
      );
    }
    const index = params.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      throw new RpcError("INVALID_PARAMS", "setHookEnabled index must be a non-negative integer");
    }
    const enabled = params.enabled;
    if (typeof enabled !== "boolean") {
      throw new RpcError("INVALID_PARAMS", "setHookEnabled enabled must be a boolean");
    }
    try {
      this.session.setHookEnabled(group, index, enabled);
    } catch (err) {
      throw new RpcError("INVALID_PARAMS", formatUnknownError(err));
    }
    return { enabled };
  }

  /**
   * setCustomSelectors（P4-05a）：设置/重读自定义选择器文件，返回视图数组。
   * 无运行状态门禁：CLI 顺序允许先于 loadConfig；已加载树时会话层重放
   * default_selected。错误条目随视图返回（不拒绝整批）。
   */
  private async rpcSetCustomSelectors(
    params: Record<string, unknown>,
  ): Promise<{ selectors: CustomSelectorView[] }> {
    const files = params.files;
    if (!Array.isArray(files) || files.some((file) => typeof file !== "string")) {
      throw new RpcError("INVALID_PARAMS", "setCustomSelectors requires params.files (string[])");
    }
    return { selectors: await this.session.setCustomSelectors(files) };
  }

  /**
   * invokeCustomButton（P4-05a）：自定义按钮点击。未知按钮名先经快照视图校验
   * （INVALID_PARAMS）；动作链失败不算 RPC 错误，返回 {ok:false, error}；
   * 会话/matcher 结构性失败原样上抛（bin 兜底 INTERNAL，不误报为参数错误）。
   */
  private async rpcInvokeCustomButton(
    params: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string }> {
    const name = params.name;
    if (typeof name !== "string" || name.length === 0) {
      throw new RpcError(
        "INVALID_PARAMS",
        "invokeCustomButton requires params.name (non-empty string)",
      );
    }
    const known = (this.session.getCustomSelectorViews() ?? []).some((view) => view.name === name);
    if (!known) {
      throw new RpcError("INVALID_PARAMS", `unknown custom button: ${name}`);
    }
    return await this.session.invokeCustomButton(name);
  }

  private handleDialogRequest(env: Envelope, respond: (choice: DialogChoice) => void): void {
    const token = dialogToken(env);
    this.pendingDialogs.set(token, respond);
    this.emit({ type: "dialog_request", token, dialog: env.payload });
  }

  private handleDialogInvalidate(env: Envelope, reason: string): void {
    const token = dialogToken(env);
    this.pendingDialogs.delete(token);
    this.emit({ type: "dialog_invalidate", token, reason });
  }

  private emit(event: BackendAppEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 监听器（转发层）故障不阻断业务面。
      }
    }
  }
}
