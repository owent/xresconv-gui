import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { acquireCrossNode } from "../src/node-acquisition.ts";
import { pickTarget } from "./fixtures.ts";

const build = fileURLToPath(new URL("../../../build/node-acquisition-tests/", import.meta.url));
const roots: string[] = [];
function directory() {
  mkdirSync(build, { recursive: true });
  const dir = mkdtempSync(path.join(build, "case-"));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("rejects failed official downloads", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("unavailable", { status: 503 }));
  const target = pickTarget((value) => value.os === "windows" && value.arch === "arm64");
  await expect(acquireCrossNode(target, directory())).rejects.toThrow("503");
});

it("rejects a missing official target checksum", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(""));
  const target = pickTarget((value) => value.os === "windows" && value.arch === "arm64");
  await expect(acquireCrossNode(target, directory())).rejects.toThrow(
    "missing official Node checksum",
  );
});

it("rejects target archive corruption before extraction", async () => {
  const name = `node-v${process.versions.node}-win-arm64.zip`;
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(`${"a".repeat(64)}  ${name}\n`))
    .mockResolvedValueOnce(new Response("tampered"));
  const target = pickTarget((value) => value.os === "windows" && value.arch === "arm64");
  await expect(acquireCrossNode(target, directory())).rejects.toThrow("archive checksum mismatch");
});
