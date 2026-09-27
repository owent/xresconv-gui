import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { copyNpmClosure } from "../src/assemble.ts";

it("preserves nested dependency versions and their own dependency closure", () => {
  const root = mkdtempSync(path.join(tmpdir(), "xresconv-closure-"));
  const put = (name: string, version: string, code: string, dependencies = {}) => {
    const dir = path.join(root, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: name.split("/node_modules/").at(-1),
        version,
        main: "index.cjs",
        license: "MIT",
        dependencies,
      }),
    );
    writeFileSync(path.join(dir, "index.cjs"), code);
  };
  try {
    put("shared", "1.0.0", "module.exports = 'one'");
    put("parent", "1.0.0", "module.exports = require('shared')", { shared: "2.0.0" });
    put("parent/node_modules/shared", "2.0.0", "module.exports = 'two-' + require('leaf')", {
      leaf: "1.0.0",
    });
    put("leaf", "1.0.0", "module.exports = 'leaf'");
    const dest = path.join(root, "staged", "node_modules");
    const copied = copyNpmClosure(["shared", "parent"], root, dest, null);
    const requireStaged = createRequire(path.join(root, "staged", "probe.cjs"));
    // Hide source modules so fallback to the original project cannot mask omissions.
    rmSync(path.join(root, "node_modules"), { recursive: true, force: true });
    expect(requireStaged("shared")).toBe("one");
    expect(requireStaged("parent")).toBe("two-leaf");
    expect(copied.get("parent/node_modules/shared")?.version).toBe("2.0.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
