import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { ConfigError } from "../src/config/check-well-formed.ts";
import { parseXmlConfigIsolated } from "../src/config/isolated-loader.ts";
import { parseXmlConfig } from "../src/config/loader.ts";
import { flattenTreeItems } from "../src/domain/selection.ts";

const build = fileURLToPath(new URL("../../../build/config-isolation-tests/", import.meta.url));
const roots: string[] = [];
async function directory() {
  await mkdir(build, { recursive: true });
  const dir = await mkdtemp(path.join(build, "case-"));
  roots.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

it("round-trips include merging, script text and dictionary keys", async () => {
  const dir = await directory();
  await writeFile(
    path.join(dir, "child.xml"),
    "<root><global><work_dir>.</work_dir></global></root>",
  );
  const file = path.join(dir, "config.xml");
  await writeFile(
    file,
    `<root><include>child.xml</include><gui><script name="__proto__"><![CDATA[x < 2]]></script></gui><list><item name="entry"><scheme name="constructor">value</scheme></item></list></root>`,
  );
  expect(await parseXmlConfigIsolated(file)).toEqual(await parseXmlConfig(file));
}, 15_000);

it("preserves ConfigError code and source location across the process boundary", async () => {
  const dir = await directory();
  const file = path.join(dir, "config.xml");
  await writeFile(file, "<root><broken></root>");
  const error = await parseXmlConfigIsolated(file).catch((value: unknown) => value);
  expect(error).toBeInstanceOf(ConfigError);
  expect(error).toMatchObject({ code: "INVALID_XML", details: { path: file, line: 1 } });
}, 15_000);

it("keeps the parent responsive and reaps a CPU-bound helper at its external deadline", async () => {
  const dir = await directory();
  const workerPath = path.join(dir, "busy.mjs");
  await writeFile(workerPath, "for (;;) {}\n");
  let ticks = 0;
  const interval = setInterval(() => ticks++, 10);
  try {
    await expect(
      parseXmlConfigIsolated("unused.xml", { workerPath, timeoutMs: 250 }),
    ).rejects.toMatchObject({ code: "CONFIG_TIMEOUT" });
    expect(ticks).toBeGreaterThan(5);
  } finally {
    clearInterval(interval);
  }
}, 10_000);

it("aborts and reaps a stalled helper without waiting for its deadline", async () => {
  const dir = await directory();
  const workerPath = path.join(dir, "busy.mjs");
  await writeFile(workerPath, "for (;;) {}\n");
  const controller = new AbortController();
  const result = parseXmlConfigIsolated("unused.xml", {
    workerPath,
    signal: controller.signal,
    timeoutMs: 30_000,
  });
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    await expect(result).rejects.toMatchObject({ code: "CONFIG_CANCELLED" });
  } finally {
    clearTimeout(timer);
  }
}, 10_000);

it("rejects an oversized script separately from the XML file byte budget", async () => {
  const dir = await directory();
  const file = path.join(dir, "config.xml");
  await writeFile(file, `<root><gui><script>${"x".repeat(1024 * 1024 + 1)}</script></gui></root>`);
  await expect(parseXmlConfig(file)).rejects.toMatchObject({
    code: "CONFIG_LIMIT",
    details: { budget: "scriptBytes" },
  });
});

it("loads and transfers a 100k-item candidate while the parent remains responsive", async () => {
  const dir = await directory();
  const file = path.join(dir, "config.xml");
  await writeFile(
    file,
    `<root><list>${Array.from({ length: 100_000 }, (_, index) => `<item name="entry${index}" file="data.xlsx" scheme="sheet|2,1"/>`).join("")}</list></root>`,
  );
  let ticks = 0;
  const interval = setInterval(() => ticks++, 10);
  try {
    expect(flattenTreeItems((await parseXmlConfigIsolated(file)).tree)).toHaveLength(100_000);
    expect(ticks).toBeGreaterThan(5);
  } finally {
    clearInterval(interval);
  }
}, 60_000);

it("counts ignored XML elements against the independent node budget", async () => {
  const dir = await directory();
  const file = path.join(dir, "config.xml");
  await writeFile(file, `<root>${"<unknown/>".repeat(1_000_000)}</root>`);
  await expect(parseXmlConfigIsolated(file)).rejects.toMatchObject({
    code: "CONFIG_LIMIT",
    details: { budget: "xmlNodes" },
  });
}, 60_000);

it("rejects excessive XML nesting and cumulative script text", async () => {
  const dir = await directory();
  const file = path.join(dir, "config.xml");
  await writeFile(file, `<root>${"<unknown>".repeat(100)}${"</unknown>".repeat(100)}</root>`);
  await expect(parseXmlConfig(file)).rejects.toMatchObject({
    code: "CONFIG_LIMIT",
    details: { budget: "xmlDepth" },
  });
  await writeFile(
    file,
    `<root><gui>${(`<script>${"x".repeat(1024 * 1024)}</script>`).repeat(9)}</gui></root>`,
  );
  await expect(parseXmlConfigIsolated(file)).rejects.toMatchObject({
    code: "CONFIG_LIMIT",
    details: { budget: "scriptBytes" },
  });
}, 60_000);
