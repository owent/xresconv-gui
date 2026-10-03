import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it.each(["ci.yml", "release.yml", "portable-build.yml"])(
  "%s reuses the pinned Yarn install/cache action",
  (workflow) => {
    const source = readFileSync(
      new URL(`../../../.github/workflows/${workflow}`, import.meta.url),
      "utf8",
    );
    expect(source).toContain("uses: ./.github/actions/setup-yarn");
    expect(source).not.toMatch(/run: corepack yarn install --immutable/);
  },
);

it.each(["ci.yml", "release.yml", "portable-build.yml"])(
  "%s caches the actual Cargo workspace target directory",
  (workflow) => {
    const source = readFileSync(
      new URL(`../../../.github/workflows/${workflow}`, import.meta.url),
      "utf8",
    );
    expect(source).toContain("workspaces: . -> target");
    expect(source).not.toContain("workspaces: src-tauri");
  },
);

it("restores and saves the same Yarn archive directory without skipping immutable install", () => {
  const source = readFileSync(
    new URL("../../../.github/actions/setup-yarn/action.yml", import.meta.url),
    "utf8",
  );
  expect(source.match(/path: \$\{\{ github.workspace \}\}\/build\/yarn-cache/g)).toHaveLength(2);
  expect(
    source.match(/YARN_CACHE_FOLDER: \$\{\{ github.workspace \}\}\/build\/yarn-cache/g),
  ).toHaveLength(2);
  expect(source.match(/YARN_ENABLE_GLOBAL_CACHE: "false"/g)).toHaveLength(2);
  expect(source.match(/corepack yarn install --immutable/g)).toHaveLength(2);
  expect(source.indexOf("actions/cache/restore@")).toBeLessThan(
    source.indexOf("corepack yarn install"),
  );
  expect(source.indexOf("actions/cache/save@")).toBeGreaterThan(
    source.lastIndexOf("corepack yarn install"),
  );
  // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expression must stay literal.
  expect(source).toContain("key: ${{ steps.yarn-cache.outputs.cache-primary-key }}");
  expect(source).not.toContain("node_modules");
  // A cache hit controls saving only; it must never skip linking/build scripts.
  expect(source.match(/if: .*cache-hit/g)).toHaveLength(1);
  expect(source).toContain("hashFiles('yarn.lock', '.yarnrc.yml', 'package.json')");
});
