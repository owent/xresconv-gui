import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sevenZipPortableWindowsLayout } from "../src/package-cli.ts";

const stagedDirs = vi.hoisted(() => [] as string[]);
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    mkdtempSync: (prefix: string) => {
      const created = fs.mkdtempSync(prefix);
      if (prefix.endsWith("windows-archive-")) stagedDirs.push(created);
      return created;
    },
  };
});
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawnSync: vi.fn(),
}));

const root = fileURLToPath(new URL("../../../", import.meta.url));
const build = path.join(root, "build");
const run = vi.mocked(spawnSync);
const magic = Buffer.from("377abcaf271c0004", "hex");
let dir: string;
let exe: string;
let layout: string;
let dest: string;

function result(status = 0) {
  return { status, stdout: "", stderr: "test diagnostic", pid: 1, output: [], signal: null };
}

function expectStageCleaned() {
  expect(stagedDirs).toHaveLength(1);
  expect(stagedDirs.filter(existsSync)).toEqual([]);
}

beforeEach(() => {
  mkdirSync(build, { recursive: true });
  dir = mkdtempSync(path.join(build, "windows-archive-test-"));
  exe = path.join(dir, "app.exe");
  layout = path.join(dir, "layout");
  dest = path.join(dir, "output.7z");
  mkdirSync(path.join(layout, "runtime"), { recursive: true });
  mkdirSync(path.join(layout, "app"));
  writeFileSync(exe, "MZ test");
  writeFileSync(path.join(layout, "runtime/node.exe"), "node");
  writeFileSync(path.join(layout, "app/service.mjs"), "export {};");
  writeFileSync(path.join(layout, "runtime-manifest.json"), "{}");
  stagedDirs.length = 0;
  run.mockReset();
  run.mockImplementation((command, args, options) => {
    if (command === "7z" && args?.[0] === "a")
      writeFileSync(path.join(String(options?.cwd), "payload.7z"), magic);
    return result();
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const stage of stagedDirs) rmSync(stage, { recursive: true, force: true });
});

it("uses ultra solid 7z compression for the staged top-level directory", () => {
  sevenZipPortableWindowsLayout(exe, layout, dest);
  expect(existsSync(dest)).toBe(true);
  expect(run.mock.calls[0]?.[0]).toBe("7z");
  expect(run.mock.calls[0]?.[1]).toEqual([
    "a",
    "-t7z",
    "-mx=9",
    "-mmt=2",
    "-ms=on",
    "-bso0",
    "-bsp0",
    "payload.7z",
    "xresconv-gui",
  ]);
  expect(run.mock.calls[1]?.[1]).toEqual(["t", "-bso0", "-bsp0", "payload.7z"]);
  expectStageCleaned();
});

it("stages bootstrapper and fixed runtime for their respective variants", () => {
  const bootstrapper = path.join(dir, "bootstrapper.exe");
  writeFileSync(bootstrapper, "MZ bootstrapper");
  run.mockImplementation((command, args, options) => {
    if (command === "7z" && args?.[0] === "a") {
      expect(
        readFileSync(
          path.join(String(options?.cwd), "xresconv-gui/MicrosoftEdgeWebview2Setup.exe"),
          "utf8",
        ),
      ).toBe("MZ bootstrapper");
      writeFileSync(path.join(String(options?.cwd), "payload.7z"), magic);
    }
    return result();
  });
  sevenZipPortableWindowsLayout(exe, layout, dest, { bootstrapper });
  expectStageCleaned();
});

it.each(["missing", "nonzero", "corrupt", "integrity"])(
  "preserves the previous archive and checksum after %s failure",
  (failure) => {
    writeFileSync(dest, "previous valid archive");
    writeFileSync(`${dest}.sha256`, "previous checksum");
    run.mockImplementation((command, args, options) => {
      if (command === "7z" && args?.[0] === "a") {
        if (failure === "missing") return { ...result(), error: new Error("missing 7z") };
        writeFileSync(
          path.join(String(options?.cwd), "payload.7z"),
          failure === "corrupt" ? "bad header" : magic,
        );
        if (failure === "nonzero") return result(1);
      }
      if (command === "7z" && args?.[0] === "t" && failure === "integrity") return result(1);
      return result();
    });
    expect(() => sevenZipPortableWindowsLayout(exe, layout, dest)).toThrow();
    expect(readFileSync(dest, "utf8")).toBe("previous valid archive");
    expect(readFileSync(`${dest}.sha256`, "utf8")).toBe("previous checksum");
    expectStageCleaned();
  },
);

it("invalidates a prior checksum only after a verified 7z replacement", () => {
  writeFileSync(`${dest}.sha256`, "old digest");
  sevenZipPortableWindowsLayout(exe, layout, dest);
  expect(existsSync(dest)).toBe(true);
  expect(existsSync(`${dest}.sha256`)).toBe(false);
  expectStageCleaned();
});
