// Generates TypeScript types from the hand-maintained JSON Schemas in
// schema/ (single source of truth, D6). Never hand-edit src/generated/.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, "..", "schema");
const outDir = join(here, "..", "src", "generated");
mkdirSync(outDir, { recursive: true });

const files = readdirSync(schemaDir).filter((f) => f.endsWith(".json"));
if (files.length === 0) {
  console.error("no schemas found; packages/contracts/schema/ must contain at least one .json");
  process.exit(1);
}

for (const file of files) {
  const schema = JSON.parse(readFileSync(join(schemaDir, file), "utf8"));
  const ts = await compile(schema, schema.title ?? file.replace(/\.json$/, ""), {
    bannerComment:
      "/* eslint-disable */\n// Generated from packages/contracts/schema/*.json. Do not edit.",
    strictIndexSignatures: true,
  });
  writeFileSync(join(outDir, file.replace(/\.json$/, ".ts")), ts);
  console.log(`generated ${file} -> src/generated/${file.replace(/\.json$/, ".ts")}`);
}
