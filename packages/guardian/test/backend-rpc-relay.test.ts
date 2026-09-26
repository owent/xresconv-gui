/**
 * 壳 → guardian → backend 业务 RPC 透传（P4-02）：真实进程链。
 *
 * - e2e：spawn 真实 guardian bin（字节帧壳通道），guardian fork 真实 backend
 *   bin（其内真实 ScriptWorkerPool + script-host worker）；覆盖
 *   health 握手 → getSnapshot → loadConfig（set_name 真实生效）→ applyOps
 *   版本闸 → 未知方法/坏 payload → 事件转发 → shutdown 自清；
 * - backend 卡死（XRESCONV_BACKEND_FAKE_HANG）：在途请求按死亡确定拒绝
 *   （BACKEND_DIED），不悬挂；死后新请求 BACKEND_NOT_READY；
 * - 请求超时后迟到回复忽略并记诊断（SC10，supervisor 层 + RPC_DELAY 缝）；
 * - 未启动/已关停的 supervisor 立即 BACKEND_NOT_READY。
 *
 * 全部显式有界超时；不 mock 协议。
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Envelope } from "@xresconv/contracts";
import { FrameDecoder, writeFrame } from "@xresconv/ipc";
import { describe, expect, it } from "vitest";
import { BackendSupervisor, type BackendSupervisorEvent } from "../src/backend-supervisor.ts";

const TEST_TIMEOUT_MS = 30_000;
const WAIT_MS = 15_000;
const GUARDIAN_BIN = fileURLToPath(new URL("../bin/service.mjs", import.meta.url));
const SET_NAME_FIXTURE = fileURLToPath(
  new URL("../../backend/test/fixtures/service/set-name.xml", import.meta.url),
);

interface Waiter {
  pred: (env: Envelope) => boolean;
  resolve: (env: Envelope) => void;
}

/** 壳侧客户端：guardian stdin/stdout 上的字节帧通道。 */
function spawnGuardian(extraEnv: Record<string, string> = {}) {
  const child: ChildProcess = spawn(process.execPath, [GUARDIAN_BIN], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv },
  });
  const received: Envelope[] = [];
  const waiters: Waiter[] = [];
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const decoder = new FrameDecoder(
    (value) => {
      const env = value as Envelope;
      received.push(env);
      for (let i = waiters.length - 1; i >= 0; i--) {
        const waiter = waiters[i];
        if (waiter?.pred(env)) {
          waiters.splice(i, 1);
          waiter.resolve(env);
        }
      }
    },
    (error) => {
      throw new Error(`guardian channel decode error: ${error.code} ${error.message}`);
    },
  );
  child.stdout?.on("data", (chunk: Buffer) => decoder.push(chunk));

  async function waitFor(
    pred: (env: Envelope) => boolean,
    label: string,
    timeoutMs = WAIT_MS,
  ): Promise<Envelope> {
    const hit = received.find(pred);
    if (hit !== undefined) return hit;
    const { promise, resolve, reject } = Promise.withResolvers<Envelope>();
    waiters.push({ pred, resolve });
    const timer = setTimeout(() => {
      reject(new Error(`timeout (${timeoutMs}ms) waiting ${label}; guardian stderr:\n${stderr}`));
    }, timeoutMs);
    try {
      return await promise;
    } finally {
      clearTimeout(timer);
    }
  }

  async function send(
    kind: string,
    payload: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const id = crypto.randomUUID();
    if (child.stdin === null) throw new Error("guardian stdin closed");
    await writeFrame(child.stdin, {
      protocol_version: 1,
      kind,
      id,
      role: "shell",
      payload,
      ...extra,
    });
    return id;
  }

  /** 发 rpc 并等对应 rpc_result（按 in_reply_to 关联）。 */
  async function rpc(payload: Record<string, unknown>): Promise<Envelope> {
    const id = await send("rpc", payload);
    return await waitFor(
      (env) => env.kind === "rpc_result" && env.in_reply_to === id,
      `rpc_result for ${String(payload.method)}`,
    );
  }

  return { child, received, waitFor, send, rpc };
}

function resultPayload(env: Envelope) {
  return env.payload as {
    type: string;
    ok: boolean;
    result?: Record<string, unknown>;
    error?: { code: string; message: string };
  };
}

function eventPayload(env: Envelope): { source?: string; type?: string; state?: string } {
  return env.payload as { source?: string; type?: string; state?: string };
}

/** 树节点总数（分类 + 条目，递归）。 */
function countTreeNodes(nodes: readonly unknown[]): number {
  let total = 0;
  for (const node of nodes) {
    total += 1;
    total += countTreeNodes((node as { children?: unknown[] }).children ?? []);
  }
  return total;
}

async function waitExit(child: ChildProcess, label: string, timeoutMs = WAIT_MS): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout waiting ${label}`)), timeoutMs),
    ),
  ]);
}

describe("壳→guardian→backend 业务 RPC（P4-02）", () => {
  it("returns a correlated failure for an oversized snapshot instead of timing out", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xresconv-large-snapshot-"));
    const fixture = path.join(dir, "large.xml");
    writeFileSync(fixture, `<root><list><item name="${"x".repeat(600_000)}" /></list></root>`);
    // P4-08 帧上限升至 64MiB（100k 快照需 ~37.5MB）；注入 1MiB 测试上限
    // 复现 RESPONSE_TOO_LARGE 关联失败路径（生产缺省不变）。
    const shell = spawnGuardian({ XRESCONV_MAX_FRAME_BYTES: String(1024 * 1024) });
    try {
      await shell.waitFor(
        (env) => env.kind === "event" && eventPayload(env).type === "ready",
        "ready",
      );
      const response = resultPayload(
        await shell.rpc({ type: "request", method: "loadConfig", params: { path: fixture } }),
      );
      expect(response.ok).toBe(false);
      expect(response.error?.code).toBe("RESPONSE_TOO_LARGE");
    } finally {
      await shell.send("shutdown", {});
      await waitExit(shell.child, "shutdown");
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("大快照过通道（P4-08）：>1MiB 树快照在默认 64MiB 帧预算下完整返回", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xresconv-big-snapshot-"));
    const items: string[] = [];
    for (let i = 0; i < 5000; i++) {
      items.push(
        `    <item file="src.xlsx" scheme="src.xlsx|s${i}|2,1" name="表${i}" cat="c" tag="t1" class="client"></item>`,
      );
    }
    const fixture = path.join(dir, "big.xml");
    writeFileSync(
      fixture,
      `<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <category>\n    <tree id="c" name="分类"></tree>\n  </category>\n  <list>\n${items.join("\n")}\n  </list>\n</root>\n`,
      "utf8",
    );
    const shell = spawnGuardian();
    try {
      await shell.waitFor(
        (env) => env.kind === "event" && eventPayload(env).type === "ready",
        "ready",
      );
      const response = resultPayload(
        await shell.rpc({ type: "request", method: "loadConfig", params: { path: fixture } }),
      );
      expect(response.ok, JSON.stringify(response.error)).toBe(true);
      const nodes = (response.result as { tree: { nodes: unknown[] } }).tree.nodes;
      // 分类 c + 5000 条目。
      expect(countTreeNodes(nodes)).toBe(5001);
    } finally {
      await shell.send("shutdown", {});
      await waitExit(shell.child, "shutdown");
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("握手→getSnapshot→loadConfig→applyOps 版本闸→事件转发→未知方法/坏 payload→shutdown", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const shell = spawnGuardian();
    try {
      // 首帧 health 握手；等 backend ready 监督事件再发业务请求。
      await shell.waitFor((env) => env.kind === "health" && env.role === "guardian", "handshake");
      await shell.waitFor(
        (env) =>
          env.kind === "event" &&
          eventPayload(env).source === "backend-supervisor" &&
          eventPayload(env).type === "ready",
        "backend ready",
      );

      const idle = resultPayload(await shell.rpc({ type: "request", method: "getSnapshot" }));
      expect(idle.ok).toBe(true);
      expect(idle.result?.state).toBe("idle");
      expect(idle.result?.runSeq).toBe(0);
      expect(idle.result?.config).toBeNull();
      expect(idle.result?.tree).toBeNull();

      const loaded = resultPayload(
        await shell.rpc({
          type: "request",
          method: "loadConfig",
          params: { path: SET_NAME_FIXTURE },
        }),
      );
      expect(loaded.ok).toBe(true);
      const loadedResult = loaded.result as {
        state: string;
        config: { path: string };
        tree: { version: number; nodes: { title: string }[] };
      };
      expect(loadedResult.state).toBe("ready");
      expect(loadedResult.config.path).toBe(path.resolve(SET_NAME_FIXTURE));
      // set_name 在 backend 的真实 worker 里执行：改名反映到树快照。
      const titles = loadedResult.tree.nodes.map((node) => node.title);
      expect(titles).toContain("alpha-renamed");
      expect(titles).toContain("beta-renamed");

      // backend 事件转发：加载的 state_change(ready) 必须已到达壳。
      await shell.waitFor(
        (env) =>
          env.kind === "event" &&
          eventPayload(env).source === "backend" &&
          eventPayload(env).type === "state_change" &&
          eventPayload(env).state === "ready",
        "backend state_change event",
      );

      // applyOps 版本闸：失配整批拒绝。
      const version = loadedResult.tree.version;
      const stale = resultPayload(
        await shell.rpc({
          type: "request",
          method: "applyOps",
          params: { ops: [{ v: version + 1, op: "set_node_states", changes: [] }] },
        }),
      );
      expect(stale.ok).toBe(true);
      const staleResult = stale.result as { applied: number; rejected: unknown[] };
      expect(staleResult.applied).toBe(0);
      expect(staleResult.rejected.length).toBe(1);

      // 未知方法：method 是契约枚举，guardian 边界即拒绝（INVALID_PARAMS）；
      // 坏 payload（缺 method）同样 INVALID_PARAMS；都是 error 结果而非
      // fault/通道毒化。UNKNOWN_METHOD 是 backend 侧兜底（rpc-app 测试覆盖）。
      const unknown = resultPayload(await shell.rpc({ type: "request", method: "noSuchMethod" }));
      expect(unknown.ok).toBe(false);
      expect(unknown.error?.code).toBe("INVALID_PARAMS");
      const badPayload = resultPayload(await shell.rpc({ type: "request" }));
      expect(badPayload.ok).toBe(false);
      expect(badPayload.error?.code).toBe("INVALID_PARAMS");
    } finally {
      await shell.send("shutdown", {});
      await waitExit(shell.child, "guardian exit after shutdown");
    }
  });

  it("schema 非法 kind：fault 尽力带 in_reply_to 关联，通道不毒化", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const shell = spawnGuardian();
    try {
      await shell.waitFor((env) => env.kind === "health", "guardian handshake");
      // kind 是封闭枚举，"no-such-kind" 过不了 envelope 校验；guardian 应从
      // 原始帧尽力提取 id 回 in_reply_to，请求方立即结算而非空等超时。
      const badId = await shell.send("no-such-kind", {});
      const fault = await shell.waitFor(
        (env) => env.kind === "fault" && env.in_reply_to === badId,
        "correlated fault for schema-invalid kind",
      );
      expect(String(fault.payload.message)).toContain("kind");

      // 通道未毒化：合法 health 照常应答。
      const healthId = await shell.send("health", {});
      const health = await shell.waitFor(
        (env) => env.kind === "health" && env.in_reply_to === healthId,
        "health after fault",
      );
      expect((health.payload as { ok?: boolean }).ok).toBe(true);
    } finally {
      await shell.send("shutdown", {}).catch(() => undefined);
      await waitExit(shell.child, "guardian exit after fault test");
    }
  });

  it("backend 卡死（FAKE_HANG）：在途请求按死亡拒绝不悬挂；死后请求 BACKEND_NOT_READY", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const shell = spawnGuardian({ XRESCONV_BACKEND_FAKE_HANG: "1" });
    try {
      await shell.waitFor(
        (env) =>
          env.kind === "event" &&
          eventPayload(env).source === "backend-supervisor" &&
          eventPayload(env).type === "ready",
        "backend ready",
      );
      // FAKE_HANG 下 backend 不应答 rpc（卡死语义）；心跳截止判死后在途请求
      // 必须以 BACKEND_DIED 确定结算（SC10：受影响调用得到确定状态）。
      const id = await shell.send("rpc", { type: "request", method: "getSnapshot" });
      const dead = resultPayload(
        await shell.waitFor(
          (env) => env.kind === "rpc_result" && env.in_reply_to === id,
          "rpc_result after backend death",
        ),
      );
      expect(dead.ok).toBe(false);
      expect(dead.error?.code).toBe("BACKEND_DIED");

      const after = resultPayload(await shell.rpc({ type: "request", method: "getSnapshot" }));
      expect(after.ok).toBe(false);
      expect(after.error?.code).toBe("BACKEND_NOT_READY");
    } finally {
      await shell.send("shutdown", {}).catch(() => undefined);
      await waitExit(shell.child, "guardian exit");
    }
  });

  it("未启动/已关停的 supervisor：request 立即拒绝 BACKEND_NOT_READY", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const supervisor = new BackendSupervisor({ heartbeatMs: 100, heartbeatDeadlineMs: 400 });
    await expect(
      supervisor.request({ type: "request", method: "getSnapshot" }),
    ).rejects.toMatchObject({
      code: "BACKEND_NOT_READY",
    });
    await supervisor.shutdown();
    await expect(
      supervisor.request({ type: "request", method: "getSnapshot" }),
    ).rejects.toMatchObject({
      code: "BACKEND_NOT_READY",
    });
  });

  it("请求超时 → BACKEND_TIMEOUT；迟到回复忽略并记诊断（SC10）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const events: BackendSupervisorEvent[] = [];
    const supervisor = new BackendSupervisor({
      heartbeatMs: 100,
      heartbeatDeadlineMs: 400,
      requestTimeoutMs: 400,
      backendEnv: { XRESCONV_BACKEND_TEST_RPC_DELAY_MS: "1500" },
      onEvent: (event) => events.push(event),
    });
    try {
      await supervisor.start();
      await expect(
        supervisor.request({ type: "request", method: "getSnapshot" }),
      ).rejects.toMatchObject({ code: "BACKEND_TIMEOUT" });
      // 迟到的 rpc_result（1.5s 后到达）不得回填已超时的请求，记诊断。
      const deadline = Date.now() + WAIT_MS;
      for (;;) {
        if (events.some((e) => e.type === "diag" && e.message.includes("rpc_result"))) break;
        if (Date.now() >= deadline) {
          throw new Error("timeout waiting late rpc_result diag");
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      await supervisor.shutdown();
    }
  });
});
