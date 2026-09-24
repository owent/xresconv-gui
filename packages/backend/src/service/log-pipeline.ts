/**
 * 日志管线（P2-08 backend 侧 + P3-09）。
 *
 * 对齐旧版 logger_append_*（main.js:166-330）：
 * - 级别→样式：info→alert-secondary（main.js:245）、notice→alert-primary（main.js:263）、
 *   warning→alert-warning（main.js:283）、error→alert-danger（main.js:304）。
 * - 渲染形态 text = `[module]: message`（main.js:216-226 的 innerText），写 log4js 用同一文本
 *   （main.js:247-257 等 `log.<level>(ret.innerText)`）。
 * - Error 实例一律重路由为 error 级并取 stack（main.js:238-244 等）。
 * - on_append_log：同一条日志按文档序经过全部启用 hook，log_object（{message, module_name,
 *   style}，main.js:169-174）贯穿——前一 hook 的 set_log_fields 合并进后一 hook 输入；
 *   hook 异常 → 剩余 hook 跳过、已改字段保留（main.js:205-212）。hook 仅在
 *   append_log_context 窗口（conv_start 链期间，main.js:2299/2424）生效，由调用方
 *   设置/清除 {@link LogPipeline.hookRunner}。
 * - 递归保护：hook 内 log_* 产出不再进入 hook 链。旧版用同步 guard 布尔
 *   （main.js:182/214）；新版 hook 经 worker IPC 异步执行，由调用方按 invocation_id
 *   判定并传 `bypassHooks`（BD-O11）。
 *
 * 与旧版的结构性差异（BD-O10）：旧版无界 DOM 追加；新版内存队列为有界环形
 * （默认 {@link DEFAULT_LOG_CAPACITY}），溢出丢弃最老并累计 droppedCount，同时向
 * 监听器/落盘 sink 直发一条 "LOG" 诊断（诊断本身不进队列，避免递归驱逐）。
 * log4js 在独立进程落盘；队列或单条大小超限会诊断未落盘，不能承诺过载时完整日志。
 *
 * hook 处理是异步 IPC：append() 经尾链串行化，保证条目按到达顺序进 hook 链并按序
 * 落队；hook 队列溢出的条目保留原文并立即落队，可能先于在途 hook；
 * bypass 的条目（hook 内产出）立即落队——与旧版一致（hook 内日志先于
 * 被 hook 的日志渲染，main.js:182-214）。
 */

import { formatUnknownError } from "./format.ts";

export type LogLevel = "info" | "notice" | "warning" | "error";

/** 级别→旧版 Bootstrap 样式（main.js:245/263/283/304）。 */
const LEVEL_STYLE: Record<LogLevel, string> = {
  info: "alert-secondary",
  notice: "alert-primary",
  warning: "alert-warning",
  error: "alert-danger",
};

/** 一条已落队的日志。 */
export interface LogEntry {
  readonly message: string;
  /** Original text before the script hook (for diagnostics and export). */
  readonly rawMessage: string;
  /** 模块名；缺省为 ""（main.js:171 `module_name || ""`）。 */
  readonly moduleName: string;
  /** 旧版样式类名（alert-*），hook 可改写。 */
  readonly style: string;
  readonly level: LogLevel;
  /** 渲染形态 `[module]: message`（module 为空时仅 message），与写 log4js 的文本一致。 */
  readonly text: string;
}

/**
 * on_append_log 的可改日志对象（main.js:169-174 的 log_object）。
 * hook 可能写入任意 JSON 值/删键，字段统一为 unknown，落队时归一化为 string。
 */
export interface LogObject {
  message: unknown;
  module_name: unknown;
  style: unknown;
}

/**
 * on_append_log 链执行器：顺序经过全部启用 hook，直接原地改写 logObject。
 * 由运行编排层（run.ts）在 append_log_context 窗口内构造并挂到 pipeline。
 * 契约：不抛出（worker 级失败已内部记账）；异常由 pipeline 兜底隔离。
 */
export type LogHookRunner = (logObject: LogObject) => Promise<void>;

export interface AppendLogInput {
  message: unknown;
  level: LogLevel;
  moduleName?: string;
}

export interface AppendLogOptions {
  /** 跳过 on_append_log 链（hook 内产出 / worker 自诊断）。 */
  bypassHooks?: boolean;
  /** Persistence diagnostics must not recursively re-enter a failed sink. */
  bypassSinks?: boolean;
}

/** 内存队列默认容量（BD-O10）。 */
export const DEFAULT_LOG_CAPACITY = 10000;

interface NormalizedLog {
  message: string;
  moduleName: string;
  style: string;
  level: LogLevel;
}

function buildEntry(log: NormalizedLog): LogEntry {
  const text = log.moduleName === "" ? log.message : `[${log.moduleName}]: ${log.message}`;
  return { ...log, rawMessage: log.message, text };
}

export class LogPipeline {
  readonly capacity: number;
  /** 因溢出被丢弃的最老条目总数（BD-O10）。 */
  droppedCount = 0;
  /** on_append_log 链执行器；非 null 即 append_log_context 窗口（main.js:2299/2424）。 */
  hookRunner: LogHookRunner | null = null;

  private entries: LogEntry[] = [];
  private readonly listeners = new Set<(entry: LogEntry) => void>();
  private readonly sinks = new Set<(entry: LogEntry) => void>();
  private tail: Promise<unknown> = Promise.resolve();
  private pendingHooks = 0;
  hookSkippedCount = 0;

  constructor(options: { capacity?: number } = {}) {
    this.capacity = Math.max(1, Math.floor(options.capacity ?? DEFAULT_LOG_CAPACITY));
    if (!Number.isSafeInteger(this.capacity)) throw new RangeError("log capacity must be finite");
  }

  /** 订阅落队通知（UI 追加渲染）。返回退订函数。 */
  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 挂载落盘等旁路 sink（log4js）。返回卸载函数。 */
  addSink(sink: (entry: LogEntry) => void): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  /** 当前内存队列快照（有界，最老在前）。 */
  snapshot(): LogEntry[] {
    return [...this.entries];
  }

  /** 等待所有在途 hook 链处理完成（测试与收尾用，有界性由调用方超时保证）。 */
  async drain(): Promise<void> {
    await this.tail;
  }

  append(input: AppendLogInput, options?: AppendLogOptions): Promise<LogEntry> {
    // Error 实例一律重路由 error（main.js:238-244 等）。
    let level = input.level;
    let message: string;
    if (input.message instanceof Error) {
      level = "error";
      message = formatUnknownError(input.message);
    } else {
      message = String(input.message);
    }
    const base: NormalizedLog = {
      message,
      moduleName: input.moduleName ?? "",
      style: LEVEL_STYLE[level],
      level,
    };

    const runner = this.hookRunner;
    const overflow =
      runner !== null && options?.bypassHooks !== true && this.pendingHooks >= this.capacity;
    if (overflow) {
      this.hookSkippedCount++;
      if (this.hookSkippedCount === 1)
        this.emit(
          buildEntry({
            message: "log hook queue full: subsequent overflow records retain raw text",
            moduleName: "LOG",
            style: LEVEL_STYLE.warning,
            level: "warning",
          }),
        );
    }
    if (options?.bypassHooks === true || runner === null || overflow) {
      const entry = buildEntry(base);
      this.commit(entry, options?.bypassSinks);
      return Promise.resolve(entry);
    }

    // 尾链串行化：日志按到达顺序逐条进 hook 链（旧版同步执行天然有序）。
    this.pendingHooks++;
    const processed: Promise<LogEntry> = this.tail.then(async () => {
      const logObject: LogObject = {
        message: base.message,
        module_name: base.moduleName,
        style: base.style,
      };
      try {
        await runner(logObject);
      } catch (err) {
        // runner 契约是不抛；兜底隔离，单条日志的编排故障不炸管线。
        this.commit(
          buildEntry({
            message: `log hook runner failure: ${formatUnknownError(err)}`,
            moduleName: "LOG",
            style: LEVEL_STYLE.error,
            level: "error",
          }),
        );
      }
      return buildEntry({
        message: String(logObject.message ?? ""),
        moduleName: String(logObject.module_name ?? ""),
        style: String(logObject.style ?? base.style),
        level: base.level,
      });
    });
    const committed = processed
      .then((entry) => {
        entry = { ...entry, rawMessage: base.message };
        this.commit(entry, options?.bypassSinks);
        return entry;
      })
      .finally(() => {
        this.pendingHooks--;
      });
    this.tail = committed.catch(() => undefined);
    return committed;
  }

  info(message: unknown, moduleName?: string, options?: AppendLogOptions): Promise<LogEntry> {
    return this.append({ message, level: "info", moduleName }, options);
  }

  notice(message: unknown, moduleName?: string, options?: AppendLogOptions): Promise<LogEntry> {
    return this.append({ message, level: "notice", moduleName }, options);
  }

  warning(message: unknown, moduleName?: string, options?: AppendLogOptions): Promise<LogEntry> {
    return this.append({ message, level: "warning", moduleName }, options);
  }

  error(message: unknown, moduleName?: string, options?: AppendLogOptions): Promise<LogEntry> {
    return this.append({ message, level: "error", moduleName }, options);
  }

  private commit(entry: LogEntry, bypassSinks = false): void {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.shift();
      this.droppedCount++;
      // 溢出诊断直发监听器/sink、不进队列（防递归驱逐）。
      this.emit(
        buildEntry({
          message: `log queue overflow: dropped oldest entry (total ${this.droppedCount})`,
          moduleName: "LOG",
          style: LEVEL_STYLE.warning,
          level: "warning",
        }),
        bypassSinks,
      );
    }
    this.emit(entry, bypassSinks);
  }

  private emit(entry: LogEntry, bypassSinks = false): void {
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // 监听器（UI）故障不阻断日志管线。
      }
    }
    if (bypassSinks) return;
    for (const sink of this.sinks) {
      try {
        sink(entry);
      } catch {
        // 落盘故障不阻断日志管线。
      }
    }
  }
}

export interface Log4jsSink {
  /** 落盘一条日志（文本与内存队列一致，entry.text）。 */
  append(entry: LogEntry): void;
  /** 进程退出前 flush（log4js.shutdown），有界等待；超时或未确认回收时拒绝。 */
  shutdown(timeoutMs?: number): Promise<void>;
  /** 最新初始化/运行诊断；null 仅表示尚未观察到错误，不代表已完成异步启动。 */
  readonly diagnostic: string | null;
}

export { createLog4jsSink } from "./log-sink.ts";
