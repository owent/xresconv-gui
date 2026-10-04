import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const exe = process.env.XRESCONV_E2E_APP ?? path.join(root, "target", "debug", process.platform === "win32" ? "xresconv-gui.exe" : "xresconv-gui");
const port = Number(process.env.XRESCONV_E2E_DRIVER_PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error("Use tests/desktop/run.mjs to start an owned driver");
const input = process.env.XRESCONV_E2E_INPUT;
const embedded = process.env.XRESCONV_E2E_DRIVER_PROVIDER === "embedded";
const specs = (process.env.XRESCONV_E2E_SPECS ?? (input ? "tree-select" : "launch,p4-ui")).split(",");
if (specs.some((spec) => !["launch", "p4-ui", "tree-select"].includes(spec))) throw new Error("Unknown desktop E2E spec");

export const config = {
  runner: "local",
  hostname: "127.0.0.1",
  port,
  specs: specs.map((name) => path.join(here, "specs", `${name}.spec.mjs`)),
  maxInstances: 1,
  logLevel: "warn",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { timeout: 60_000 },
  // CI 首个 session（WebKitWebDriver 拉起 app + xvfb 软渲染冷启动）实测 ~30s+
  //（71e7ddb 绿运行 17:08:56 RUNNING → 17:09:31 PASSED）；15s/0 会把慢但正常
  // 的建会话误杀为 "Request timed out"（92fa6e8 ubuntu E2E 三连红)。
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  capabilities: [{
    maxInstances: 1,
    ...(embedded ? {} : { "tauri:options": { application: exe, ...(input ? { args: [`--input=${input}`] } : {}) } }),
  }],
  afterTest: async (test, _context, { passed }) => {
    if (passed) return;
    const dir = path.join(root, "build", "desktop-test-results");
    mkdirSync(dir, { recursive: true });
    const name = test.title.replace(/[^a-zA-Z0-9-]/g, "_");
    await browser.saveScreenshot(path.join(dir, `${name}.png`));
    const diagnostic = await browser.executeAsync((done) => {
      window.__TAURI_INTERNALS__.invoke("get_cli_matches").then((cli) => done({ cli, text: document.body.innerText }), (error) => done({ error: String(error) }));
    });
    writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(diagnostic, null, 2));
  },
};
