// P2-09 宿主强杀夹具：进程内运行 BackendSupervisor（backend 带孙进程），
// 就绪后打印 "READY <backendPid>" 并常驻。测试 SIGKILL 本宿主后，Job Object
// 的 KILL_ON_JOB_CLOSE 必须内核级回收 backend 与孙进程整树（win32 实证）。
import { BackendSupervisor } from "../../src/backend-supervisor.ts";

const supervisor = new BackendSupervisor({
  backendEnv: {
    XRESCONV_BACKEND_TEST_GRANDCHILD_PID_FILE: process.env.GRANDCHILD_PID_FILE ?? "",
  },
  onEvent: (event) => {
    process.stderr.write(`[host] ${event.type}: ${event.message}\n`);
  },
});

await supervisor.start();
process.stdout.write(`READY ${String(supervisor.stats().pid)}\n`);
setInterval(() => {}, 1000);
