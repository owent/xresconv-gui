import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createProcessScope, type ProcessScope } from "@xresconv/guardian";
import { encodeFrame, FrameDecoder, writeFrame } from "@xresconv/ipc";
import type { Log4jsSink, LogEntry } from "./log-pipeline.ts";

/**
 * 默认 log4js 配置（与旧版 src/log4js.json 逐字一致）。P7 起内联为对象：
 * 发行 bundle（esbuild）里相对 import.meta.url 的文件查找会指向不存在的路径，
 * 内联消除该运行时文件依赖；外部 --log-configure 仍按文件读取（1MiB 上限）。
 */
const DEFAULT_CONFIG = {
  appenders: {
    app: { type: "file", filename: "xresconv-gui.info.log", maxLogSize: 10485760, numBackups: 3 },
    errorFile: { type: "file", filename: "xresconv-gui.error.log" },
    errors: { type: "logLevelFilter", level: "ERROR", appender: "errorFile" },
  },
  categories: { default: { appenders: ["app", "errors"], level: "DEBUG" } },
} as const;
const WORKER = fileURLToPath(new URL("./log-sink-worker.ts", import.meta.url));
const MAX_PENDING = 128;

/** Each sink owns an isolated process, so configurations and shutdowns cannot affect another session. */
export function createLog4jsSink(
  options: {
    configurePath?: string;
    onDiagnostic?: (message: string) => void;
    /** 进程树作用域（P2-02）；缺省时本 sink 自建，测试可注入桩。 */
    scope?: ProcessScope;
  } = {},
): Log4jsSink {
  let diagnostic: string | null = null;
  const report = (message: string): void => {
    diagnostic = message;
    try {
      options.onDiagnostic?.(message);
    } catch {
      /* Diagnostics must not disrupt supervision. */
    }
  };
  const read = (file: string): unknown => {
    if (statSync(file).size > 1024 * 1024) throw new Error("log4js configuration exceeds 1 MiB");
    return JSON.parse(readFileSync(file, "utf8"));
  };
  let config: unknown = DEFAULT_CONFIG;
  if (options.configurePath !== undefined) {
    try {
      config = read(options.configurePath);
    } catch (err) {
      report(`failed to configure log4js: ${String(err)}; falling back to default config`);
    }
  }
  // 进程树作用域（P2-02）：自定义 appender 可派生子进程，终止必须覆盖整树。
  const scope = options.scope ?? createProcessScope({ name: "log4js-sink" });
  const child = spawn(
    process.execPath,
    [WORKER],
    scope.decorateSpawnOptions({ stdio: ["pipe", "pipe", "pipe"] }),
  );
  scope.register(child);
  const closed = Promise.withResolvers<void>();
  let exited = false;
  let failure: Error | null = null;
  let sequence = 0;
  let queued = 0;
  let stopping = false;
  let shutdownPromise: Promise<void> | null = null;
  let pending: {
    id: string;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  let stderr = "";
  const fail = (error: Error): void => {
    if (failure) return;
    failure = error;
    report(error.message);
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = null;
    }
    if (!exited) void scope.terminate(0);
  };
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-4096);
  });
  child.once("error", fail);
  child.once("close", (code) => {
    exited = true;
    void scope.dispose();
    if (pending || !stopping || code !== 0)
      fail(new Error(`log4js worker exited (${code}): ${stderr}`));
    closed.resolve();
  });
  const decoder = new FrameDecoder((value) => {
    const reply = value as { id?: string; error?: string; diagnostic?: string } | null;
    if (!reply || !pending || reply.id !== pending.id) {
      fail(new Error("invalid log4js worker reply"));
      return;
    }
    const current = pending;
    clearTimeout(current.timer);
    pending = null;
    if (typeof reply.diagnostic === "string") report(reply.diagnostic);
    if (reply.error) {
      const error = new Error(reply.error);
      current.reject(error);
      fail(error);
    } else current.resolve();
  }, fail);
  child.stdout.on("data", (chunk: Buffer) => decoder.push(chunk));

  const request = (kind: string, payload: unknown): Promise<void> => {
    if (failure) return Promise.reject(failure);
    if (exited) return Promise.reject(new Error("log4js worker already closed"));
    const id = String(++sequence);
    return new Promise<void>((resolve, reject) => {
      pending = {
        id,
        resolve,
        reject,
        timer: setTimeout(() => fail(new Error(`log4js ${kind} deadline exceeded`)), 5000),
      };
      writeFrame(child.stdin, { id, kind, payload }).catch((error: unknown) =>
        fail(error instanceof Error ? error : new Error(String(error))),
      );
    });
  };
  let tail = request("init", { config }).catch((error: Error) => fail(error));
  return {
    get diagnostic() {
      return diagnostic;
    },
    append(entry: LogEntry): void {
      if (stopping || failure) return;
      if (queued >= MAX_PENDING) {
        report("log4js queue full: record not persisted");
        return;
      }
      // Enforce the byte budget before retaining the record in the promise chain.
      try {
        encodeFrame(entry, 256 * 1024);
      } catch {
        report("log4js record exceeds 256 KiB: record not persisted");
        return;
      }
      queued++;
      tail = tail
        .then(() => request("append", entry))
        .catch((error: Error) => fail(error))
        .finally(() => {
          queued--;
        });
    },
    shutdown(timeoutMs = 5000): Promise<void> {
      if (shutdownPromise) return shutdownPromise;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647)
        return Promise.reject(
          new RangeError("log4js shutdown timeout must be a positive timer delay"),
        );
      stopping = true;
      shutdownPromise = (async () => {
        const timer = setTimeout(
          () => fail(new Error("log4js shutdown deadline exceeded")),
          timeoutMs,
        );
        try {
          await tail;
          if (!failure && !exited)
            await request("shutdown", {}).catch((error: Error) => fail(error));
          await new Promise<void>((resolve, reject) => {
            const reapDeadline = setTimeout(() => {
              child.stdin.destroy();
              child.stdout.destroy();
              child.stderr.destroy();
              child.unref();
              const error = new Error("log4js worker cleanup unconfirmed after kill deadline");
              report(error.message);
              reject(error);
            }, 2000);
            void closed.promise.then(() => {
              clearTimeout(reapDeadline);
              resolve();
            });
          });
          if (failure) throw failure;
        } finally {
          clearTimeout(timer);
        }
      })();
      return shutdownPromise;
    },
  };
}
