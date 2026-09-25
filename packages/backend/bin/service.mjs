#!/usr/bin/env node
// P2-09：长驻 backend 服务入口（监督协议面）。guardian↔backend 走
// child_process.fork 内置 IPC（可信角色，Plan 02 §59：明确 execPath/json
// serialization；Ajv 不提供预分配长度防护——该保护只属于字节帧通道）。
//
// 监督协议：握手（首条 health）、health ping/pong、shutdown（有界收尾后退出）、
// 通道断开（disconnect）自行退出。
//
// P4-02 业务面：kind "rpc"（payload 按 backend-rpc schema 校验）分发给
// BackendRpcApp，回 kind "rpc_result"（in_reply_to=env.id）；app 事件
// （log/state_change/dialog_*/run_end/diagnostic）包成 kind "event"
// （source:"backend"）持续上报。未知 method/坏参数回 error 结果，不走 fault。
//
// 诊断走 fd2；send 回调只表示交付到通道，不当作对方已处理（SC11）。
//
// 测试缝（仅 guardian/backend 测试使用）：
// - XRESCONV_BACKEND_FAKE_HANG=1：不应答 health ping 与 rpc（模拟事件循环
//   卡死——卡死的循环同样无法处理业务请求）。
// - XRESCONV_BACKEND_TEST_GRANDCHILD_PID_FILE=<path>：spawn 长生子进程并
//   写入其 pid，供整树回收断言。
// - XRESCONV_BACKEND_TEST_DISCONNECT=1：握手后立即 process.disconnect()。
// - XRESCONV_BACKEND_TEST_BAD_ROLE=1：握手伪装成 script-worker 角色。
// - XRESCONV_BACKEND_TEST_RPC_DELAY_MS=<n>：rpc 回复延迟 n 毫秒（迟到回复
//   测试：guardian 侧超时后该回复必须被忽略）。
import { spawn } from "node:child_process";
import { Console } from "node:console";
import { writeFileSync } from "node:fs";

globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });

if (typeof process.send !== "function") {
  process.stderr.write("[backend] must be started via child_process.fork (IPC channel missing)\n");
  process.exit(2);
}

const { PROTOCOL_VERSION, ContractError, validate } = await import("@xresconv/contracts");
const { ScriptWorkerPool } = await import("@xresconv/guardian");
const { BackendRpcApp, RpcError } = await import("../src/service/rpc-app.ts");

const FAKE_HANG = process.env.XRESCONV_BACKEND_FAKE_HANG === "1";
const DISCONNECT = process.env.XRESCONV_BACKEND_TEST_DISCONNECT === "1";
const BAD_ROLE = process.env.XRESCONV_BACKEND_TEST_BAD_ROLE === "1";
const GRANDCHILD_PID_FILE = process.env.XRESCONV_BACKEND_TEST_GRANDCHILD_PID_FILE;
const RPC_DELAY_MS = Number(process.env.XRESCONV_BACKEND_TEST_RPC_DELAY_MS ?? "0");

/** shutdown 帧后的自行收尾宽限（须小于 guardian 的 SHUTDOWN_GRACE_MS=2000）。 */
const SHUTDOWN_SELF_GRACE_MS = 1500;

if (GRANDCHILD_PID_FILE !== undefined && GRANDCHILD_PID_FILE.length > 0) {
  // 非 detached：Windows 进同一 Job Object，POSIX 同进程组；guardian 终止 backend
  // 整树时必须覆盖它。
  const grandchild = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
  });
  writeFileSync(GRANDCHILD_PID_FILE, String(grandchild.pid));
}

function envelope(kind, payload, extra = {}) {
  return {
    protocol_version: PROTOCOL_VERSION,
    kind,
    id: crypto.randomUUID(),
    role: BAD_ROLE ? "script-worker" : "backend",
    payload,
    ...extra,
  };
}

function healthPayload() {
  const memory = process.memoryUsage();
  return {
    ok: true,
    pid: process.pid,
    node: process.version,
    memory: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal },
  };
}

// send 回调只表示交付到通道缓冲，不当作 guardian 已处理（SC11）。
function send(kind, payload, extra = {}) {
  try {
    process.send(envelope(kind, payload, extra), undefined, undefined, (err) => {
      if (err) process.stderr.write(`[backend] send failed: ${err.message}\n`);
    });
  } catch (err) {
    process.stderr.write(`[backend] send threw: ${err}\n`);
  }
}

// P5-02 发行接线：脚本模块锚点目录由 guardian 经 backendEnv 接力（发行
// 布局自定位）；显式经 pool workerEnv 注入 worker——语义明确，不依赖逐层
// 环境继承（XRESCONV_WORKER_ENTRY 由 pool 自身从环境读取，见 script-worker）。
const workerEnv = {};
if (process.env.XRESCONV_SCRIPT_MODULE_DIRS) {
  workerEnv.XRESCONV_SCRIPT_MODULE_DIRS = process.env.XRESCONV_SCRIPT_MODULE_DIRS;
}
const app = new BackendRpcApp({ pool: new ScriptWorkerPool({ workerEnv }) });
// 事件面：log/state_change/dialog_*/run_end/diagnostic → kind "event"（P4-02）。
app.onEvent((event) => {
  send("event", { source: "backend", ...event });
});
// 池在后台启动；handleRpc 会 await 同一 promise，失败时按错误结果返回。
void app
  .start()
  .catch((err) => process.stderr.write(`[backend] worker pool start failed: ${String(err)}\n`));

async function handleRpc(env) {
  let reply;
  try {
    const payload = validate("backend-rpc", env.payload);
    if (payload.type !== "request") {
      throw new RpcError("INVALID_PARAMS", "rpc payload must be a request");
    }
    const result = await app.handleRpc(payload.method, payload.params);
    reply = { type: "result", ok: true, result };
  } catch (err) {
    reply = {
      type: "result",
      ok: false,
      error: {
        code:
          err instanceof RpcError
            ? err.code
            : err instanceof ContractError
              ? "INVALID_PARAMS"
              : "INTERNAL",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  const deliver = () => send("rpc_result", reply, { in_reply_to: env.id });
  if (RPC_DELAY_MS > 0) {
    setTimeout(deliver, RPC_DELAY_MS);
    return;
  }
  deliver();
}

async function shutdownSelf(reason) {
  process.stderr.write(`[backend] shutdown: ${reason}\n`);
  // 有界收尾：超期由 guardian 宽限后整树终止兜底（P2-09 合同）。
  await Promise.race([
    app
      .dispose()
      .catch((err) => process.stderr.write(`[backend] dispose failed: ${String(err)}\n`)),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_SELF_GRACE_MS)),
  ]);
  process.exit(0);
}

process.on("message", (env) => {
  if (typeof env !== "object" || env === null || env.role !== "guardian") {
    send("fault", { message: "invalid envelope or role" });
    return;
  }
  switch (env.kind) {
    case "health":
      if (!FAKE_HANG) {
        send("health", healthPayload(), { in_reply_to: env.id, generation: env.generation });
      }
      return;
    case "rpc":
      if (!FAKE_HANG) {
        void handleRpc(env).catch((err) => {
          process.stderr.write(`[backend] rpc handler error: ${String(err)}\n`);
        });
      }
      return;
    case "shutdown":
      void shutdownSelf("guardian requested shutdown");
      return;
    default:
      send("fault", { message: `unsupported inbound kind: ${env.kind}` }, { in_reply_to: env.id });
  }
});

// guardian 死亡/断开 → 通道 disconnect → 自行退出（句柄/通道检测，不轮询 PID）。
process.on("disconnect", () => process.exit(0));

send("health", healthPayload());

if (DISCONNECT) {
  setImmediate(() => process.disconnect());
}
