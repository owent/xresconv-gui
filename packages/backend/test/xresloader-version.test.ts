import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readXresloaderVersion, supportsNativeParallelism } from "../src/convert/parallelism.ts";

const Zip = createRequire(import.meta.url)("adm-zip") as new () => {
  addFile(name: string, data: Buffer): void;
  writeZip(path: string): void;
};
const dir = mkdtempSync(path.join(tmpdir(), "xresconv-version-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function writeJar(filename: string, properties?: string): string {
  const jar = new Zip();
  if (properties !== undefined) jar.addFile("application.properties", Buffer.from(properties));
  const jarPath = path.join(dir, filename);
  jar.writeZip(jarPath);
  return jarPath;
}

describe("xresloader version capabilities", () => {
  it("按 JAR 属性判断，重命名和原路径替换均不沿用过期版本", async () => {
    const jar = writeJar("xresloader-2.23.0.jar", "version=2.24.0-beta\r\nname=xresloader");
    expect(await readXresloaderVersion(jar)).toBe("2.24.0-beta");
    writeJar("xresloader-2.23.0.jar", "version=2.23.0\n");
    expect(await readXresloaderVersion(jar)).toBe("2.23.0");
    expect(await readXresloaderVersion(writeJar("new.jar", "version: 3.0.0\n"))).toBe("3.0.0");
  });

  it("已取消的版本读取不会回退调度", async () => {
    const reason = new Error("cancelled");
    await expect(
      readXresloaderVersion(path.join(dir, "missing.jar"), AbortSignal.abort(reason)),
    ).rejects.toBe(reason);
  });

  it("缺失属性、异常 JAR 和超限属性返回未知版本", async () => {
    expect(await readXresloaderVersion(writeJar("empty.jar"))).toBeNull();
    expect(
      await readXresloaderVersion(writeJar("large.jar", `version=2.24.0\n${"#".repeat(65536)}`)),
    ).toBeNull();
    const invalid = path.join(dir, "invalid-2.24.0.jar");
    writeFileSync(invalid, "not a jar");
    expect(await readXresloaderVersion(invalid)).toBeNull();
    expect(await readXresloaderVersion(path.join(dir, "missing.jar"))).toBeNull();
  });

  it.each([
    { properties: "version=2.24.0\nversion=2.23.7\n", expected: "2.23.7" },
    { properties: "version=2.23.7\nversion=2.24.0\n", expected: "2.24.0" },
    { properties: "version 2.24.0-beta\n", expected: "2.24.0-beta" },
    { properties: "ver\\u0073ion=2.2\\u0034.0-beta\n", expected: "2.24.0-beta" },
    { properties: "version=2.\\\r\n  24.0-beta\r\n", expected: "2.24.0-beta" },
    { properties: "name=custom\\\nversion=2.24.0\n", expected: null },
    { properties: "version=2.24.0\nversion\n", expected: null },
    { properties: "version=2.24.0\ninvalid=\\uZZZZ\n", expected: null },
    { properties: " # version=3.0\n\t!version=4.0\nversion\t :\t 2.24.0\n", expected: "2.24.0" },
    { properties: "version\\=ignored=3.0\nversion\\:ignored=4.0\n", expected: null },
    { properties: "version=2.24.0\\t\\r\\n\\f\n", expected: "2.24.0" },
    { properties: "version=2.24.0\\", expected: "2.24.0" },
    { properties: "name=custom\\\\\nversion=2.24.0\n", expected: "2.24.0" },
    { properties: "name=custom\\\n!comment\\\nversion=2.24.0\n", expected: null },
  ])("按 Java Properties 语义读取 $properties", async ({ properties, expected }) => {
    expect(await readXresloaderVersion(writeJar("properties.jar", properties))).toBe(expected);
  });

  it.each([
    "2.24",
    "2.24.0-beta",
    "2.24.0-beta.2",
    "2.24.0+build.1",
    "2.24.0-beta+build.1",
    "2.25.0",
    "3.0.0",
  ])("%s 支持内置并发", (version) => expect(supportsNativeParallelism(version)).toBe(true));

  it.each([null, "", "Unknown", "garbage 2.24.0", "2.24.0 invalid", "2.23.99", "2.9.0", "1.99.0"])(
    "%s 使用兼容调度",
    (version) => expect(supportsNativeParallelism(version)).toBe(false),
  );
});
