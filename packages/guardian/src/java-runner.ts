/**
 * Guardian: xresloader Java 批量运行器（P3-07 backend/guardian 适配）。
 *
 * 对齐旧版 run_one_child_process（main.js:2118-2144）：
 * `spawn("java", javaArgs.concat(["-jar", jarPath, "--stdin"]), {cwd: workDir})`，
 * 任务逐行写 stdin（`line + "\r\n"`，main.js:2100-2101），写完 `stdin.end()`（main.js:2103）。
 *
 * 与旧版的差异（BD-P 编号记录于 docs/plan/records/P3-05.md）：
 * - 派发不由 stdout/stderr data 事件驱动（BD-03 落实）：任务行一次性按序写入
 *   （带背压），完成判定只以进程退出为准。JVM 消费速度由 stdin 管道缓冲自然调节。
 * - 退出码语义：xresloader 约定 = 失败任务数累加（Main.java:399-411，
 *   `exitCode += processArgumentGroup(...)`），failedTaskCount 直接取 exitCode。
 * - 截止/中止终止整棵进程树（P2-02 process-tree.ts）：Windows 默认 Job Object
 *   （TerminateJobObject，含孙进程；guardian 崩溃由 KILL_ON_JOB_CLOSE 兜底），
 *   POSIX 组级 SIGTERM → 宽限 → SIGKILL。Windows 上旧版 child.kill("SIGTERM")
 *   本就是 TerminateProcess 硬杀，不存在被移除的优雅期。
 */

import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { createProcessScope, type ProcessScope } from "./process-tree.ts";
import { HardDeadlineError, SpawnError } from "./run-with-deadline.ts";

export interface JavaBatchOptions {
  /** JVM 参数（含 -Dfile.encoding=UTF-8，由调用方给；对齐 main.js:2121）。 */
  javaArgs?: string[];
  /** xresloader JAR 路径。 */
  jarPath: string;
  /** 工作目录（spawn cwd，main.js:2142）。 */
  workDir: string;
  /** 已编码的任务行（见 backend stdin-encoder），按数组顺序 FIFO 写入。 */
  tasks: string[];
  /** 流式日志回调（UTF-8 拆包/半行缓冲拼接后按行抛出）。 */
  onLog?: (stream: "stdout" | "stderr", text: string) => void;
  /** 硬截止时间（毫秒）；到期终止整个进程树并拒绝 HardDeadlineError。 */
  deadlineMs?: number;
  /** 外部中止信号；触发与截止相同的终止路径，拒绝 AbortError。 */
  signal?: AbortSignal;
  /** 进程树作用域（P2-02）；缺省时本批次自建。终止路径覆盖 JVM 的子进程。 */
  scope?: ProcessScope;
  /**
   * 测试注入缝（EX02 fake-converter）：存在时替换 `java ... -jar jarPath --stdin`
   * 的完整 spawn 规格。生产路径不得使用——调度合同固定 java argv 数组、不经 shell。
   */
  spawnSpec?: { command: string; args: string[]; env?: Record<string, string> };
}

export interface JavaBatchResult {
  /** 进程退出码；被信号杀死时为 null。 */
  exitCode: number | null;
  /** 杀死进程的信号（如有）。 */
  signal: NodeJS.Signals | null;
  /** 失败任务数 = exitCode（Main.java:407 累加约定）；被杀死时无法得知，取 tasks 数。 */
  failedTaskCount: number;
  /** 墙钟耗时（毫秒）。 */
  durationMs: number;
}

/** SIGTERM 后的宽限期，超期升级 SIGKILL。 */
const KILL_GRACE_MS = 2000;
/** SIGKILL 后仍等不到 close 的兜底报告延迟（对齐 runWithDeadline 的防僵尸策略）。 */
const REAP_FALLBACK_MS = 2000;

/** UTF-8 拆包安全 + 半行缓冲的按行日志拼接器。 */
class LineBuffer {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";
  private readonly stream: "stdout" | "stderr";
  private readonly onLog: (stream: "stdout" | "stderr", text: string) => void;

  constructor(
    stream: "stdout" | "stderr",
    onLog: (stream: "stdout" | "stderr", text: string) => void,
  ) {
    this.stream = stream;
    this.onLog = onLog;
  }
  push(chunk: Buffer): void {
    this.pending += this.decoder.write(chunk);
    let newline = this.pending.indexOf("\n");
    while (newline >= 0 || this.pending.length >= 65536) {
      const end = newline >= 0 ? Math.min(newline + 1, 65536) : 65536;
      this.onLog(this.stream, this.pending.slice(0, end));
      this.pending = this.pending.slice(end);
      newline = this.pending.indexOf("\n");
    }
  }

  flush(): void {
    this.pending += this.decoder.end();
    if (this.pending.length > 0) {
      this.onLog(this.stream, this.pending);
      this.pending = "";
    }
  }
}

export class AbortError extends Error {
  constructor(message = "java batch aborted") {
    super(message);
    this.name = "AbortError";
  }
}

/** 运行一批 xresloader stdin 任务；tasks 为空时直接关闭 stdin 等待退出。 */
export function runJavaBatch(options: JavaBatchOptions): Promise<JavaBatchResult> {
  const { javaArgs = [], jarPath, workDir, tasks, onLog, deadlineMs, signal } = options;
  const started = Date.now();
  const program = options.spawnSpec?.command ?? "java";
  const args = options.spawnSpec?.args ?? javaArgs.concat(["-jar", jarPath, "--stdin"]);
  const scope = options.scope ?? createProcessScope({ name: "java-batch" });

  return new Promise<JavaBatchResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }

    let child: ChildProcess;
    try {
      child = spawn(
        program,
        args,
        scope.decorateSpawnOptions({
          cwd: workDir,
          stdio: ["pipe", "pipe", "pipe"],
          ...(options.spawnSpec?.env !== undefined
            ? { env: { ...process.env, ...options.spawnSpec.env } }
            : {}),
        }),
      );
    } catch (err) {
      reject(new SpawnError(program, err));
      return;
    }
    scope.register(child);

    let settled = false;
    let terminatedByDeadline = false;
    let terminatedByAbort = false;
    let ioError: Error | undefined;
    let terminating = false;
    const writing = new AbortController();

    const stdoutBuffer = onLog && child.stdout ? new LineBuffer("stdout", onLog) : null;
    const stderrBuffer = onLog && child.stderr ? new LineBuffer("stderr", onLog) : null;
    child.stdout?.on("data", (chunk: Buffer) => stdoutBuffer?.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrBuffer?.push(chunk));
    // stdin 上的 EPIPE（子进程早退）不视为致命：完成判定只认进程退出（BD-03）。
    child.stdin?.on("error", (error: Error) => {
      ioError = new Error(`java stdin failed: ${error.message}`);
      escalateKill();
    });

    const settle = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      writing.abort();
      clearTimeout(deadlineTimer);
      clearTimeout(reapTimer);
      clearTimeout(pipeTimer);
      signal?.removeEventListener("abort", onAbort);
      // 句柄释放（Windows job/process handle）；若有残留成员，dispose 内的
      // KILL_ON_JOB_CLOSE 关闭句柄即内核级最终清扫。
      void scope.dispose().then(fn, reject);
    };

    // 进程树终止（P2-02）：Windows job-object/回退 taskkill /T /F 立即整树终止，
    // POSIX 组级 SIGTERM → 宽限 → SIGKILL；仍不见 close 则兜底报告，绝不留下失控子进程。
    let reapTimer: NodeJS.Timeout | undefined;
    let pipeTimer: NodeJS.Timeout | undefined;
    const escalateKill = (): void => {
      if (terminating || settled) return;
      terminating = true;
      writing.abort();
      void scope.terminate(KILL_GRACE_MS);
      reapTimer = setTimeout(() => {
        settle(() => {
          child.stdin?.destroy();
          child.stdout?.destroy();
          child.stderr?.destroy();
          reject(new Error("java cleanup unconfirmed: no close after tree termination"));
        });
      }, KILL_GRACE_MS + REAP_FALLBACK_MS);
      reapTimer.unref?.();
    };

    const deadlineTimer =
      deadlineMs !== undefined
        ? setTimeout(() => {
            terminatedByDeadline = true;
            escalateKill();
          }, deadlineMs)
        : undefined;
    deadlineTimer?.unref?.();

    const onAbort = (): void => {
      terminatedByAbort = true;
      escalateKill();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.once("error", (err) => {
      settle(() => reject(new SpawnError(program, err)));
    });
    child.once("exit", () => {
      writing.abort();
      // A descendant may inherit stdio after the owned JVM has exited.
      pipeTimer = setTimeout(
        () =>
          settle(() => {
            child.stdin?.destroy();
            child.stdout?.destroy();
            child.stderr?.destroy();
            reject(new Error("java stdio did not close after process exit; cleanup unconfirmed"));
          }),
        REAP_FALLBACK_MS,
      );
    });

    // 以 close 为准（stdio 已排空，日志缓冲可安全 flush）；不用 data 事件驱动（BD-03）。
    child.once("close", (exitCode, exitSignal) => {
      stdoutBuffer?.flush();
      stderrBuffer?.flush();
      settle(() => {
        if (terminatedByDeadline) {
          reject(new HardDeadlineError(`${program} -jar ${jarPath}`, deadlineMs ?? 0));
          return;
        }
        if (terminatedByAbort) {
          reject(new AbortError());
          return;
        }
        if (ioError) {
          reject(ioError);
          return;
        }
        resolve({
          exitCode,
          signal: exitSignal,
          failedTaskCount:
            typeof exitCode === "number" && exitCode >= 0 ? exitCode : Math.max(1, tasks.length),
          durationMs: Date.now() - started,
        });
      });
    });

    // 顺序写入任务行，尊重背压；写失败（如对端已关闭）只停止写入，等待退出事件收尾。
    void (async () => {
      try {
        for (const line of tasks) {
          if (!child.stdin || child.stdin.destroyed || writing.signal.aborted) {
            break;
          }
          if (!child.stdin.write(`${line}\r\n`)) {
            await once(child.stdin, "drain", { signal: writing.signal });
          }
        }
      } catch {
        // EPIPE 等：子进程已退出，交给 close/error 收尾。
      } finally {
        child.stdin?.end();
      }
    })();
  });
}
