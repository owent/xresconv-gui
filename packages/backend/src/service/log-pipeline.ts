/** 日志管线：保留原始消息，按序处理钩子，为内存窗口分配 seq，并独立提交持久化 sink。递归和过载时明确绕过钩子并记录诊断。 */

import { formatUnknownError } from "./format.ts";

export type LogLevel = "info" | "notice" | "warning" | "error";

/** 级别→ Bootstrap 样式。 */
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
  /** 模块名；缺省为 ""（ `module_name || ""`）。 */
  readonly moduleName: string;
  /** 样式类名（alert-*），hook 可改写。 */
  readonly style: string;
  readonly level: LogLevel;
  /** 渲染形态 `[module]: message`（module 为空时仅 message），与写 log4js 的文本一致。 */
  readonly text: string;
  /**
   * 队列内单调游标：仅经 {@link LogPipeline.commit} 落队的条目携带；
   * 直发监听器/sink 的溢出诊断不占 seq（不进队列、与 getLogs 无交集）。
   * UI 据此对 getLogs 初始填充与事件流做幂等去重。
   */
  readonly seq?: number;
}

/**
 * on_append_log 的可改日志对象（ 的 log_object）。
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

/** 内存队列默认容量。 */
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
  /** 因溢出被丢弃的最老条目总数。 */
  droppedCount = 0;
  /** on_append_log 链执行器；非 null 即 append_log_context 窗口。 */
  hookRunner: LogHookRunner | null = null;

  private entries: LogEntry[] = [];
  private readonly listeners = new Set<(entry: LogEntry) => void>();
  private readonly sinks = new Set<(entry: LogEntry) => void>();
  private tail: Promise<unknown> = Promise.resolve();
  private pendingHooks = 0;
  /** 队列内单调游标；直发诊断不消耗。 */
  private nextSeq = 0;
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

  /** 最新 limit 条（最老在前）；limit 缺省全量、越界夹取（ getLogs 底座）。 */
  getRecent(limit?: number): LogEntry[] {
    const bound = Math.max(0, Math.floor(limit ?? this.entries.length));
    if (bound === 0) return [];
    if (bound >= this.entries.length) return [...this.entries];
    return this.entries.slice(this.entries.length - bound);
  }

  /** seq < beforeSeq 的最新 limit 条（最老在前；UI 滚动加载历史)。 */
  getRecentBefore(beforeSeq: number, limit?: number): LogEntry[] {
    const bound = Math.max(0, Math.floor(limit ?? this.entries.length));
    if (bound === 0) return [];
    let end = this.entries.length;
    while (end > 0 && (this.entries[end - 1]?.seq ?? 0) >= beforeSeq) {
      end--;
    }
    const start = Math.max(0, end - bound);
    return this.entries.slice(start, end);
  }

  /** 等待所有在途 hook 链处理完成（测试与收尾用，有界性由调用方超时保证）。 */
  async drain(): Promise<void> {
    await this.tail;
  }

  append(input: AppendLogInput, options?: AppendLogOptions): Promise<LogEntry> {
    // Error 实例一律重路由 error（ 等）。
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

    // 尾链串行化：日志按到达顺序逐条进 hook 链（同步执行天然有序）。
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
    const queued = { ...entry, seq: ++this.nextSeq };
    this.entries.push(queued);
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
    this.emit(queued, bypassSinks);
  }

  private emit(entry: LogEntry, bypassSinks = false): void {
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        //日志管线：保留原始消息，按序处理钩子，为内存窗口分配 seq，并独立提交持久化 sink。递归和过载时明确绕过钩子并记录诊断。
      }
    }
    if (bypassSinks) return;
    for (const sink of this.sinks) {
      try {
        // sink 可能返回 Promise（log4js 异步落盘）：异步拒绝同样不能逃逸成
        // unhandled rejection 杀死 backend(只读/不可写日志文件场景）。
        // 持久化失败的可观测性走 sink 自身的 onDiagnostic 通道（session 接线）。
        void Promise.resolve(sink(entry)).catch(() => {});
      } catch {
        //日志管线：保留原始消息，按序处理钩子，为内存窗口分配 seq，并独立提交持久化 sink。递归和过载时明确绕过钩子并记录诊断。
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
