#!/usr/bin/env node
// P1 guardian entry: probes the backend health entry under an external hard
// deadline and prints one combined handshake line on stdout. P2 replaces this
// with the real guardian protocol (spawn ownership, deadlines, IPC routing).
//
// Backend entry resolution: XRESCONV_BACKEND_ENTRY env, then the sibling
// workspace path ../../backend/bin/health-check.mjs relative to this file.
// The backend runs on the same Node binary (process.execPath): packaged
// builds ship exactly one Node runtime per architecture (Plan §6.1).
//
// Deadline: XRESCONV_BACKEND_DEADLINE_MS overrides the 5000ms default
// (used by tests; the shell-side deadline in get_backend_health is larger).

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const backendEntry =
  process.env.XRESCONV_BACKEND_ENTRY ??
  join(here, "..", "..", "backend", "bin", "health-check.mjs");
const deadlineMs = Number.parseInt(process.env.XRESCONV_BACKEND_DEADLINE_MS ?? "5000", 10);
const OUTPUT_LIMIT = 64 * 1024;

function fail(message, code) {
  process.stderr.write(`${JSON.stringify({ ok: false, role: "guardian", error: message })}\n`);
  process.exit(code);
}
if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 2147483647) {
  fail("invalid backend health deadline", 2);
}

const child = spawn(process.execPath, [backendEntry], {
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  if (stdout.length + chunk.length > OUTPUT_LIMIT) {
    overflow = true;
    child.kill("SIGKILL");
  } else stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk).slice(-OUTPUT_LIMIT);
});

let deadlineHit = false;
let overflow = false;
const timer = setTimeout(() => {
  deadlineHit = true;
  child.kill("SIGKILL");
  // If exit never arrives (deeply stuck), still report after a grace period.
  setTimeout(() => fail(`backend did not die after SIGKILL (deadline ${deadlineMs}ms)`, 3), 1000);
}, deadlineMs);

child.on("error", (err) => {
  clearTimeout(timer);
  fail(`spawn backend failed: ${err.message}`, 2);
});

child.on("close", (code, signal) => {
  clearTimeout(timer);
  if (overflow) {
    fail("backend handshake exceeded output budget", 5);
    return;
  }
  if (deadlineHit) {
    fail(`backend exceeded hard deadline of ${deadlineMs}ms`, 3);
    return;
  }
  if (signal) {
    fail(`backend terminated by signal ${signal}`, 3);
    return;
  }
  if (code !== 0) {
    fail(`backend exited with code ${code}: ${stderr.trim()}`, 4);
    return;
  }
  const line = stdout.split("\n", 1)[0].trim();
  let backend;
  try {
    backend = JSON.parse(line);
  } catch {
    fail(`invalid backend handshake JSON: ${line}`, 5);
    return;
  }
  if (
    backend?.ok !== true ||
    backend.role !== "backend" ||
    backend.pid !== child.pid ||
    typeof backend.node !== "string" ||
    !/^v\d+\.\d+\.\d+/.test(backend.node) ||
    backend.protocol_version !== 1
  ) {
    fail("invalid or unsuccessful backend handshake", 5);
    return;
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      role: "guardian",
      pid: process.pid,
      node: process.version,
      backend,
    })}\n`,
  );
});
