#!/usr/bin/env node
/**
 * P1-08 desktop E2E runner: builds the debug app (frontend + Tauri shell)
 * and drives it with WebdriverIO via tauri-driver.
 *
 * Prerequisites (see docs/plan/records/P1-08.md):
 * - `tauri-driver` on PATH (`cargo install tauri-driver --locked`)
 * - On Windows: `msedgedriver.exe` matching the installed WebView2 runtime,
 *   located via `MSEDGEDRIVER_PATH` env (file or directory) or PATH lookup.
 */
import { spawn, spawnSync } from "node:child_process";
import { createProcessScope } from "@xresconv/guardian";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    timeout: 30 * 60 * 1000,
    ...options,
  });
  if (r.status !== 0) {
    console.error(`[e2e] command failed (${r.status}): ${cmd} ${args.join(" ")}: ${r.error?.message ?? ""}`);
    process.exit(r.status ?? 1);
  }
}

const exe = path.join(
  root,
  "target",
  "debug",
  process.platform === "win32" ? "xresconv-gui.exe" : "xresconv-gui",
);

if (!process.env.XRESCONV_E2E_SKIP_BUILD) {
  console.log("[e2e] building debug app (frontend + tauri shell)…");
  // Execute the installed JS entry with Node. Windows cannot spawn .cmd
  // shims without a shell; argv must also remain literal for spaced paths.
  run(process.execPath, [path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"), "build", "--debug", "--no-bundle"]);
}
if (!existsSync(exe)) {
  console.error(`[e2e] app binary not found: ${exe}`);
  process.exit(1);
}

// Ensure the platform webdriver is discoverable for tauri-driver.
const env = { ...process.env };
if (process.platform === "win32") {
  const candidate = env.MSEDGEDRIVER_PATH;
  if (candidate && existsSync(candidate)) {
    const dir = candidate.toLowerCase().endsWith(".exe") ? path.dirname(candidate) : candidate;
    env.PATH = `${dir}${path.delimiter}${env.PATH ?? ""}`;
  }
}

console.log("[e2e] starting WebdriverIO run…");
const wdioCli = path.join(root, "node_modules", "@wdio", "cli", "bin", "wdio.js");
const scope = createProcessScope({ name: "desktop-e2e" });
try {
  const child = spawn(process.execPath, [wdioCli, "run", path.join("tests", "desktop", "wdio.conf.mjs")],
    scope.decorateSpawnOptions({ cwd: root, stdio: "inherit", env, windowsHide: true }));
  scope.register(child);
  const status = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      void scope.terminate(0);
      reject(new Error("desktop E2E exceeded 20 minutes"));
    }, 20 * 60 * 1000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); resolve(code); });
  });
  if (status !== 0) throw new Error(`WebdriverIO failed (${status})`);
} finally {
  await scope.terminate(0);
  await scope.dispose();
}
console.log("[e2e] done");
