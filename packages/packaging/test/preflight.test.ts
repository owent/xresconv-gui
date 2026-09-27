import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../packaging/linux/preflight.sh", import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
describe.skipIf(process.platform !== "linux")("Linux preflight shell integration", () => {
  function fixture(ready: boolean) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-"));
    dirs.push(dir);
    const libs =
      "libwebkit2gtk-4.1.so.0 libjavascriptcoregtk-4.1.so.0 libgtk-3.so.0 libsoup-3.0.so.0";
    fs.writeFileSync(
      path.join(dir, "ldconfig"),
      `#!/bin/sh\n[ -f "$PROBE_DIR/ready" ] && printf '%s\\n' '${libs}'\n`,
      { mode: 0o755 },
    );
    // 永远不调用真正的 sudo / 包管理器。
    fs.writeFileSync(
      path.join(dir, "sudo"),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PROBE_DIR/install.log"\ncase "$*" in *install*) touch "$PROBE_DIR/ready";; esac\n',
      { mode: 0o755 },
    );
    fs.writeFileSync(path.join(dir, "app"), '#!/bin/sh\nprintf "<%s>\\n" "$@"\n', { mode: 0o755 });
    if (ready) fs.writeFileSync(path.join(dir, "ready"), "");
    return {
      dir,
      run: (args: string[]) =>
        spawnSync("/bin/sh", [script, ...args], {
          encoding: "utf8",
          timeout: 5000,
          env: { ...process.env, PROBE_DIR: dir, PATH: `${dir}:${process.env.PATH}` },
        }),
    };
  }
  it("preserves spaces, empty arguments and metacharacters when launching", () => {
    const { dir, run } = fixture(true);
    const result = run(["--quiet", "--", path.join(dir, "app"), "a b", "", "*.xml", "x;y"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("<a b>\n<>\n<*.xml>\n<x;y>\n");
    expect(run(["--"]).status).toBe(5);
  });
  it("executes apt update/install as separate commands then rechecks libraries", () => {
    const { dir, run } = fixture(false);
    expect(run(["--quiet"]).status).toBe(2);
    const result = run(["--install", "--quiet"]);
    expect(result.status, result.stderr).toBe(0);
    const calls = fs.readFileSync(path.join(dir, "install.log"), "utf8");
    expect(calls).not.toContain("&&");
    if (calls.includes("apt-get")) expect(calls.split("\n").filter(Boolean)).toHaveLength(2);
    else expect(calls).toMatch(/^dnf install/);
  });
});
