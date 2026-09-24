import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseXmlConfig } from "../src/config/loader.ts";
import { flattenTreeItems } from "../src/domain/selection.ts";

const roots: string[] = [];
async function parse(xml: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "xresconv-config-review-"));
  roots.push(dir);
  const file = path.join(dir, "config.xml");
  await writeFile(file, xml, "utf8");
  return parseXmlConfig(file);
}
afterEach(async () => {
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("configuration input boundaries", () => {
  it("rejects an oversized XML file before parsing", async () => {
    await expect(parse(`<root>${" ".repeat(8 * 1024 * 1024)}</root>`)).rejects.toMatchObject({
      code: "CONFIG_LIMIT",
    });
  });
  it("detects an include cycle through directory aliases", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xresconv-config-review-"));
    roots.push(dir);
    const real = path.join(dir, "real");
    await mkdir(real);
    await symlink(real, path.join(dir, "alias"), process.platform === "win32" ? "junction" : "dir");
    const file = path.join(real, "config.xml");
    await writeFile(file, "<root><include>../alias/config.xml</include></root>");
    await expect(parseXmlConfig(file)).rejects.toMatchObject({ code: "INCLUDE_CYCLE" });
  });
  it.each(["<wrong/>", "<root/><root/>", "<root/><other/>"])(
    "rejects a non-single root document: %s",
    async (xml) => {
      await expect(parse(xml)).rejects.toMatchObject({ code: "INVALID_XML" });
    },
  );
  it("treats dictionary names as own keys without invoking Object.prototype", async () => {
    const config =
      await parse(`<root><global><default_scheme name="constructor">default</default_scheme></global>
      <gui><script name="__proto__">resolve();</script></gui>
      <list><item name="test"><scheme name="__proto__">value</scheme><scheme name="toString">string</scheme></item></list></root>`);
    const item = flattenTreeItems(config.tree)[0];
    if (!item) throw new Error("fixture item missing");
    expect(Object.hasOwn(item.schemeData, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(item.schemeData, "__proto__")?.value).toEqual(["value"]);
    expect(item.schemeData.constructor).toEqual(["default"]);
    expect(Object.hasOwn(config.gui.scripts, "__proto__")).toBe(true);
  });
  it.each(["0", "-1", "Infinity", "2147483648", "10oops"])(
    "normalizes an invalid timeout %s before IPC",
    async (timeout) => {
      const config = await parse(
        `<root><gui><on_before_convert timeout="${timeout}">resolve();</on_before_convert></gui></root>`,
      );
      expect(config.gui.onBeforeConvert[0]?.timeoutMs).toBe(30000);
      expect(config.diagnostics.length).toBeGreaterThan(0);
    },
  );
});
