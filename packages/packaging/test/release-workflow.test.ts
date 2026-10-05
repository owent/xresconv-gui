import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = readFileSync(
  new URL("../../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);
const aggregate = source.slice(source.indexOf("  aggregate-release:"));

it("uploads draft artifacts with overwrite enabled and no stale-asset gate", () => {
  expect(aggregate).not.toContain("Reject stale assets before any release write");
  expect(aggregate).not.toContain("steps.publication.outputs.upload");
  const upload = aggregate.match(
    /^ {6}- name: .*\r?\n(?:(?!^ {6}- )[\s\S])*?uses: xresloader\/upload-to-github-release[^\r\n]*(?:(?!^ {6}- )[\s\S])*/m,
  )?.[0];
  expect(upload).toBeDefined();
  expect(upload).not.toMatch(/^\s*if:/m);
  expect(upload).toMatch(/^\s*tags: true$/m);
  expect(upload).toMatch(/^\s*draft: true$/m);
  expect(upload).toMatch(/^\s*overwrite: true$/m);
});

it("verifies the full candidate set before upload and the uploaded bytes afterward", () => {
  const verifyMatrix = source.slice(
    source.indexOf("  verify-matrix:"),
    source.indexOf("  aggregate-release:"),
  );
  expect(verifyMatrix).toContain("run: node scripts/verify-release.ts");
  expect(aggregate).toContain("needs: [verify-matrix]");
  const uploadAt = aggregate.indexOf("uses: xresloader/upload-to-github-release");
  const checkAt = aggregate.indexOf("run: node scripts/verify-publication.ts --require-complete");
  expect(uploadAt).toBeGreaterThanOrEqual(0);
  expect(checkAt).toBeGreaterThan(uploadAt);
  expect(aggregate.match(/run: node scripts\/verify-publication\.ts/g)).toHaveLength(1);
});
