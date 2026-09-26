/**
 * 测试夹具：扮演"监督进程"角色——创建进程树作用域并生成一棵
 * 父（node keepalive）→ 子（node keepalive）两级树，通过 stdout 报告
 * `PIDS <rootPid> <grandchildPid>` 后常驻。用于验证：
 * - scope.terminate 回收整树；
 * - 宿主进程被 SIGKILL 后（模拟 guardian 崩溃）job-object 后端仍由内核回收整树。
 */
import { spawn } from "node:child_process";
import { createProcessScope } from "../../src/process-tree.ts";

const scope = createProcessScope({ name: "scope-host-fixture" });
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

let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  const match = buffer.match(/GRANDCHILD (\d+)/);
  if (match) {
    console.log(`PIDS ${child.pid} ${match[1]}`);
  }
});

process.on("message", (message) => {
  if (message === "terminate") {
    void scope.terminate(1000).then(async (report) => {
      console.log(`REPORT ${JSON.stringify(report)}`);
      await scope.dispose();
      process.exit(0);
    });
  }
});
