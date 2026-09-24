#!/usr/bin/env node
// P2-09：长驻 guardian 服务入口（壳↔guardian 字节帧通道，@xresconv/ipc；
// 不可信边界——帧上限预分配前拒绝）。职责：持有 BackendSupervisor（fork IPC
// 监督 backend），把监督事件转发给壳；壳通道 EOF/error（壳死亡/断开）→
// 整树自清后退出（句柄/管道检测，不轮询 PID，Plan 02 §142）。
//
// 首帧为 health 握手（role=guardian，payload.backend 含监督状态）。
// 壳侧命令：health（回含 supervisor stats）、shutdown（清树后退出 0）。
// P4-02 业务路由：壳 kind "rpc"（backend-rpc payload）→ supervisor.request
// 透传 backend → 回 kind "rpc_result"（in_reply_to 关联）；backend 不可用
// （未就绪/死亡/超时）时回 {ok:false, error:{code:BACKEND_*}}。backend 的
// kind "event" 业务事件原样转发壳（source:"backend"）。
import { Console } from "node:console";

globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });

const { PROTOCOL_VERSION, validate } = await import("@xresconv/contracts");
const { FrameDecoder, writeFrame } = await import("@xresconv/ipc");
const { BackendRequestError, BackendSupervisor } = await import("../src/backend-supervisor.ts");

function envelope(kind, payload, extra = {}) {
  return {
    protocol_version: PROTOCOL_VERSION,
    kind,
    id: crypto.randomUUID(),
    role: "guardian",
    payload,
    ...extra,
  };
}

function send(kind, payload, extra = {}) {
  return writeFrame(process.stdout, envelope(kind, payload, extra)).catch((err) => {
    process.stderr.write(`[guardian] send failed: ${err}\n`);
  });
}

const supervisor = new BackendSupervisor({
  onEvent: (event) => {
    process.stderr.write(`[guardian] ${event.type}: ${event.message}\n`);
    // backend 死亡等监督事件必须让壳可见（SC11：UI 故障可见）。
    send("event", {
      source: "backend-supervisor",
      type: event.type,
      message: event.message,
      pid: event.pid,
      generation: event.generation,
    });
  },
  onBackendEvent: (env) => {
    // backend 业务事件（P4-02：log/state_change/dialog_*/run_end）原样转发壳；
    // payload 由 backend 构造（含 source:"backend"），guardian 不改写业务内容。
    if (typeof env.payload === "object" && env.payload !== null) {
      void send("event", env.payload);
    }
  },
});

let shuttingDown = false;
async function selfShutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stderr.write(`[guardian] shutdown: ${reason}\n`);
  await supervisor.shutdown();
  process.exit(0);
}

const decoder = new FrameDecoder(
  (value) => {
    void (async () => {
      let env;
      try {
        env = validate("envelope", value);
        if (env.role !== "shell") throw new Error("only the shell may command guardian");
      } catch (err) {
        // 尽力关联：schema 失败时 env 不存在，从原始帧提取字符串 id 回
        // in_reply_to——请求方可立即按 fault 结算而非空等超时（关联不上的
        // 仍按无主事件处理）。
        const rawId = value !== null && typeof value === "object" ? value.id : undefined;
        const extra = typeof rawId === "string" && rawId.length > 0 ? { in_reply_to: rawId } : {};
        await send("fault", { message: String(err) }, extra);
        return;
      }
      switch (env.kind) {
        case "health": {
          const stats = supervisor.stats();
          const memory = process.memoryUsage();
          await send(
            "health",
            {
              ok: true,
              pid: process.pid,
              node: process.version,
              memory: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal },
              backend: stats,
            },
            { in_reply_to: env.id },
          );
          return;
        }
        case "shutdown":
          await selfShutdown("shell requested shutdown");
          return;
        case "rpc": {
          // P4-02：壳 → backend 业务 RPC 透传。payload 先过 backend-rpc schema；
          // supervisor 拒绝（BACKEND_*）与 backend 业务错误统一走 rpc_result，
          // 不升级为 fault（通道保持可用）。
          let request;
          try {
            request = validate("backend-rpc", env.payload);
            if (request.type !== "request") {
              throw new Error("rpc payload must be a request");
            }
          } catch (err) {
            await send(
              "rpc_result",
              {
                type: "result",
                ok: false,
                error: { code: "INVALID_PARAMS", message: String(err) },
              },
              { in_reply_to: env.id },
            );
            return;
          }
          try {
            const result = await supervisor.request(request);
            if (typeof result !== "object" || result === null) {
              throw new Error("backend returned a non-object rpc result payload");
            }
            await send("rpc_result", result, { in_reply_to: env.id });
          } catch (err) {
            const code = err instanceof BackendRequestError ? err.code : "INTERNAL";
            await send(
              "rpc_result",
              {
                type: "result",
                ok: false,
                error: { code, message: err instanceof Error ? err.message : String(err) },
              },
              { in_reply_to: env.id },
            );
          }
          return;
        }
        default:
          await send(
            "fault",
            { message: `unsupported inbound kind: ${env.kind}` },
            { in_reply_to: env.id },
          );
      }
    })().catch((err) => {
      process.stderr.write(`[guardian] handler error: ${err}\n`);
    });
  },
  (error) => {
    // 通道毒化（超限/坏帧）：fail-closed——诊断后自清退出，由壳决定是否重建。
    process.stderr.write(`[guardian] frame decode error (${error.code}): ${error.message}\n`);
    void selfShutdown(`shell channel poisoned: ${error.code}`);
  },
);
process.stdin.on("data", (chunk) => decoder.push(chunk));
process.stdin.once("end", () => void selfShutdown("shell channel EOF"));
process.stdin.once("error", (err) => void selfShutdown(`shell channel error: ${err.message}`));

await send("health", { ok: true, pid: process.pid, node: process.version });
await supervisor.start();
