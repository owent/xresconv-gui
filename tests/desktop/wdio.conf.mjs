import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const exe =
  process.env.XRESCONV_E2E_APP ??
  path.join(root, "target", "debug", process.platform === "win32" ? "xresconv-gui.exe" : "xresconv-gui");

export const config = {
  runner: "local",
  specs: [path.join(here, "specs", "**", "*.spec.mjs")],
  maxInstances: 1,
  logLevel: "warn",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { timeout: 60_000 },
  services: [
    [
      "tauri",
      {
        driverProvider: "external",
        ...(process.env.TAURI_DRIVER_PATH ? { tauriDriverPath: process.env.TAURI_DRIVER_PATH } : {}),
      },
    ],
  ],
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        application: exe,
        // 2026-09-26：树选中等真实交互用例需加载配置——经 --input 注入 fixture。
        ...(process.env.XRESCONV_E2E_INPUT
          ? { args: ["--input", process.env.XRESCONV_E2E_INPUT] }
          : {}),
      },
      // Windows CI（无交互桌面的会话）上 msedgedriver 偶发
      // "DevToolsActivePort file doesn't exist"——按社区通行做法关 GPU 沙箱
      // 参数（不影响本机交互会话的既有通过）。
      ...(process.platform === "win32"
        ? { "ms:edgeOptions": { args: ["--no-sandbox", "--disable-gpu"] } }
        : {}),
    },
  ],
};
