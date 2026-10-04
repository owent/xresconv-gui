import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkDocs } from "../../scripts/check-docs.mjs";

const scratch = fileURLToPath(
  new URL("../../build/docs-validation/", import.meta.url),
);
mkdirSync(scratch, { recursive: true });

function fixture(files, verify) {
  const root = mkdtempSync(path.join(scratch, "fixture-"));
  try {
    for (const dir of [
      "docs",
      ".agents/skills",
      ".github/actions",
      "tests/fixtures",
      "tests/docs",
    ])
      mkdirSync(path.join(root, dir), { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), content);
    }
    verify(checkDocs(root));
  } finally {
    assert.ok(root.startsWith(scratch));
    rmSync(root, { recursive: true, force: true });
  }
}

test("reports a removed local document", () =>
  fixture({ "README.md": "[missing](docs/missing.md)" }, ({ errors }) => {
    assert.equal(errors.length, 1);
    assert.match(errors[0], /missing target/);
  }));

test("checks Chinese headings and duplicate heading suffixes", () =>
  fixture(
    {
      "README.md":
        "[one](docs/readme.md#中文接口) [two](docs/readme.md#中文接口-1)",
      "docs/readme.md": "# 中文接口\n\n# 中文接口\n",
    },
    ({ errors }) => assert.deepEqual(errors, []),
  ));

test("reports a missing heading in an existing document", () =>
  fixture(
    {
      "README.md": "[heading](docs/readme.md#absent)",
      "docs/readme.md": "# Present\n",
    },
    ({ errors }) => assert.match(errors[0], /missing heading/),
  ));

test("ignores example links and headings inside fences", () =>
  fixture(
    {
      "README.md":
        "```md\n[example](missing.md)\n# Example\n```\n\n~~~md\n[example](also-missing.md)\n~~~\n",
    },
    ({ errors }) => assert.deepEqual(errors, []),
  ));

test("checks images and reference links while accepting external URLs", () =>
  fixture(
    {
      "README.md":
        "![image](missing.png)\n\n[guide]: docs/missing.md\n\n[external](https://example.com/guide)\n",
    },
    ({ errors }) => assert.equal(errors.length, 2),
  ));

test("resolves encoded paths relative to the containing document", () =>
  fixture(
    {
      "docs/README.md": "[file](nested/a%20b.md#details)",
      "docs/nested/a b.md": "# Details\n",
    },
    ({ errors }) => assert.deepEqual(errors, []),
  ));
