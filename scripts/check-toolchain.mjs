#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const expected = {
  node: {
    min: [24, 0, 0],
    label: "Node.js >=24 (bundled sidecar target: 26.10.0 Current, compat baseline: 24.21.0 LTS)",
  },
  yarn: { exact: "4.18.0", label: "Yarn 4.18.0 (via corepack packageManager)" },
  rust: { exact: "1.98.1", label: "Rust 1.98.1 (rust-toolchain.toml)" },
};

let failed = false;
const report = [];

function check(name, ok, detail) {
  report.push({ name, ok, detail });
  if (!ok) failed = true;
}

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" }).trim();
}

try {
  const v = process.version.replace(/^v/, "").split(".").map(Number);
  check(
    "node",
    v[0] >= expected.node.min[0],
    `found ${process.version}, require ${expected.node.label}`,
  );
} catch (e) {
  check("node", false, String(e));
}

try {
  const y = run("yarn", ["--version"]);
  check("yarn", y === expected.yarn.exact, `found ${y}, require ${expected.yarn.label}`);
} catch (e) {
  check("yarn", false, `not runnable: ${String(e)}`);
}

try {
  const r = run("rustc", ["--version"]);
  const m = r.match(/rustc (\d+\.\d+\.\d+)/);
  check("rust", m?.[1] === expected.rust.exact, `found ${r}, require ${expected.rust.label}`);
} catch (e) {
  check("rust", false, `not runnable: ${String(e)}`);
}

try {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  check(
    "packageManager",
    pkg.packageManager === `yarn@${expected.yarn.exact}`,
    `package.json packageManager=${pkg.packageManager}`,
  );
} catch (e) {
  check("packageManager", false, String(e));
}

for (const row of report) {
  console.log(`${row.ok ? "OK  " : "FAIL"} ${row.name}: ${row.detail}`);
}
process.exit(failed ? 1 : 0);
