import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { copyFixedRuntime, WEBVIEW_LOCALES } from "../src/webview-locales.ts";

const build = fileURLToPath(new URL("../../../build/", import.meta.url));
let dir: string;
let source: string;
let dest: string;

beforeEach(() => {
  mkdirSync(build, { recursive: true });
  dir = mkdtempSync(path.join(build, "webview-locales-test-"));
  source = path.join(dir, "source");
  dest = path.join(dir, "dest");
  mkdirSync(path.join(source, "Locales"), { recursive: true });
  for (const locale of [...WEBVIEW_LOCALES, "hu", "ar", "en-GB"])
    for (const prefix of ["", "copilot_overlay_strings_"])
      writeFileSync(path.join(source, "Locales", `${prefix}${locale}.pak`), locale);
  for (const name of ["msedgewebview2.exe", "icudtl.dat", "msedge.dll", "LICENSE"])
    writeFileSync(path.join(source, name), name);
  writeFileSync(path.join(source, "Locales", "future_shared_resource.pak"), "unknown resource");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("copies ten locales including English fallback and Simplified Chinese without modifying the cache", () => {
  const before = readdirSync(path.join(source, "Locales"));
  const report = copyFixedRuntime(source, dest, "mainstream");
  expect(WEBVIEW_LOCALES).toHaveLength(10);
  expect(WEBVIEW_LOCALES).toContain("en-US");
  expect(WEBVIEW_LOCALES).toContain("zh-CN");
  for (const locale of WEBVIEW_LOCALES)
    expect(readFileSync(path.join(dest, "Locales", `${locale}.pak`), "utf8")).toBe(locale);
  expect(existsSync(path.join(dest, "Locales/hu.pak"))).toBe(false);
  expect(existsSync(path.join(dest, "Locales/copilot_overlay_strings_hu.pak"))).toBe(false);
  for (const name of ["icudtl.dat", "msedge.dll", "LICENSE", "Locales/future_shared_resource.pak"])
    expect(readFileSync(path.join(dest, name))).toEqual(readFileSync(path.join(source, name)));
  expect(readdirSync(path.join(source, "Locales"))).toEqual(before);
  expect(report.removedFiles).toBe(6);
  expect(report.removedBytes).toBeGreaterThan(0);
});

it.each(["en-US.pak", "zh-CN.pak", "copilot_overlay_strings_en-US.pak"])(
  "rejects incomplete retained locale families before copying: %s",
  (missing) => {
    rmSync(path.join(source, "Locales", missing));
    expect(() => copyFixedRuntime(source, dest, "mainstream")).toThrow(/locale/);
    expect(existsSync(dest)).toBe(false);
  },
);

it("retains every file in all-languages mode", () => {
  expect(copyFixedRuntime(source, dest, "all")).toEqual({ removedFiles: 0, removedBytes: 0 });
  expect(readdirSync(path.join(dest, "Locales"))).toEqual(
    readdirSync(path.join(source, "Locales")),
  );
});

it("rejects unknown locale policies without touching either tree", () => {
  expect(() => copyFixedRuntime(source, dest, "typo" as "all")).toThrow(/policy/);
  expect(existsSync(dest)).toBe(false);
});
