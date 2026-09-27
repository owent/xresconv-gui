/** Optional trusted-project smoke. All conversion output is redirected into build/. */
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ScriptWorkerPool } from "@xresconv/guardian";
import { ConversionSession } from "../../packages/backend/src/service/session.ts";
import { buildConversionPlan } from "../../packages/backend/src/convert/plan-builder.ts";
import { HAS_JAR, JAR } from "../fixtures/conversion/runtime.mts";

const input = process.argv[2];
if (!input || !HAS_JAR) throw new Error("usage: project-smoke.mjs <trusted XML>; set XRESCONV_TEST_JAR if needed");
const root = fileURLToPath(new URL("../../build/project-smoke/", import.meta.url));
mkdirSync(root, { recursive: true });
const output = path.join(root, `output-${Date.now()}`);
mkdirSync(output);
const pool = new ScriptWorkerPool();
const session = new ConversionSession({ pool });
const deadline = setTimeout(() => { session.cancel(); process.exitCode = 124; }, 180_000);
try {
  await pool.start();
  const config = await session.loadConfig(path.resolve(input));
  // Generic arbitrary hooks can write outside output_dir. This smoke only accepts a hook-free project.
  assert.equal(config.gui.onBeforeConvert.length + config.gui.onAfterConvert.length + config.gui.onAppendLog.length, 0, "project smoke requires a hook-free XML");
  const effective = session.getEffectiveSettings();
  assert.ok(effective);
  const matrix = effective.matrix.map((rule, index) => ({ ...rule, outputDir: path.join(output, `rule-${index}`) }));
  for (const rule of matrix) mkdirSync(rule.outputDir, { recursive: true });
  session.updateSettings({ xresloaderPath: JAR, outputDir: output, matrix });
  session.applyScriptOps([{ v: session.getTreeSnapshot().version, op: "select_all" }]);
  const selected = session.getSelectedItems();
  assert.ok(selected.length > 0);
  const plan = buildConversionPlan(config, { items: selected }, session.getOverrides());
  const result = await session.runConversion();
  assert.equal(result.state, "succeeded");
  assert.equal(result.failedCount, 0);
  const files = readdirSync(output, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => {
    const file = path.join(entry.parentPath, entry.name);
    return { path: path.relative(output, file), sha256: createHash("sha256").update(readFileSync(file)).digest("hex") };
  });
  assert.ok(files.length >= plan.tasks.length);
  const report = { input: config.path, jar: JAR, selectedItems: selected.length, plannedTasks: plan.tasks.length, result, files };
  writeFileSync(path.join(root, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ selectedItems: selected.length, tasks: plan.tasks.length, outputFiles: files.length, state: result.state }));
} finally {
  clearTimeout(deadline);
  await session.dispose();
  await pool.shutdown();
}
