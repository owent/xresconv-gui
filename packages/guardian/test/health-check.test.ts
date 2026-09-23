// Real child-process tests for the P1 guardian/bin/health-check.mjs entry:
// guardian -> backend spawn chain, non-ASCII/spaced paths, deadline kill.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const guardianEntry = join(here, "..", "bin", "health-check.mjs");
const backendEntry = join(here, "..", "..", "backend", "bin", "health-check.mjs");
const node = process.execPath;

const require = createRequire(import.meta.url);
const schemaPath = require.resolve("@xresconv/contracts/schema/node-health.json");
const nodeHealthSchema = JSON.parse(readFileSync(schemaPath, "utf8"));

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validate = ajv.compile(nodeHealthSchema);

const tmpRoots: string[] = [];
function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "xresconv-guardian-"));
  tmpRoots.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runGuardian(env: NodeJS.ProcessEnv = {}) {
  return spawnSync(node, [guardianEntry], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, ...env },
  });
}

describe("guardian health-check entry", () => {
  it("aggregates the backend handshake into a schema-valid line", () => {
    const r = runGuardian();
    expect(r.status, r.stderr).toBe(0);
    const line = JSON.parse(r.stdout.split("\n", 1)[0] ?? "");
    expect(validate(line), JSON.stringify(validate.errors)).toBe(true);
    expect(line.role).toBe("guardian");
    expect(line.backend.role).toBe("backend");
    expect(line.backend.protocol_version).toBe(1);
    // Three distinct processes: test runner, guardian, backend.
    expect(line.pid).not.toBe(process.pid);
    expect(line.backend.pid).not.toBe(line.pid);
  });

  it("works when entry paths contain spaces and non-ASCII characters", () => {
    // P1-05 evidence: install/resource dirs with spaces/Chinese must not
    // break spawn or entry resolution (Plan C03/I09, narrowed here to the
    // Node role chain; full packaged-app coverage belongs to P5).
    const base = join(makeTmp(), "安装 dir with spaces");
    mkdirSync(join(base, "guardian", "bin"), { recursive: true });
    mkdirSync(join(base, "backend", "bin"), { recursive: true });
    cpSync(guardianEntry, join(base, "guardian", "bin", "health-check.mjs"));
    cpSync(backendEntry, join(base, "backend", "bin", "health-check.mjs"));

    const r = spawnSync(node, [join(base, "guardian", "bin", "health-check.mjs")], {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(r.status, r.stderr).toBe(0);
    const line = JSON.parse(r.stdout.split("\n", 1)[0] ?? "");
    expect(line.ok).toBe(true);
    expect(line.backend.ok).toBe(true);
  });
  // Real-clock deadline test: the deadline fires in a separate OS process;
  // fake timers cannot drive it (rule ts-no-test-timers exception).
  it("kills a stuck backend at the external deadline and exits non-zero", () => {
    const stuck = join(makeTmp(), "stuck-backend.mjs");
    writeFileSync(stuck, "setInterval(() => {}, 1000);\n");
    const started = Date.now();
    const r = runGuardian({
      XRESCONV_BACKEND_ENTRY: stuck,
      XRESCONV_BACKEND_DEADLINE_MS: "800",
    });
    const elapsed = Date.now() - started;
    expect(r.status).not.toBe(0);
    expect(elapsed).toBeGreaterThanOrEqual(700);
    expect(elapsed).toBeLessThan(15_000);
    const diagnostic = JSON.parse(r.stderr.split("\n", 1)[0] ?? "");
    expect(diagnostic.ok).toBe(false);
    expect(diagnostic.error).toMatch(/deadline/);
  });

  it("reports a failing backend instead of fabricating success", () => {
    const failing = join(makeTmp(), "failing-backend.mjs");
    writeFileSync(failing, "console.error('boom'); process.exit(7);\n");
    const r = runGuardian({ XRESCONV_BACKEND_ENTRY: failing });
    expect(r.status).toBe(4);
    const diagnostic = JSON.parse(r.stderr.split("\n", 1)[0] ?? "");
    expect(diagnostic.ok).toBe(false);
    expect(diagnostic.error).toMatch(/exited with code 7/);
  });
});
