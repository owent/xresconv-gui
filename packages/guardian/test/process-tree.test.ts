/**
 * P2-02 进程树作用域测试（SC07/SC08）：真实子进程，无 mock。
 * - terminate 回收登记进程及其子孙（close 事件确认，非 kill 返回值）。
 * - Windows job-object：宿主被 SIGKILL 后由内核回收整树（KILL_ON_JOB_CLOSE）。
 * - taskkill 回退后端同样完成树终止。
 * 所有等待均有显式上限。
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createProcessScope,
  expectedProcessTreeBackend,
  type ProcessScope,
} from "../src/process-tree.ts";

const TEST_TIMEOUT_MS = 30_000;
const REAP_WAIT_MS = 5_000;
const SCOPE_HOST = fileURLToPath(new URL("./fixtures/scope-host.mjs", import.meta.url));

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

/** 生成 父（keepalive）→ 子（keepalive）两级树，返回 [scope, rootPid, grandchildPid]。 */
async function spawnTree(scope: ProcessScope): Promise<[number, number]> {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const cp = require("node:child_process");
       const g = cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
       console.log("GRANDCHILD " + g.pid);
       setInterval(() => {}, 1000);`,
    ],
    scope.decorateSpawnOptions({ stdio: ["ignore", "pipe", "ignore"] }),
  );
  scope.register(child);
  const grandchildPid = await new Promise<number>((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("grandchild pid not reported")), 10_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const match = buffer.match(/GRANDCHILD (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("tree root exited before reporting grandchild"));
    });
  });
  if (child.pid === undefined) {
    throw new Error("tree root has no pid");
  }
  return [child.pid, grandchildPid];
}

describe("process tree scope (P2-02)", () => {
  it(
    "terminate reaps a registered child with close-confirmed evidence",
    async () => {
      const scope = createProcessScope({ name: "t-single" });
      const child = spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        scope.decorateSpawnOptions({ stdio: "ignore" }),
      );
      scope.register(child);
      expect(pidAlive(child.pid as number)).toBe(true);
      const report = await scope.terminate(500);
      expect(report.unreapedPids).toEqual([]);
      expect(report.reapedPids).toContain(child.pid);
      await scope.dispose();
      expect(await waitFor(() => !pidAlive(child.pid as number), REAP_WAIT_MS)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "terminate reaps the whole tree including grandchildren",
    async () => {
      const scope = createProcessScope({ name: "t-tree" });
      const [rootPid, grandchildPid] = await spawnTree(scope);
      const report = await scope.terminate(500);
      expect(report.unreapedPids).toEqual([]);
      await scope.dispose();
      expect(await waitFor(() => !pidAlive(rootPid), REAP_WAIT_MS)).toBe(true);
      // 孙进程不是直接登记的成员，但内核 job / 进程组必须一并回收。
      expect(await waitFor(() => !pidAlive(grandchildPid), REAP_WAIT_MS)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "terminate on an empty or already-exited scope resolves cleanly",
    async () => {
      const scope = createProcessScope({ name: "t-empty" });
      await expect(scope.terminate(0)).resolves.toMatchObject({ unreapedPids: [] });
      const child = spawn(
        process.execPath,
        ["-e", "process.exit(0)"],
        scope.decorateSpawnOptions({ stdio: "ignore" }),
      );
      scope.register(child);
      await new Promise((resolve) => child.once("close", resolve));
      const report = await scope.terminate(0);
      expect(report.unreapedPids).toEqual([]);
      await scope.dispose();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reports the expected backend for this platform",
    () => {
      const backend = expectedProcessTreeBackend();
      if (process.platform === "win32") {
        // koffi 是锁定依赖，Windows 上必须能用 job-object；降级即缺陷。
        expect(backend).toBe("job-object");
      } else {
        expect(backend).toBe("process-group");
      }
    },
    TEST_TIMEOUT_MS,
  );

  it.skipIf(process.platform !== "win32")(
    "taskkill fallback backend also reaps the tree (win32)",
    async () => {
      const scope = createProcessScope({ name: "t-taskkill", forceBackend: "taskkill" });
      expect(scope.backend).toBe("taskkill");
      const [rootPid, grandchildPid] = await spawnTree(scope);
      const report = await scope.terminate(0);
      expect(report.unreapedPids).toEqual([]);
      await scope.dispose();
      expect(await waitFor(() => !pidAlive(rootPid), REAP_WAIT_MS)).toBe(true);
      expect(await waitFor(() => !pidAlive(grandchildPid), REAP_WAIT_MS)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it.skipIf(process.platform !== "win32")(
    "job-object reaps the tree even after the owner is SIGKILLed (guardian crash, win32)",
    async () => {
      // scope-host.mjs 扮演 guardian 角色：建 scope + 两级树后常驻并报告 PIDS。
      const helper = spawn(process.execPath, [SCOPE_HOST], { stdio: ["ignore", "pipe", "ignore"] });
      try {
        const [rootPid, grandchildPid] = await new Promise<[number, number]>((resolve, reject) => {
          let buffer = "";
          const timer = setTimeout(() => reject(new Error("helper did not report PIDS")), 10_000);
          helper.stdout?.on("data", (chunk: Buffer) => {
            buffer += chunk.toString("utf8");
            const match = buffer.match(/PIDS (\d+) (\d+)/);
            if (match) {
              clearTimeout(timer);
              resolve([Number(match[1]), Number(match[2])]);
            }
          });
          helper.once("exit", () => {
            clearTimeout(timer);
            reject(new Error("scope host exited before reporting"));
          });
        });
        expect(pidAlive(rootPid)).toBe(true);
        expect(pidAlive(grandchildPid)).toBe(true);
        // 模拟 guardian 崩溃：没有任何机会运行清理代码。
        process.kill(helper.pid as number, "SIGKILL");
        expect(await waitFor(() => !pidAlive(rootPid), REAP_WAIT_MS)).toBe(true);
        expect(await waitFor(() => !pidAlive(grandchildPid), REAP_WAIT_MS)).toBe(true);
      } finally {
        if (helper.pid !== undefined && pidAlive(helper.pid)) {
          process.kill(helper.pid, "SIGKILL");
        }
      }
    },
    TEST_TIMEOUT_MS,
  );
});
