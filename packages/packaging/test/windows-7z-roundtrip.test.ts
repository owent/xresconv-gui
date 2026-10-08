import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { sevenZipPortableWindowsLayout } from "../src/package-cli.ts";
import { ResourceZip } from "../src/resource-archive.ts";

it.skipIf(process.platform !== "win32")(
  "round-trips hidden payloads and quoted Unicode 7z paths",
  () => {
    const build = fileURLToPath(new URL("../../../build/", import.meta.url));
    mkdirSync(build, { recursive: true });
    const dir = mkdtempSync(path.join(build, "7z-roundtrip-"));
    try {
      const layout = path.join(dir, "源文件 it's here");
      mkdirSync(path.join(layout, "runtime"), { recursive: true });
      mkdirSync(path.join(layout, "app"));
      const exe = path.join(dir, "app.exe");
      const hidden = path.join(layout, "app-resources.zip");
      const archive = path.join(dir, "it's a 中文.7z");
      const extracted = path.join(dir, "extracted");
      writeFileSync(exe, "MZ test");
      const zip = new ResourceZip();
      zip.addFile("app/hidden.txt", Buffer.from("隐藏 payload"), "", 0o644);
      writeFileSync(hidden, zip.toBuffer());
      writeFileSync(path.join(layout, "runtime-manifest.json"), "{}");
      const mark = spawnSync(
        "pwsh",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "[IO.File]::SetAttributes($env:XRESCONV_TEST_FILE, [IO.FileAttributes]::Hidden)",
        ],
        {
          env: { ...process.env, XRESCONV_TEST_FILE: hidden },
          timeout: 10_000,
          windowsHide: true,
        },
      );
      expect(mark.error).toBeUndefined();
      expect(mark.status).toBe(0);
      sevenZipPortableWindowsLayout(exe, layout, archive);
      const unpack = spawnSync("7z", ["x", archive, `-o${extracted}`, "-y", "-bso0", "-bsp0"], {
        timeout: 10_000,
        windowsHide: true,
      });
      expect(unpack.error).toBeUndefined();
      expect(unpack.status, unpack.stderr?.toString()).toBe(0);
      const unpacked = new ResourceZip(
        readFileSync(path.join(extracted, "xresconv-gui/app-resources.zip")),
      );
      expect(unpacked.getEntry("app/hidden.txt")?.getData().toString("utf8")).toBe("隐藏 payload");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
