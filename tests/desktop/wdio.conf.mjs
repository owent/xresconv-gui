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
      "tauri:options": { application: exe },
    },
  ],
};
