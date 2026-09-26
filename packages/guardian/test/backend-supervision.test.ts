/**
 * Backend 进程监督（P2-09，SC10/SC11 backend 侧）：真实 fork 子进程。
 *
 * - 握手 + 心跳 + 干净 shutdown（stats/RTT 真实样本）；
 * - backend 被杀 → died 事件、整树回收（孙进程死亡实证）、**不自动重放**、
 *   显式 restart() 换新代际恢复；
 * - backend 卡死（不应答心跳）→ 截止判死 + 整树终止；
 * - 伪造身份（握手自称 script-worker）→ 判死，不 ready（SC11 身份绑定通道）；
 * - 通道主动 disconnect → 判死清理；
 * - 宿主 SIGKILL → 内核级整树回收（win32 Job Object；POSIX 边界见记录）。
 *
 * 全部显式有界超时；不 mock 协议。
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { BackendSupervisor, type BackendSupervisorEvent } from "../src/backend-supervisor.ts";

const TEST_TIMEOUT_MS = 30_000;
const GUARDIAN_BIN = fileURLToPath(new URL("../bin/service.mjs", import.meta.url));
const HOST_FIXTURE = fileURLToPath(new URL("./fixtures/supervisor-host.mjs", import.meta.url));

const tmpRoots: string[] = [];

afterAll(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xresconv-sup-"));
  tmpRoots.push(dir);
  return dir;
}

async function waitUntil(cond: () => boolean, label: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (cond()) return;
    if (Date.now() >= deadline) throw new Error(`timeout (${timeoutMs}ms) waiting ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function makeSupervisor(
  events: BackendSupervisorEvent[],
  options: ConstructorParameters<typeof BackendSupervisor>[0] = {},
): BackendSupervisor {
  const supervisor = new BackendSupervisor({
    heartbeatMs: 100,
    heartbeatDeadlineMs: 400,
    ...options,
    onEvent: (event) => events.push(event),
  });
  return supervisor;
}

describe("BackendSupervisor（P2-09）", () => {
  it("握手 + 心跳 + stats + 干净 shutdown", { timeout: TEST_TIMEOUT_MS }, async () => {
    const events: BackendSupervisorEvent[] = [];
    const supervisor = makeSupervisor(events);
    await supervisor.start();
    expect(supervisor.stats().state).toBe("ready");
    expect(events.some((e) => e.type === "ready")).toBe(true);
    await waitUntil(() => supervisor.stats().lastRttMs > 0, "heartbeat sample");
    expect(supervisor.stats().lastRssBytes).toBeGreaterThan(0);
    const pid = supervisor.stats().pid;
    await supervisor.shutdown();
    expect(supervisor.stats().state).toBe("shutdown");
    expect(pid === undefined || !pidAlive(pid)).toBe(true);
  });

  it("backend 被杀：died 事件 + 整树回收（孙进程死亡）+ 不自动重放 + 显式 restart", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const dir = makeTmp();
    const grandchildPidFile = path.join(dir, "grandchild.pid");
    const events: BackendSupervisorEvent[] = [];
    const supervisor = makeSupervisor(events, {
      backendEnv: { XRESCONV_BACKEND_TEST_GRANDCHILD_PID_FILE: grandchildPidFile },
    });
    await supervisor.start();
    const gen1 = supervisor.stats().generation;
    const pid1 = supervisor.stats().pid;
    expect(pid1).toBeDefined();
    await waitUntil(() => existsSync(grandchildPidFile), "grandchild pid file");
    const grandchildPid = Number(readFileSync(grandchildPidFile, "utf8"));
    expect(pidAlive(grandchildPid)).toBe(true);

    process.kill(pid1 as number, "SIGKILL");
    await waitUntil(() => supervisor.stats().state === "dead", "supervisor observes death");
    // 实际回收后才算清理成功：孙进程（backend 的子树成员）必须死亡。
    await waitUntil(() => !pidAlive(grandchildPid), "grandchild reaped with backend tree");
    expect(events.some((e) => e.type === "died")).toBe(true);

    // 不自动重放：若干心跳周期后仍 dead。
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(supervisor.stats().state).toBe("dead");
    expect(events.filter((e) => e.type === "ready").length).toBe(1);

    // 只允许显式新建会话恢复。
    await supervisor.restart();
    expect(supervisor.stats().state).toBe("ready");
    expect(supervisor.stats().generation).toBe(gen1 + 1);
    expect(supervisor.stats().pid).not.toBe(pid1);
    await supervisor.shutdown();
  });

  it("backend 卡死（不应答心跳）→ 截止判死 + 整树终止", { timeout: TEST_TIMEOUT_MS }, async () => {
    const events: BackendSupervisorEvent[] = [];
    // 截止放宽到 2s：CI 共享 runner 上 400ms 会被调度延迟干扰（判死语义
    // 不变——外部截止仍生效并整树回收；严格短截止由 rpc 超时用例覆盖）。
    const supervisor = makeSupervisor(events, {
      backendEnv: { XRESCONV_BACKEND_FAKE_HANG: "1" },
      heartbeatDeadlineMs: 2000,
    });
    // FAKE_HANG 只影响 ping 应答，握手仍发生（握手是首条主动 health）。
    await supervisor.start();
    const pid = supervisor.stats().pid;
    await waitUntil(() => supervisor.stats().state === "dead", "hang detected");
    const died = events.filter((e) => e.type === "died").map((e) => e.message);
    expect(
      died.some((message) => message.includes("heartbeat")),
      `died reasons: ${died.join(" | ")}`,
    ).toBe(true);
    // state=dead 在 declareDead 即置位，整树终止是异步收尾——有界等待实际
    // 回收（共享 runner 上 SIGTERM→宽限→SIGKILL 更慢；不以“已发 kill”当回收）。
    if (pid !== undefined) {
      await waitUntil(() => !pidAlive(pid), "hang backend tree reaped", 10_000);
    }
    await supervisor.shutdown();
  });

  it("伪造身份：握手自称 script-worker → 判死不 ready（SC11）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const events: BackendSupervisorEvent[] = [];
    const supervisor = makeSupervisor(events, {
      backendEnv: { XRESCONV_BACKEND_TEST_BAD_ROLE: "1" },
    });
    await expect(supervisor.start()).rejects.toThrow();
    expect(supervisor.stats().state).toBe("dead");
    expect(events.some((e) => e.type === "died")).toBe(true);
    await supervisor.shutdown();
  });

  it("通道主动 disconnect → 判死清理", { timeout: TEST_TIMEOUT_MS }, async () => {
    const events: BackendSupervisorEvent[] = [];
    const supervisor = makeSupervisor(events, {
      backendEnv: { XRESCONV_BACKEND_TEST_DISCONNECT: "1" },
    });
    await supervisor.start().catch(() => undefined);
    await waitUntil(() => supervisor.stats().state === "dead", "disconnect detected");
    expect(events.some((e) => e.type === "died")).toBe(true);
    await supervisor.shutdown();
  });

  it("壳↔guardian 字节通道：stdin EOF → guardian 自清退出且 backend 死亡", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const guardian: ChildProcess = spawn(process.execPath, [GUARDIAN_BIN], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    guardian.stdout?.setEncoding("utf8");
    guardian.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    // 首帧为 guardian health 握手（4 字节大端长度 + JSON）。
    await waitUntil(() => stdout.length >= 4, "guardian handshake frame");
    // 等 backend ready 事件帧出现（监督链建立）。
    await waitUntil(
      () => stdout.includes("backend-supervisor") && stdout.includes("ready"),
      "backend ready event",
    );
    const guardianPid = guardian.pid;
    expect(guardianPid).toBeDefined();
    guardian.stdin?.end(); // 壳通道 EOF → guardian 必须自清退出
    await waitUntil(() => !pidAlive(guardianPid as number), "guardian exited after EOF");
  });

  it("壳→guardian 超大帧：fail-closed（通道毒化自清退出），不分配不解析", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const guardian: ChildProcess = spawn(process.execPath, [GUARDIAN_BIN], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    guardian.stderr?.setEncoding("utf8");
    guardian.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const guardianPid = guardian.pid;
    // 声明 65MB 的帧头（超出 P4-08 上调后的 64MB 上限；分配前拒绝）。
    const head = Buffer.alloc(4);
    head.writeUInt32BE(65 * 1024 * 1024, 0);
    guardian.stdin?.write(head);
    await waitUntil(() => !pidAlive(guardianPid as number), "guardian fail-closed exit");
    expect(stderr).toContain("TOO_LARGE");
  });

  it.skipIf(process.platform !== "win32")(
    "宿主 SIGKILL → Job Object 内核级回收 backend 与孙进程整树（win32）",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const dir = makeTmp();
      const grandchildPidFile = path.join(dir, "grandchild.pid");
      const host: ChildProcess = spawn(process.execPath, [HOST_FIXTURE], {
        env: { ...process.env, GRANDCHILD_PID_FILE: grandchildPidFile },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      host.stdout?.setEncoding("utf8");
      host.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      await waitUntil(() => stdout.includes("READY "), "host ready");
      const backendPid = Number(stdout.match(/READY (\d+)/)?.[1]);
      await waitUntil(() => existsSync(grandchildPidFile), "grandchild pid file");
      const grandchildPid = Number(readFileSync(grandchildPidFile, "utf8"));
      expect(pidAlive(backendPid)).toBe(true);
      expect(pidAlive(grandchildPid)).toBe(true);

      process.kill(host.pid as number, "SIGKILL");
      // 宿主无法自行上报；由独立测试进程观察回收证据（SC11 要求）。
      await waitUntil(() => !pidAlive(backendPid), "backend reclaimed after host SIGKILL");
      await waitUntil(() => !pidAlive(grandchildPid), "grandchild reclaimed after host SIGKILL");
    },
  );
});
