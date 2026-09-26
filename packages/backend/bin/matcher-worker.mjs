#!/usr/bin/env node
// P2-08：隔离 matcher worker。内部通道（backend 自有子进程，非跨角色契约）：
// fd1 帧 IPC（@xresconv/ipc，1MiB 上限），fd2 诊断。
//
// 协议（内部，不进 contracts）：
// - 首帧 {type:"ready", pid} 握手；
// - 请求 {type:"match", id, rule, inputs:string[]} —— 同一条规则编译一次
//   （buildMatchStringRule，含非法规则回退精确匹配的旧版语义，main.js:155-162），
//   对 inputs 顺序求值；
// - 应答 {type:"result", id, results:boolean[]}；结构非法 → {type:"error", id, message}。
//
// 灾难性 regex 的求值会卡死本进程事件循环——这是设计目的：宿主
// （MatcherService）按 deadline 整树终止并补员，主进程事件循环不受影响。
import { Console } from "node:console";

globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });

const { buildMatchStringRule } = await import("@xresconv/compat-service");
const { FrameDecoder, writeFrame } = await import("@xresconv/ipc");

const MAX_INPUTS_PER_BATCH = 65536;
const MAX_RULE_BYTES = 64 * 1024;

function send(value) {
  return writeFrame(process.stdout, value).catch((err) => {
    process.stderr.write(`[matcher-worker] send failed: ${err}\n`);
  });
}

function isValidRequest(msg) {
  return (
    typeof msg === "object" &&
    msg !== null &&
    msg.type === "match" &&
    typeof msg.id === "string" &&
    msg.id.length > 0 &&
    typeof msg.rule === "string" &&
    msg.rule.length <= MAX_RULE_BYTES &&
    Array.isArray(msg.inputs) &&
    msg.inputs.length <= MAX_INPUTS_PER_BATCH &&
    msg.inputs.every((x) => typeof x === "string")
  );
}

const decoder = new FrameDecoder(
  (value) => {
    if (!isValidRequest(value)) {
      const id =
        typeof value === "object" && value !== null && typeof value.id === "string"
          ? value.id
          : "unknown";
      void send({ type: "error", id, message: "invalid match request" });
      return;
    }
    const { id, rule, inputs } = value;
    // 规则非法时 buildMatchStringRule 内部记诊断并回退精确匹配（旧版语义）；
    // 诊断经结果不可见，宿主侧以 rule 原文记账（BD-M3 由调用方记录）。
    const fn = buildMatchStringRule(rule);
    const results = inputs.map((input) => fn(input));
    void send({ type: "result", id, results });
  },
  (error) => {
    process.stderr.write(`[matcher-worker] frame decode error (${error.code}): ${error.message}\n`);
  },
);
process.stdin.on("data", (chunk) => decoder.push(chunk));
process.stdin.once("end", () => process.exit(0));
process.stdin.once("error", () => process.exit(0));

void send({ type: "ready", pid: process.pid });
