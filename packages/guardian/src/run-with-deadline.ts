/**
 * Guardian: child-process lifetime ownership with external hard deadlines.
 *
 * The guardian never runs user scripts, XML parsing, regex or custom log
 * appenders itself (Plan.md §6.4). It owns spawn/kill/deadline so a blocked
 * backend or worker event loop cannot delay termination.
 *
 * P1 scope: single-process deadline enforcement with guaranteed reaping.
 * P2 scope (tracked in 02-contracts-script-host.md): full process-tree
 * ownership (Windows Job Objects via a minimal native adapter if Node proves
 * insufficient, process groups on Linux/macOS), resource limits, IPC routing.
 */

import { type ChildProcess, spawn } from "node:child_process";

export class HardDeadlineError extends Error {
  constructor(
    readonly program: string,
    readonly deadlineMs: number,
  ) {
    super(`process exceeded hard deadline of ${deadlineMs}ms: ${program}`);
    this.name = "HardDeadlineError";
  }
}

export class SpawnError extends Error {
  constructor(
    readonly program: string,
    override readonly cause: unknown,
  ) {
    super(`failed to spawn: ${program}`);
    this.name = "SpawnError";
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
  /** Hard wall-clock deadline; the process is killed and reaped on expiry. */
  deadlineMs: number;
}

/**
 * Runs a child process to completion under an external hard deadline.
 * On deadline expiry the child is killed and awaited; never resolves with a
 * still-running child.
 */
export function runWithDeadline(program: string, options: RunOptions): Promise<RunResult> {
  const { args = [], cwd, env, deadlineMs } = options;
  const started = Date.now();

  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(program, args, { cwd, env, stdio: "ignore" });
    } catch (err) {
      reject(new SpawnError(program, err));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      // Reap before reporting so callers never see a zombie.
      child.once("exit", () => {
        reject(new HardDeadlineError(program, deadlineMs));
      });
      // If exit never arrives (deeply stuck), still report after grace.
      setTimeout(() => reject(new HardDeadlineError(program, deadlineMs)), 2000).unref();
    }, deadlineMs);
    timer.unref?.();

    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new SpawnError(program, err));
    });

    child.once("exit", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, signal, elapsedMs: Date.now() - started });
    });
  });
}
