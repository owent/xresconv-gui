/**
 * P5-02：发行布局全链冒烟（PK07 本机核心证据）。
 *
 * 用 assembleRuntimeLayout 的真实产出（而非手工 staging）验证：
 * - 单份固定 Node：staged runtime/node.exe 启动 guardian；guardian fork
 *   backend、backend spawn worker 均复用 process.execPath（同一二进制）。
 * - 必要适配定位正确：不设置任何 XRESCONV_* 环境变量——guardian/backend
 *   bin 按发行布局约定自定位 backend 入口/worker 入口/模块锚点目录。
 * - 动态 require 可用：用户配置在安装树之外，自定义按钮脚本（entry_kind
 *   "button"，沙箱含 require——set_name 无 require，main.js:1748 遗产）
 *   经 XRESCONV_SCRIPT_MODULE_DIRS 回退锚点 require("adm-zip") 完成 zip
 *   round-trip、require("koffi") 原生加载（Node-API 匹配单份 Node ABI）。
 * - PK07 环境约束：安装路径含中文/空格、整树只读、最小环境（PATH 仅
 *   System32、无 npm_* 与 NODE_PATH——包管理器/网络补包无从发生）。
 *
 * 协议面：壳↔guardian 字节帧（@xresconv/ipc），health 握手 + rpc
 * （backend-rpc loadConfig/invokeCustomButton）+ shutdown；每个等待显式有界。
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encodeFrame, FrameDecoder } from "@xresconv/ipc";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assembleRuntimeLayout } from "../src/assemble.ts";
import type { ReleaseTarget } from "../src/types.ts";
import { pickTarget, SAMPLE_COMMIT } from "./fixtures.ts";

const ASSEMBLE_TIMEOUT_MS = 180_000;
const TEST_TIMEOUT_MS = 90_000;
const BACKEND_READY_DEADLINE_MS = 20_000;
const RPC_TIMEOUT_MS = 30_000;
const EXIT_TIMEOUT_MS = 15_000;

interface TestEnvelope {
  protocol_version: number;
  kind: string;
  id: string;
  role: string;
  payload: Record<string, unknown>;
  in_reply_to?: string;
}

interface ChainFixture {
  tmpBase: string;
  installDir: string;
  userProjectDir: string;
  tempDir: string;
  nodeExe: string;
  guardianEntry: string;
}

let fixture: ChainFixture | null = null;

/**
 * 整树只读/可写切换（Windows 上 chmod 映射 FILE_ATTRIBUTE_READONLY）。
 * POSIX 上 0444 会剥离可执行位——node 二进制保持 0555（只读仍可执行，
 * “只读介质上可运行”正是 PK07 要验证的语义；Windows 只读属性同理不挡执行）。
 */
function setTreeReadonly(root: string, readonly: boolean): void {
  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    fs.chmodSync(dir, readonly ? 0o555 : 0o755);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name === nodeName && path.dirname(full).endsWith("runtime")) {
        fs.chmodSync(full, readonly ? 0o555 : 0o755);
      } else {
        fs.chmodSync(full, readonly ? 0o444 : 0o644);
      }
    }
  }
}

beforeAll(async () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "xresconv-p502-chain-"));
  // PK07：安装路径含中文与空格。
  const installDir = path.join(tmpBase, "安装 目录");
  // 目标随本机平台（koffi optionalDependencies 按平台解析；node.exe/node 命名
  // 与 chmod 跟随目标 OS——跨平台组装需目标平台 node_modules，CI 各 OS 本平台跑）。
  const osOfPlatform =
    process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
  const archOfPlatform = osOfPlatform === "linux" ? "x86_64" : "x64";
  const target: ReleaseTarget = pickTarget(
    (t) => t.os === osOfPlatform && t.arch === archOfPlatform && t.variant === "bootstrap",
  );
  await assembleRuntimeLayout({
    target,
    outDir: installDir,
    node: {
      path: process.execPath,
      source: `local-test-copy:node-v${process.versions.node}-${process.platform}-${process.arch}`,
    },
    appVersion: "3.0.0-dev.0",
    sourceCommit: SAMPLE_COMMIT,
    repositorySnapshot: {
      repository: "https://github.com/xresloader/xresconv-gui.git",
      dirty: false,
    },
    verificationReport: { result: "pass", reportPath: "docs/plan/records/P5-02.md" },
  });

  // 用户项目在安装树之外：裸包名必须靠发行锚点解析（BD-S1 锚定目录无
  // node_modules 上溯链到安装树）。
  const userProjectDir = path.join(tmpBase, "用户 项目");
  fs.mkdirSync(userProjectDir, { recursive: true });
  fs.writeFileSync(
    path.join(userProjectDir, "conv.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<root>
  <global>
    <work_dir>.</work_dir>
    <xresloader_path>conv.xml</xresloader_path>
  </global>
  <list>
    <item name="alpha"><scheme name="DataSource">a.xlsx|s1|1,1</scheme></item>
  </list>
  <gui>
    <script name="zip"><![CDATA[var AdmZip = require("adm-zip");
var zip = new AdmZip();
zip.addFile("m.txt", require("node:buffer").Buffer.from("离线", "utf8"));
var back = new AdmZip(zip.toBuffer());
log_info("ZIP=" + back.getEntry("m.txt").getData().toString("utf8") + "|KOFFI=" + typeof require("koffi").load);
resolve();]]></script>
  </gui>
</root>
`,
    "utf8",
  );

  // 按钮定义在选择器 JSON（动作链 script:<name> 引用配置内 <script>，P4-05a 模型）。
  fs.writeFileSync(
    path.join(userProjectDir, "custom-selectors.json"),
    `${JSON.stringify([{ name: "压缩探针", action: ["script:zip"] }], null, 2)}\n`,
    "utf8",
  );

  const tempDir = path.join(tmpBase, "temp");
  fs.mkdirSync(tempDir, { recursive: true });

  fixture = {
    tmpBase,
    installDir,
    userProjectDir,
    tempDir,
    nodeExe: path.join(installDir, "runtime", process.platform === "win32" ? "node.exe" : "node"),
    guardianEntry: path.join(installDir, "app", "guardian", "service.mjs"),
  };
  // PK07 只读介质：spawn 前整树置只读，afterAll 恢复后清理。
  setTreeReadonly(installDir, true);
}, ASSEMBLE_TIMEOUT_MS);

afterAll(() => {
  if (fixture !== null) {
    setTreeReadonly(fixture.installDir, false);
    fs.rmSync(fixture.tmpBase, { recursive: true, force: true });
    fixture = null;
  }
});

function theFixture(): ChainFixture {
  if (fixture === null) {
    throw new Error("release chain layout not assembled");
  }
  return fixture;
}

/** 最小环境：无 npm_*、无 NODE_PATH、PATH 仅 System32——包管理器无从介入。 */
function scrubbedEnv(f: ChainFixture): Record<string, string> {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const env: Record<string, string> = {
    SystemRoot: systemRoot,
    SystemDrive: process.env.SystemDrive ?? "C:",
    PATH: path.join(systemRoot, "System32"),
    TEMP: f.tempDir,
    TMP: f.tempDir,
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith("npm_") || key === "NODE_PATH" || key.startsWith("XRESCONV_")) {
      throw new Error(`scrubbed env must not contain ${key}`);
    }
  }
  return env;
}

interface Waiter {
  pred: (env: TestEnvelope) => boolean;
  resolve: (env: TestEnvelope) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** 壳侧最小 guardian 客户端：字节帧 + in_reply_to 关联 + 有界等待。 */
class StagedGuardianClient {
  readonly child: ChildProcess;
  stderrText = "";
  private readonly received: TestEnvelope[] = [];
  private readonly waiters: Waiter[] = [];
  private exitCode: number | null = null;
  private exited = false;

  constructor(f: ChainFixture) {
    this.child = spawn(f.nodeExe, [f.guardianEntry], {
      stdio: ["pipe", "pipe", "pipe"],
      env: scrubbedEnv(f),
    });
    const decoder = new FrameDecoder(
      (value) => this.dispatch(value as TestEnvelope),
      (error) => this.failAll(new Error(`frame decode error: ${error.message}`)),
    );
    this.child.stdout?.on("data", (chunk: Buffer) => decoder.push(chunk));
    this.child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrText += chunk.toString("utf8");
    });
    this.child.once("exit", (code) => {
      this.exited = true;
      this.exitCode = code;
      this.failAll(new Error(`guardian exited (${code})`));
    });
  }

  private dispatch(env: TestEnvelope): void {
    const index = this.waiters.findIndex((waiter) => waiter.pred(env));
    if (index >= 0) {
      const [waiter] = this.waiters.splice(index, 1);
      if (waiter !== undefined) {
        clearTimeout(waiter.timer);
        waiter.resolve(env);
      }
      return;
    }
    this.received.push(env);
  }

  private failAll(err: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
  }

  private send(value: TestEnvelope): void {
    this.child.stdin?.write(encodeFrame(value));
  }

  waitFor(
    pred: (env: TestEnvelope) => boolean,
    label: string,
    timeoutMs: number,
  ): Promise<TestEnvelope> {
    const buffered = this.received.findIndex(pred);
    if (buffered >= 0) {
      const [env] = this.received.splice(buffered, 1);
      if (env !== undefined) {
        return Promise.resolve(env);
      }
    }
    const { promise, resolve, reject } = Promise.withResolvers<TestEnvelope>();
    const timer = setTimeout(() => {
      const index = this.waiters.findIndex((waiter) => waiter.resolve === resolve);
      if (index >= 0) {
        this.waiters.splice(index, 1);
      }
      reject(
        new Error(`timeout (${timeoutMs}ms) waiting for ${label}; stderr: ${this.stderrText}`),
      );
    }, timeoutMs);
    this.waiters.push({ pred, resolve, reject, timer });
    return promise;
  }

  request(kind: string, payload: Record<string, unknown>): string {
    const id = randomUUID();
    this.send({ protocol_version: 1, kind, id, role: "shell", payload });
    return id;
  }

  replyTo(id: string, timeoutMs: number, label: string): Promise<TestEnvelope> {
    return this.waitFor((env) => env.in_reply_to === id, label, timeoutMs);
  }

  /** 轮询 health 直到 backend 监督状态 ready；dead 立即失败（不等满超时）。 */
  async waitBackendReady(): Promise<void> {
    const deadline = Date.now() + BACKEND_READY_DEADLINE_MS;
    for (;;) {
      const id = this.request("health", {});
      const reply = await this.replyTo(id, BACKEND_READY_DEADLINE_MS, "health reply");
      const backend = reply.payload.backend as { state?: string } | undefined;
      if (backend?.state === "ready") {
        return;
      }
      if (backend?.state === "dead") {
        throw new Error(`backend died before ready; stderr: ${this.stderrText}`);
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `backend not ready within ${BACKEND_READY_DEADLINE_MS}ms (last state: ${backend?.state}); stderr: ${this.stderrText}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  async rpc(
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ ok: boolean; result?: unknown; error?: { code: string; message: string } }> {
    const id = this.request("rpc", { type: "request", method, params });
    const reply = await this.replyTo(id, RPC_TIMEOUT_MS, `rpc_result of ${method}`);
    return reply.payload as {
      ok: boolean;
      result?: unknown;
      error?: { code: string; message: string };
    };
  }

  async shutdown(): Promise<number | null> {
    if (this.exited) {
      return this.exitCode;
    }
    this.request("shutdown", {});
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.child.kill();
        reject(new Error(`guardian did not exit within ${EXIT_TIMEOUT_MS}ms after shutdown`));
      }, EXIT_TIMEOUT_MS);
      this.child.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }
}

describe("release chain smoke（P5-02，PK07 本机部分）", () => {
  it("staged 单份 Node 全链：health→loadConfig→按钮脚本经锚点 require adm-zip/koffi→shutdown 清零", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const f = theFixture();
    const client = new StagedGuardianClient(f);
    try {
      // 握手与监督就绪（guardian fork backend、backend pool spawn worker）。
      await client.waitBackendReady();
      // 业务全链第一段：loadConfig → backend 解析配置（按钮脚本入视图）。
      const loaded = await client.rpc("loadConfig", {
        path: path.join(f.userProjectDir, "conv.xml"),
      });
      expect(loaded.ok, JSON.stringify(loaded.error)).toBe(true);
      expect((loaded.result as { state: string }).state).toBe("ready");
      // 按钮视图来自选择器 JSON（setCustomSelectors 后 invokeCustomButton 才知名）。
      const selectors = await client.rpc("setCustomSelectors", {
        files: [path.join(f.userProjectDir, "custom-selectors.json")],
      });
      expect(selectors.ok, JSON.stringify(selectors.error)).toBe(true);
      // 业务全链第二段：按钮脚本在 worker 真进程执行，require 经发行锚点
      // 解析 adm-zip/koffi（配置在安装树外，无 node_modules 上溯链）。
      const invoked = await client.rpc("invokeCustomButton", { name: "压缩探针" });
      expect(invoked.ok, JSON.stringify(invoked.error)).toBe(true);
      expect((invoked.result as { ok: boolean }).ok).toBe(true);
      // 脚本效果：zip round-trip（"离线"）+ koffi 原生加载（function）。
      const marker = await client.waitFor(
        (env) =>
          env.kind === "event" &&
          env.payload.type === "log" &&
          String((env.payload.entry as { message?: unknown } | undefined)?.message).startsWith(
            "ZIP=",
          ),
        "button script ZIP= log",
        RPC_TIMEOUT_MS,
      );
      const entry = marker.payload.entry as { message: string };
      expect(entry.message).toBe("ZIP=离线|KOFFI=function");
    } finally {
      const exitCode = await client.shutdown();
      // 有界收尾：shutdown 后整树自清，退出码 0（P2-09 合同）。
      expect(exitCode).toBe(0);
    }
  });
});
