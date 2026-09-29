import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { tarPortableBootstrapLayout } from "../src/package-cli.ts";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawnSync: vi.fn(),
}));

const root = fileURLToPath(new URL("../../../", import.meta.url));
const build = path.join(root, "build");
const stage = path.join(build, "portable-tar");
const run = vi.mocked(spawnSync);
let dir: string;
let exe: string;
let layout: string;
let dest: string;

function result(status = 0) {
  return { status, stdout: "", stderr: "test diagnostic", pid: 1, output: [], signal: null };
}

beforeEach(() => {
  mkdirSync(build, { recursive: true });
  dir = mkdtempSync(path.join(build, "linux-archive-test-"));
  exe = path.join(dir, "app");
  layout = path.join(dir, "layout");
  dest = path.join(dir, "output.tar.zst");
  mkdirSync(path.join(layout, "runtime"), { recursive: true });
  mkdirSync(path.join(layout, "app"));
  writeFileSync(exe, "ELF test");
  writeFileSync(path.join(layout, "runtime/node"), "node");
  writeFileSync(path.join(layout, "app/service.mjs"), "export {};");
  writeFileSync(path.join(layout, "runtime-manifest.json"), "{}");
  run.mockReset();
  run.mockImplementation((command, args, options) => {
    if (command === "tar" && args?.[0] === "-cf")
      writeFileSync(path.join(String(options?.cwd), "payload.tar"), "tar payload");
    if (command === "zstd" && args?.includes("-o"))
      writeFileSync(
        path.join(String(options?.cwd), "payload.tar.zst"),
        Buffer.from("28b52ffd00", "hex"),
      );
    return result();
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

it("compresses the Linux portable tar at explicit level 19 and verifies it", () => {
  tarPortableBootstrapLayout(exe, layout, dest);
  expect(existsSync(dest)).toBe(true);
  expect(run.mock.calls[0]?.[1]).toEqual(["-cf", "payload.tar", "xresconv-gui"]);
  expect(run.mock.calls[1]?.[1]).toEqual([
    "-19",
    "-T2",
    "--long=27",
    "payload.tar",
    "-o",
    "payload.tar.zst",
  ]);
  expect(run.mock.calls[2]?.[1]).toEqual(["-t", "payload.tar.zst"]);
  expect(existsSync(stage)).toBe(false);
});

it.each(["tar", "zstd", "header", "integrity"])(
  "keeps the previous Linux archive and checksum if %s fails",
  (failure) => {
    writeFileSync(dest, "previous archive");
    writeFileSync(`${dest}.sha256`, "previous checksum");
    run.mockImplementation((command, args, options) => {
      if (command === "tar") {
        if (failure === "tar") return result(1);
        writeFileSync(path.join(String(options?.cwd), "payload.tar"), "tar payload");
      }
      if (command === "zstd" && args?.includes("-o")) {
        writeFileSync(
          path.join(String(options?.cwd), "payload.tar.zst"),
          failure === "header" ? "bad frame" : Buffer.from("28b52ffd00", "hex"),
        );
        if (failure === "zstd") return result(1);
      }
      if (command === "zstd" && args?.includes("-t") && failure === "integrity") return result(1);
      return result();
    });
    expect(() => tarPortableBootstrapLayout(exe, layout, dest)).toThrow();
    expect(readFileSync(dest, "utf8")).toBe("previous archive");
    expect(readFileSync(`${dest}.sha256`, "utf8")).toBe("previous checksum");
    expect(existsSync(stage)).toBe(false);
  },
);
