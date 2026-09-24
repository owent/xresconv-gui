/**
 * Guardian: child-process lifetime ownership with external hard deadlines.
 *
 * The guardian never runs user scripts, XML parsing, regex or custom log
 * appenders itself (Plan.md §6.4). It owns spawn/kill/deadline so a blocked
 * backend or worker event loop cannot delay termination.
 *
 * 终止路径经 process-tree.ts（P2-02）覆盖整棵进程树：Windows Job Object /
 * taskkill 回退，POSIX 进程组。资源限额、IPC 路由另见
 * 02-contracts-script-host.md 的 P2 清单。
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createProcessScope, type ProcessScope } from "./process-tree.ts";

export class HardDeadlineError extends Error {
  readonly program: string;
  readonly deadlineMs: number;

  constructor(program: string, deadlineMs: number) {
    super(`process exceeded hard deadline of ${deadlineMs}ms: ${program}`);
    this.name = "HardDeadlineError";
    this.program = program;
    this.deadlineMs = deadlineMs;
  }
}

export class SpawnError extends Error {
  readonly program: string;
  override readonly cause: unknown;

  constructor(program: string, cause: unknown) {
    super(`failed to spawn: ${program}`);
    this.name = "SpawnError";
    this.program = program;
    this.cause = cause;
  }
}

export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** Wall time in milliseconds. */
  elapsedMs: number;
}

export interface RunOptions {
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Hard wall-clock deadline; the process tree is killed and reaped on expiry. */
  deadlineMs: number;
  /** 进程树作用域（P2-02）；缺省时本次运行自建。 */
  scope?: ProcessScope;
}

/**
 * Runs a child process to completion under an external hard deadline.
 * On deadline expiry the child's process tree is killed and awaited; never
 * resolves with a still-running child.
 */
export function runWithDeadline(program: string, options: RunOptions): Promise<RunResult> {
  const { args = [], cwd, env, deadlineMs } = options;
  const started = Date.now();
  const scope = options.scope ?? createProcessScope({ name: "run-with-deadline" });

  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(program, args, scope.decorateSpawnOptions({ cwd, env, stdio: "ignore" }));
    } catch (err) {
      reject(new SpawnError(program, err));
      return;
    }
    scope.register(child);

    let settled = false;
    let deadlineExpired = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void scope.dispose();
      fn();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      deadlineExpired = true;
      void scope.terminate(0);
      // If exit never arrives (deeply stuck), still report after grace.
      setTimeout(
        () => settle(() => reject(new HardDeadlineError(program, deadlineMs))),
        2000,
      ).unref();
    }, deadlineMs);
    timer.unref?.();

    child.once("error", (err) => {
      settle(() => reject(new SpawnError(program, err)));
    });

    child.once("exit", (exitCode, signal) => {
      // 截止后树终止导致的退出仍须报 HardDeadlineError（TerminateJobObject 的
      // 退出码是普通数值，不能据此当正常结束）。
      settle(() =>
        deadlineExpired
          ? reject(new HardDeadlineError(program, deadlineMs))
          : resolve({ exitCode, signal, elapsedMs: Date.now() - started }),
      );
    });
  });
}
