/**
 * fake-converter：xresloader --stdin 协议的确定性模拟（P3-07 / EX02）。
 * 由 FAKE_CONV_MODE 环境变量驱动输出模式：
 * - echo：每收一行回显一行 stdout（默认）；
 * - silent：全程无输出，EOF 后 exit 0（静默进程也可完成）；
 * - chatty：每行产生多 chunk stdout/stderr（刻意半行拆分，考验行缓冲拼接；
 *   日志块数量不得改变任务计数语义）；
 * - utf8-split：每行以 2 字节粒度切割 UTF-8 多字节序列输出（中文/emoji 跨
 *   chunk 到达，考验 StringDecoder 拼接无 mojibake，EX04）；EOF 后再输出
 *   一段无尾换行的半行，覆盖 flush 路径；
 * - slow：每行 20ms 慢消费（readline for-await 自然背压，考验写端 drain）；
 * - early-exit：收到首行即 exit 7（提前关闭，写端 EPIPE/close 收尾路径）；
 * - fail：EOF 后 exit FAKE_CONV_EXIT（默认 3，退出码=失败任务数约定）；
 * - child：spawn 一个长生子进程（pid 写入 FAKE_CONV_CHILD_PID_FILE），自身
 *   在 EOF 后仍不退（挂起），供截止/中止的整树回收断言。
 *
 * FAKE_CONV_COUNT_FILE 存在时，退出前把接收到的全部行以 JSON 数组写入该文件，
 * 供“每任务只提交一次”断言。
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import readline from "node:readline";

const MODE = process.env.FAKE_CONV_MODE ?? "echo";
const COUNT_FILE = process.env.FAKE_CONV_COUNT_FILE;
const FAIL_EXIT = Number(process.env.FAKE_CONV_EXIT ?? 3);

const received = [];
let exited = false;

function exitWith(code) {
  if (exited) return;
  exited = true;
  if (COUNT_FILE) {
    try {
      writeFileSync(COUNT_FILE, JSON.stringify(received));
    } catch {
      // 计数文件写失败不掩盖主路径退出码。
    }
  }
  process.exit(code);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (MODE === "child") {
  // 非 detached：Windows 进同一 Job Object，POSIX 同进程组；整树终止必须覆盖它。
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
  });
  if (process.env.FAKE_CONV_CHILD_PID_FILE) {
    writeFileSync(process.env.FAKE_CONV_CHILD_PID_FILE, String(child.pid));
  }
}

const rl = readline.createInterface({ input: process.stdin });

if (MODE === "instant-exit") {
  // 启动即退：不读 stdin、不产出任何输出（区别于读一行再退的 early-exit）；
  // 写端在管道破裂/关闭事件收尾，考验收尾不挂起与退出码归并。
  exitWith(9);
} else if (MODE === "self-kill") {
  // 硬杀退出：模拟被信号/强杀终止（POSIX 为 SIGKILL 语义；Windows 为强终止）。
  // runner 侧不猜测 signal 语义，只按非零失败归并——见 ex02 用例。
  process.kill(process.pid, "SIGKILL");
} else if (MODE === "early-exit") {
  rl.once("line", (line) => {
    received.push(line);
    exitWith(FAIL_EXIT);
  });
} else {
  let n = 0;
  for await (const line of rl) {
    n += 1;
    received.push(line);
    if (MODE === "echo") {
      process.stdout.write(`[echo ${n}] ${line}\n`);
    } else if (MODE === "chatty") {
      process.stdout.write(`[part1 ${n}`);
      await delay(1);
      process.stdout.write(`] ${line}\n`);
      process.stderr.write(`[warn chunk ${n}`);
      await delay(1);
      process.stderr.write(" tail\n");
    } else if (MODE === "utf8-split") {
      const text = `[中文任务 ${n}] 资源转换示例 📦\n`;
      const bytes = Buffer.from(text, "utf8");
      for (let i = 0; i < bytes.length; i += 2) {
        process.stdout.write(bytes.subarray(i, i + 2));
        await delay(1);
      }
    } else if (MODE === "slow") {
      await delay(20);
    }
    // silent / fail / child：无输出
  }
  if (MODE === "utf8-split") {
    // 无尾换行的半行：进程退出前由读端 flush 收尾。
    process.stdout.write("尾包无换行：中文收尾");
  }
  if (MODE === "child") {
    // 挂起：等待被整树终止（永不自行退出）。
    setInterval(() => {}, 1000);
  } else {
    exitWith(MODE === "fail" ? FAIL_EXIT : 0);
  }
}
