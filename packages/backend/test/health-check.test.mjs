// Real child-process test for the P1 backend/bin/health-check.mjs entry.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION } from "@xresconv/contracts";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const backendEntry = join(here, "..", "bin", "health-check.mjs");

describe("backend health-check entry", () => {
  it("emits a handshake whose protocol_version matches the contract constant", () => {
    const r = spawnSync(process.execPath, [backendEntry], {
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(r.status, r.stderr).toBe(0);
    const line = JSON.parse(r.stdout.split("\n", 1)[0]);
    expect(line.ok).toBe(true);
    expect(line.role).toBe("backend");
    expect(line.pid).not.toBe(process.pid);
    // The plain-JS bin cannot import the TS contract source; this assertion
    // is the guard against the two copies drifting apart.
    expect(line.protocol_version).toBe(PROTOCOL_VERSION);
    expect(line.node).toBe(process.version);
  });
});
