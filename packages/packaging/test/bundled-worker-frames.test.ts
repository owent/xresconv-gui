/** 回归（P5-11 CI 实证）：compat-service 模块级"入口健康行"守卫在 esbuild
 * bundle 中误触发（argv[1] 恰为 bundle 本身），裸 JSON 先于帧协议写入 stdout，
 * 帧解码器把它当 UInt32BE 长度读出 0x7B226F6B（=CI 观测的 TOO_LARGE 数值）。
 * 本测试用与 assemble.ts 相同的 esbuild 配置打包真实 worker，断言 stdout 的
 * 第一帧是合法 health 信封——任何模块在 bundle 中向 stdout 泄漏副作用都会
 * 在此失败。 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { collectProductionSeeds } from "../src/assemble.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OUT_DIR = path.join(REPO_ROOT, "build", "bundled-worker-frames-test");
const OUT_FILE = path.join(OUT_DIR, "worker.mjs");
const FRAME_MAX_SANE_BYTES = 1 * 1024 * 1024;

function readFirstFrame(stdout: import("node:stream").Readable): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let frameLength = -1;
    const fail = (err: Error) => {
      stdout.off("data", onChunk);
      reject(err);
    };
    function onChunk(chunk: Buffer): void {
      chunks.push(chunk);
      received += chunk.length;
      if (frameLength < 0) {
        if (received < 4) return;
        const head = Buffer.concat(chunks).subarray(0, 4);
        frameLength = head.readUInt32BE(0);
        if (frameLength > FRAME_MAX_SANE_BYTES) {
          fail(
            new Error(
              `first frame length ${frameLength} is insane — stdout was polluted before the frame protocol`,
            ),
          );
          return;
        }
      }
      if (received >= 4 + frameLength) {
        stdout.off("data", onChunk);
        const body = Buffer.concat(chunks)
          .subarray(4, 4 + frameLength)
          .toString("utf8");
        try {
          resolve(JSON.parse(body) as Record<string, unknown>);
        } catch (err) {
          fail(err as Error);
        }
      }
    }
    stdout.on("data", onChunk);
    stdout.on("error", fail);
    stdout.on("end", () => fail(new Error("stdout ended before a complete frame")));
  });
}

it("bundled script-host worker emits a framed health as its first stdout bytes", async () => {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  try {
    // 与 assemble.bundleRole 相同的打包形态（纯 JS ESM、生产依赖 external）。
    await build({
      entryPoints: [path.join(REPO_ROOT, "packages/script-host/bin/worker.mjs")],
      outfile: OUT_FILE,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      external: [...collectProductionSeeds()],
      logLevel: "silent",
    });
    const child = spawn(process.execPath, [OUT_FILE], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      const first = await readFirstFrame(child.stdout);
      expect(first.kind).toBe("health");
      expect(first.role).toBe("script-worker");
    } finally {
      child.kill();
    }
  } finally {
    rmSync(OUT_DIR, { recursive: true, force: true });
  }
});
