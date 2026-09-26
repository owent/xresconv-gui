/**
 * P2-10：发布目录动态模块与原生扩展验证（SC04/PK07 的本机可验证部分）。
 *
 * 在临时目录 staged 一套"发行布局"并验证真实加载链：
 * - runtime/node.exe：复制的 Node 二进制（spawn 显式使用它，不从 PATH 选择，
 *   模拟"无全局 Node"；Plan 02 §80）。
 * - app/：script-host worker 源码 + node_modules（@xresconv workspace 包 +
 *   从本仓库 node_modules 递归闭包复制的 npm 生产依赖）。
 * - 用户项目目录刻意放在安装树之外：验证 XRESCONV_SCRIPT_MODULE_DIRS 回退
 *   锚点（executor.ts，P2-10 兼容层）使裸包名在发行布局下仍可 require。
 * - 环境变量重建为最小集（无 npm_*、无 NODE_PATH、PATH 仅 System32），
 *   任何包管理器/网络补包都无从发生（"无 npm 网络"的机制级证据）。
 * - 安装目录在 spawn 前整树置为只读（PK07 只读介质）；路径含中文与空格。
 *
 * 每个等待都有显式超时；afterAll 恢复可写并清理临时目录。
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Envelope, ScriptInvoke, ScriptResult } from "@xresconv/contracts";
import { encodeFrame, FrameDecoder } from "@xresconv/ipc";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WAIT_MS = 15_000;
const TEST_TIMEOUT_MS = 60_000;
const STAGE_TIMEOUT_MS = 180_000;

interface StageLayout {
  tmpBase: string;
  installDir: string;
  nodeExe: string;
  appDir: string;
  workerEntry: string;
  userDir: string;
  userDirShadow: string;
  tempDir: string;
}

let layout: StageLayout | null = null;

function copyDir(src: string, dest: string): void {
  fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: false });
}

/** 递归闭包：从种子包出发按 package.json dependencies/optionalDependencies 复制。 */
function copyNpmClosure(seeds: string[], nodeModulesDest: string): string[] {
  const rootReq = createRequire(path.join(REPO_ROOT, "package.json"));
  const parentReqs = new Map<string, NodeJS.Require>();
  const copied = new Set<string>();
  const queue = [...seeds];
  for (const seed of seeds) {
    parentReqs.set(seed, rootReq);
  }
  const pkgDirOf = (entry: string): string | null => {
    let dir = path.dirname(entry);
    for (;;) {
      const pj = path.join(dir, "package.json");
      if (fs.existsSync(pj)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(pj, "utf8")) as { name?: string };
          if (typeof parsed.name === "string") {
            return dir;
          }
        } catch {
          // 继续向上找
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return null;
      }
      dir = parent;
    }
  };
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (copied.has(name) || isBuiltin(name)) {
      continue;
    }
    const req = parentReqs.get(name) ?? rootReq;
    let resolved: string;
    try {
      resolved = req.resolve(name);
    } catch {
      // 平台特定 optionalDependencies（如 @koromix/koffi-linux-*）缺失属正常。
      continue;
    }
    const dir = pkgDirOf(resolved);
    if (dir === null) {
      throw new Error(`cannot locate package dir for ${name} (resolved: ${resolved})`);
    }
    copied.add(name);
    copyDir(dir, path.join(nodeModulesDest, name));
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const subReq = createRequire(path.join(dir, "xresconv-closure-anchor.cjs"));
    for (const dep of [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ]) {
      if (!copied.has(dep)) {
        parentReqs.set(dep, subReq);
        queue.push(dep);
      }
    }
  }
  return [...copied];
}

/**
 * 整树只读/可写切换（Windows 上 chmod 映射 FILE_ATTRIBUTE_READONLY）。
 * POSIX 上 0444 会剥离可执行位——staged node 保持 0555（只读仍可执行，
 * “只读介质上可运行”正是要验证的语义；Windows 只读属性同理不挡执行）。
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
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "xresconv-p210-"));
  // PK07：安装路径含中文与空格。
  const installDir = path.join(tmpBase, "安装 目录");
  const appDir = path.join(installDir, "app");
  const runtimeDir = path.join(installDir, "runtime");
  const nodeModulesDest = path.join(appDir, "node_modules");
  fs.mkdirSync(nodeModulesDest, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });

  // 单份固定 Node：复制当前进程二进制（P5-02 将按 manifest 下载校验）。
  const nodeExe = path.join(runtimeDir, process.platform === "win32" ? "node.exe" : "node");
  fs.copyFileSync(process.execPath, nodeExe);

  // script-host 应用本体：esbuild 打包为纯 JS（发行布局必须带编译产物——
  // Node 禁止对 node_modules 内的 .ts 做类型剥离，直接复制 TS 源会
  // ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING；P5-02 组装沿用此机制）。
  // @xresconv/* 内联；npm 生产依赖保持 external，由 app/node_modules 提供。
  const scriptHostDest = path.join(appDir, "script-host");
  fs.mkdirSync(scriptHostDest, { recursive: true });
  await build({
    entryPoints: [path.join(REPO_ROOT, "packages", "script-host", "src", "worker-main.ts")],
    outfile: path.join(scriptHostDest, "worker-main.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["ajv", "ajv/*", "log4js", "minimatch"],
    logLevel: "silent",
  });
  // bin/worker.mjs 的 fd2 控制台重定向门卫在发行布局保留为生成的 shim。
  fs.writeFileSync(
    path.join(scriptHostDest, "worker-entry.mjs"),
    [
      'import { Console } from "node:console";',
      "globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });",
      'await import("./worker-main.mjs");',
      "",
    ].join("\n"),
    "utf8",
  );

  // @xresconv/contracts 的 schema 资源：validators 运行时
  // require.resolve("@xresconv/contracts/schema/<name>.json") 动态定位，
  // 必须落位；@xresconv/* 的代码已被打包进 worker-main.mjs，src 不发行。
  const contractsDest = path.join(nodeModulesDest, "@xresconv", "contracts");
  fs.mkdirSync(contractsDest, { recursive: true });
  copyDir(
    path.join(REPO_ROOT, "packages", "contracts", "schema"),
    path.join(contractsDest, "schema"),
  );
  fs.writeFileSync(
    path.join(contractsDest, "package.json"),
    JSON.stringify({
      name: "@xresconv/contracts",
      version: "3.0.0-dev.0",
      exports: { "./schema/*": "./schema/*" },
    }),
    "utf8",
  );

  // 用户脚本可见的 npm 包（SC04 清单）+ 打包保持 external 的生产依赖闭包。
  copyNpmClosure(
    ["adm-zip", "compressing", "koffi", "ajv", "log4js", "minimatch"],
    nodeModulesDest,
  );

  // 用户项目在安装树之外（裸包名必须靠回退锚点解析）。
  const userDir = path.join(tmpBase, "用户 项目");
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, "conv.xml"), "<root />\n", "utf8");
  fs.writeFileSync(
    path.join(userDir, "helper.js"),
    'module.exports = { marker: "helper-相对模块-ok" };\n',
    "utf8",
  );

  // 优先级夹具：用户配置旁的 node_modules 必须胜过发行捆绑（BD-S1）。
  const userDirShadow = path.join(tmpBase, "shadow 项目");
  const shadowPkg = path.join(userDirShadow, "node_modules", "adm-zip");
  fs.mkdirSync(shadowPkg, { recursive: true });
  fs.writeFileSync(path.join(userDirShadow, "conv.xml"), "<root />\n", "utf8");
  fs.writeFileSync(
    path.join(shadowPkg, "package.json"),
    JSON.stringify({ name: "adm-zip", version: "0.0.0-local", main: "index.js" }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(shadowPkg, "index.js"),
    'module.exports = { shadowMarker: "本地 node_modules 优先" };\n',
    "utf8",
  );

  const tempDir = path.join(tmpBase, "temp");
  fs.mkdirSync(tempDir, { recursive: true });

  layout = {
    tmpBase,
    installDir,
    nodeExe,
    appDir,
    workerEntry: path.join(scriptHostDest, "worker-entry.mjs"),
    userDir,
    userDirShadow,
    tempDir,
  };
  // PK07 只读介质：spawn 前把整棵安装树置只读，afterAll 恢复后再清理。
  setTreeReadonly(installDir, true);
}, STAGE_TIMEOUT_MS);

afterAll(() => {
  if (layout !== null) {
    setTreeReadonly(layout.installDir, false);
    fs.rmSync(layout.tmpBase, { recursive: true, force: true });
    layout = null;
  }
});

/** 最小环境：无 npm_*、无 NODE_PATH、PATH 仅 System32——包管理器无从介入。 */
function scrubbedEnv(l: StageLayout, extra: Record<string, string>): Record<string, string> {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const env: Record<string, string> = {
    SystemRoot: systemRoot,
    SystemDrive: process.env.SystemDrive ?? "C:",
    PATH: path.join(systemRoot, "System32"),
    TEMP: l.tempDir,
    TMP: l.tempDir,
    ...extra,
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith("npm_") || key === "NODE_PATH") {
      throw new Error(`scrubbed env must not contain ${key}`);
    }
  }
  return env;
}

interface Waiter {
  pred: (env: Envelope) => boolean;
  resolve: (env: Envelope) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

class StagedWorkerClient {
  readonly child: ChildProcess;
  stderrText = "";
  private readonly received: Envelope[] = [];
  private readonly waiters: Waiter[] = [];

  constructor(l: StageLayout, extraEnv: Record<string, string>) {
    this.child = spawn(l.nodeExe, [l.workerEntry], {
      stdio: ["pipe", "pipe", "pipe"],
      env: scrubbedEnv(l, extraEnv),
    });
    const decoder = new FrameDecoder(
      (value) => this.dispatch(value as Envelope),
      (error) => this.failAll(new Error(`frame decode error: ${error.message}`)),
    );
    this.child.stdout?.on("data", (chunk: Buffer) => decoder.push(chunk));
    this.child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrText += chunk.toString("utf8");
    });
  }

  private dispatch(env: Envelope): void {
    const index = this.waiters.findIndex((waiter) => waiter.pred(env));
    if (index >= 0) {
      const waiter = this.waiters[index];
      this.waiters.splice(index, 1);
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

  sendValue(value: unknown): void {
    this.child.stdin?.write(encodeFrame(value));
  }

  invoke(payload: ScriptInvoke): void {
    this.sendValue({
      protocol_version: 1,
      kind: "invoke",
      id: randomUUID(),
      role: "guardian",
      payload,
    });
  }

  waitFor(pred: (env: Envelope) => boolean, label: string, timeoutMs = WAIT_MS): Promise<Envelope> {
    const buffered = this.received.findIndex(pred);
    if (buffered >= 0) {
      const env = this.received[buffered];
      this.received.splice(buffered, 1);
      if (env !== undefined) {
        return Promise.resolve(env);
      }
    }
    const { promise, resolve, reject } = Promise.withResolvers<Envelope>();
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

  ofKind(kind: Envelope["kind"], timeoutMs = WAIT_MS): Promise<Envelope> {
    return this.waitFor((env) => env.kind === kind, `kind=${kind}`, timeoutMs);
  }

  completeOf(invocationId: string, timeoutMs = WAIT_MS): Promise<ScriptResult> {
    return this.waitFor(
      (env) => env.kind === "complete" && env.invocation_id === invocationId,
      `complete of ${invocationId}`,
      timeoutMs,
    ).then((env) => env.payload as unknown as ScriptResult);
  }

  logPayloadsOf(invocationId: string): Record<string, unknown>[] {
    return this.received
      .filter((env) => env.kind === "log" && env.payload.invocation_id === invocationId)
      .map((env) => env.payload);
  }

  close(): Promise<void> {
    this.child.kill();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function makeInvoke(l: StageLayout, overrides: Partial<ScriptInvoke>): ScriptInvoke {
  return {
    invocation_id: randomUUID(),
    entry_kind: "on_before_convert",
    filename: "release-layout-probe.js",
    source: "resolve();",
    timeout_ms: 10_000,
    context: { configure_file: path.join(l.userDir, "conv.xml") },
    ...overrides,
  };
}

function theLayout(): StageLayout {
  if (layout === null) {
    throw new Error("release layout not staged");
  }
  return layout;
}

describe("release layout offline module loading (P2-10)", () => {
  it(
    "a. staged node.exe 启动 worker 并完成握手（无全局 Node、无 npm）",
    async () => {
      const l = theLayout();
      const client = new StagedWorkerClient(l, {
        XRESCONV_SCRIPT_MODULE_DIRS: l.appDir,
      });
      try {
        const health = await client.ofKind("health");
        expect(health.role).toBe("script-worker");
        expect(String(health.payload.node)).toMatch(/^v\d+\./);
        // worker 进程的二进制就是 staged 副本，而非开发机全局 Node。
        const invoke = makeInvoke(l, {
          source: 'log_notice(require("node:process").execPath); resolve();',
        });
        client.invoke(invoke);
        const log = await client.waitFor(
          (env) => env.kind === "log" && env.payload.invocation_id === invoke.invocation_id,
          "execPath log",
        );
        expect(path.resolve(String(log.payload.message))).toBe(path.resolve(l.nodeExe));
        expect((await client.completeOf(invoke.invocation_id)).outcome).toBe("resolved");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "b. 内置/相对/npm/原生包与归档往返在发行布局下全部可用（SC04）",
    async () => {
      const l = theLayout();
      const client = new StagedWorkerClient(l, {
        XRESCONV_SCRIPT_MODULE_DIRS: l.appDir,
        XRESCONV_P210_MARKER: "离线环境样本",
      });
      try {
        await client.ofKind("health");
        const invoke = makeInvoke(l, {
          source: [
            'var pathMod = require("node:path");',
            'var helper = require("./helper.js");',
            'var AdmZip = require("adm-zip");',
            'var koffi = require("koffi");',
            'var stream = require("node:stream");',
            'var BufferCtor = require("node:buffer").Buffer;',
            "function collect() {",
            "  var chunks = [];",
            "  var sink = new stream.Writable({ write: function (c, e, cb) { chunks.push(c); cb(); } });",
            "  return { sink: sink, join: function () { return BufferCtor.concat(chunks); } };",
            "}",
            "function pipeTo(source, via, sink) {",
            "  return new Promise(function (res, rej) {",
            '    source.pipe(via).pipe(sink).on("finish", res).on("error", rej);',
            "  });",
            "}",
            'var payload = "gzip 数据 round-trip";',
            "var pack = collect();",
            "pipeTo(",
            '  stream.Readable.from([BufferCtor.from(payload, "utf8")]),',
            '  new (require("compressing").gzip.FileStream)(),',
            "  pack.sink",
            ")",
            "  .then(function () {",
            "    var back = collect();",
            "    return pipeTo(",
            "      stream.Readable.from([pack.join()]),",
            '      new (require("compressing").gzip.UncompressStream)(),',
            "      back.sink",
            "    ).then(function () {",
            '      if (back.join().toString("utf8") !== payload) { throw new Error("gzip mismatch"); }',
            "      var zip = new AdmZip();",
            '      zip.addFile("dir/中文.txt", BufferCtor.from("hello 世界", "utf8"));',
            "      var zip2 = new AdmZip(zip.toBuffer());",
            '      var text = zip2.getEntry("dir/中文.txt").getData().toString("utf8");',
            '      if (text !== "hello 世界") { throw new Error("zip mismatch"); }',
            '      if (typeof koffi.load !== "function") { throw new Error("koffi.load missing"); }',
            "      log_notice(JSON.stringify({",
            '        builtin: pathMod.basename("/a/b.txt"),',
            "        relative: helper.marker,",
            "        zip: text,",
            "        gzip: true,",
            "        koffi: typeof koffi.load,",
            '        envMarker: require("node:process").env.XRESCONV_P210_MARKER,',
            '        npmEnvVisible: Object.keys(require("node:process").env).filter(function (k) { return k.indexOf("npm_") === 0; }).length',
            "      }));",
            "      resolve();",
            "    });",
            "  })",
            "  .catch(reject);",
          ].join("\n"),
          timeout_ms: 15_000,
        });
        client.invoke(invoke);
        const log = await client.waitFor(
          (env) => env.kind === "log" && env.payload.invocation_id === invoke.invocation_id,
          "round-trip report",
        );
        const report = JSON.parse(String(log.payload.message)) as Record<string, unknown>;
        expect(report.builtin).toBe("b.txt");
        expect(report.relative).toBe("helper-相对模块-ok");
        expect(report.zip).toBe("hello 世界");
        expect(report.gzip).toBe(true);
        expect(report.koffi).toBe("function");
        expect(report.envMarker).toBe("离线环境样本");
        expect(report.npmEnvVisible).toBe(0);
        expect((await client.completeOf(invoke.invocation_id)).outcome).toBe("resolved");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "c. 未注入 XRESCONV_SCRIPT_MODULE_DIRS 时裸包名按 MODULE_NOT_FOUND 失败（负对照）",
    async () => {
      const l = theLayout();
      const client = new StagedWorkerClient(l, {});
      try {
        await client.ofKind("health");
        const invoke = makeInvoke(l, {
          source: [
            "try {",
            '  require("adm-zip");',
            '  reject(new Error("unexpectedly resolved adm-zip without fallback anchors"));',
            "} catch (err) {",
            '  log_notice("code=" + String(err && err.code));',
            "  resolve();",
            "}",
          ].join("\n"),
        });
        client.invoke(invoke);
        const log = await client.waitFor(
          (env) => env.kind === "log" && env.payload.invocation_id === invoke.invocation_id,
          "negative-control log",
        );
        expect(log.payload.message).toBe("code=MODULE_NOT_FOUND");
        expect((await client.completeOf(invoke.invocation_id)).outcome).toBe("resolved");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "d. 用户配置旁的 node_modules 优先于发行捆绑目录（BD-S1 锚定语义不回退）",
    async () => {
      const l = theLayout();
      const client = new StagedWorkerClient(l, {
        XRESCONV_SCRIPT_MODULE_DIRS: l.appDir,
      });
      try {
        await client.ofKind("health");
        const invoke = makeInvoke(l, {
          context: { configure_file: path.join(l.userDirShadow, "conv.xml") },
          source: [
            'var pkg = require("adm-zip");',
            'log_notice(String(pkg.shadowMarker || "MISSING"));',
            "resolve();",
          ].join("\n"),
        });
        client.invoke(invoke);
        const log = await client.waitFor(
          (env) => env.kind === "log" && env.payload.invocation_id === invoke.invocation_id,
          "shadow-precedence log",
        );
        expect(log.payload.message).toBe("本地 node_modules 优先");
        expect((await client.completeOf(invoke.invocation_id)).outcome).toBe("resolved");
      } finally {
        await client.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
