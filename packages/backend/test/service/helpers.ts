/** service 测试共享工具：真实 ScriptWorkerPool 生命周期 + 有界等待。 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { ScriptWorkerPool } from "@xresconv/guardian";

export const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/service/", import.meta.url));

export function fixture(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

/** 每用例上限（真实子进程 = 真实时钟，全部等待显式有界）。 */
export const TEST_TIMEOUT_MS = 30_000;
const WAIT_MS = 10_000;

export async function startPool(): Promise<ScriptWorkerPool> {
  const pool = new ScriptWorkerPool();
  await pool.start();
  return pool;
}

/** 轮询真实生命周期条件；超时抛错（不用 fake timers，子进程时钟是真实的）。 */
export async function waitUntil(
  cond: () => boolean,
  label: string,
  timeoutMs = WAIT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (cond()) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timeout (${timeoutMs}ms) waiting ${label}`);
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 25);
    await promise;
  }
}
