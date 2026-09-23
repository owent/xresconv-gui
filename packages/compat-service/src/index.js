// Compatibility service entry (P2/P3 implementation target).
//
// Hosts the legacy behaviours that must keep JavaScript semantics without
// running arbitrary user scripts: minimatch globbing, JavaScript RegExp
// matching, and log4js configuration (`--log-configure`).

import { minimatch } from "minimatch";

export function matchGlob(pattern, value) {
  return minimatch(value, pattern);
}

export function matchRegex(pattern, value) {
  // Legacy fallback (P0-04 evidence): an invalid regex degrades to an exact
  // match against the original pattern string.
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return value === pattern;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify({ ok: true, pid: process.pid })}\n`);
}
