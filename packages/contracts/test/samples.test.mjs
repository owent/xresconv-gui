import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const ajv = new Ajv2020({ strict: true, allErrors: true });

function loadSchema(name) {
  return JSON.parse(readFileSync(join(root, "schema", `${name}.json`), "utf8"));
}

function loadSample(name) {
  return JSON.parse(readFileSync(join(root, "samples", name), "utf8"));
}

describe.each([
  "handshake",
  "error-info",
  "node-health",
  "envelope",
  "script-invoke",
  "script-result",
])("%s schema vs samples", (name) => {
  const validate = ajv.compile(loadSchema(name));

  it("accepts the valid sample", () => {
    const sample = loadSample(`${name}.valid.json`);
    expect(validate(sample), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects the invalid sample", () => {
    const sample = loadSample(`${name}.invalid.json`);
    expect(validate(sample)).toBe(false);
  });
});
