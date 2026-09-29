import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { tarZstPortableWindowsLayout, zipPortableWindowsLayout } from "../src/package-cli.ts";

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
let dir: string;
let exe: string;
let layout: string;
let dest: string;
function expectStageCleaned() {
  expect(stagedDirs).toHaveLength(1);
  expect(stagedDirs.filter(existsSync)).toEqual([]);
}

function result(status = 0, stdout = "") {
  return { status, stdout, stderr: "test diagnostic", pid: 1, output: [], signal: null };
}

beforeEach(() => {
  mkdirSync(build, { recursive: true });
  dir = mkdtempSync(path.join(build, "windows-archive-test-"));
  exe = path.join(dir, "app.exe");
  layout = path.join(dir, "layout");
  dest = path.join(dir, "output.tar.zst");
  mkdirSync(path.join(layout, "runtime"), { recursive: true });
  mkdirSync(path.join(layout, "app"));
  writeFileSync(exe, "MZ test");
  writeFileSync(path.join(layout, "runtime/node.exe"), "node");
  writeFileSync(path.join(layout, "app/service.mjs"), "export {};");
  writeFileSync(path.join(layout, "runtime-manifest.json"), "{}");
  stagedDirs.length = 0;
  run.mockReset();
  run.mockImplementation((command, args, options) => {
    const argv = args as string[];
    if (argv.includes("--version"))
      return result(0, command === "tar" ? "bsdtar 3.8.8" : "zstd 1.5.7");
    if (command === "zstd" && argv.includes("-o")) {
      const output = argv[argv.indexOf("-o") + 1] as string;
      writeFileSync(
        path.resolve(String(options?.cwd ?? root), output),
        Buffer.from("28b52ffd00", "hex"),
      );
    }
    return result();
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const stage of stagedDirs) rmSync(stage, { recursive: true, force: true });
});

it("uses relative tar members and file compression, independent of GNU/bsdtar drive syntax", () => {
  tarZstPortableWindowsLayout(exe, layout, dest);
  expect(existsSync(dest)).toBe(true);
  const tar = run.mock.calls.find(([command, args]) => command === "tar" && args?.includes("-cf"));
  expect(tar).toBeDefined();
  expect(tar?.[1]).toEqual(["-cf", "payload.tar", "xresconv-gui"]);
  expect(tar?.[2]?.cwd).toBeTruthy();
  expect(run.mock.calls.some(([, args]) => args?.includes("--use-compress-program"))).toBe(false);
  expect(run.mock.calls.some(([command, args]) => command === "zstd" && args?.includes("-t"))).toBe(
    true,
  );
  expectStageCleaned();
});

it.each(["tar", "zstd"])("preserves a previous archive and checksum when %s fails", (failing) => {
  writeFileSync(dest, "previous valid archive");
  writeFileSync(`${dest}.sha256`, "previous checksum");
  const normal = run.getMockImplementation();
  run.mockImplementation((command, args, options) => {
    if (command === failing && !(args as string[]).includes("--version")) {
      if (command === "zstd") normal?.(command, args, options);
      return result(1);
    }
    return normal?.(command, args, options) ?? result();
  });
  expect(() => tarZstPortableWindowsLayout(exe, layout, dest)).toThrow(/failed/);
  expect(readFileSync(dest, "utf8")).toBe("previous valid archive");
  expect(readFileSync(`${dest}.sha256`, "utf8")).toBe("previous checksum");
  expectStageCleaned();
});

it.each(["missing", "nonzero", "timeout"])("fails closed for a %s zstd probe", (failure) => {
  run.mockImplementation(() => ({
    ...result(failure === "nonzero" ? 1 : 0),
    ...(failure !== "nonzero" ? { error: new Error(failure) } : {}),
  }));
  expect(() => tarZstPortableWindowsLayout(exe, layout, dest)).toThrow(/zstd/);
  expect(existsSync(dest)).toBe(false);
  expectStageCleaned();
});

it.each([false, true])(
  "rejects exit-zero output that is missing or invalid (written=%s)",
  (written) => {
    run.mockImplementation((command, args, options) => {
      if (written && command === "zstd" && (args as string[]).includes("-o")) {
        const argv = args as string[];
        writeFileSync(
          path.resolve(String(options?.cwd ?? root), argv[argv.indexOf("-o") + 1] as string),
          "not zstd",
        );
      }
      return result(0, "bsdtar 3.8.8");
    });
    expect(() => tarZstPortableWindowsLayout(exe, layout, dest)).toThrow();
    expect(existsSync(dest)).toBe(false);
    expectStageCleaned();
  },
);

it("removes partial staging when copying the source layout fails", () => {
  rmSync(path.join(layout, "runtime"), { recursive: true });
  expect(() => tarZstPortableWindowsLayout(exe, layout, dest)).toThrow();
  expectStageCleaned();
});

it("invalidates an old checksum only after a verified replacement exists", () => {
  writeFileSync(`${dest}.sha256`, "old digest");
  tarZstPortableWindowsLayout(exe, layout, dest);
  expect(existsSync(`${dest}.sha256`)).toBe(false);
});

it("rejects a truncated stream even when its zstd magic is valid", () => {
  const normal = run.getMockImplementation();
  run.mockImplementation((command, args, options) => {
    if (command === "zstd" && (args as string[]).includes("-t")) return result(1);
    return normal?.(command, args, options) ?? result();
  });
  expect(() => tarZstPortableWindowsLayout(exe, layout, dest)).toThrow(/integrity check failed/);
  expect(existsSync(dest)).toBe(false);
  expectStageCleaned();
});

it("does not publish partial ZIP output when PowerShell fails", () => {
  run.mockImplementation((_command, _args, options) => {
    const output = options?.env?.XRESCONV_ARCHIVE_DEST;
    if (output) writeFileSync(output, Buffer.from("504b0304", "hex"));
    return result(1);
  });
  expect(() => zipPortableWindowsLayout(exe, layout, dest)).toThrow(/ZIP creation failed/);
  expect(existsSync(dest)).toBe(false);
  expectStageCleaned();
});

it("passes ZIP paths as data, including apostrophes, and uses an API retaining hidden files", () => {
  dest = path.join(dir, "it's an archive.zip");
  run.mockImplementation((_command, _args, options) => {
    const output = options?.env?.XRESCONV_ARCHIVE_DEST;
    if (output) writeFileSync(output, Buffer.from("504b0304", "hex"));
    return result();
  });
  zipPortableWindowsLayout(exe, layout, dest);
  const script = String(run.mock.calls[0]?.[1]?.at(-1));
  expect(script).not.toContain(dest);
  expect(script).toContain("CreateFromDirectory");
  expect(existsSync(dest)).toBe(true);
  expectStageCleaned();
});
