import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { zipPortableWindowsLayout } from "../src/package-cli.ts";

it.skipIf(process.platform !== "win32")(
  "round-trips hidden payloads and quoted Unicode ZIP paths with real PowerShell",
  () => {
    const build = fileURLToPath(new URL("../../../build/", import.meta.url));
    mkdirSync(build, { recursive: true });
    const dir = mkdtempSync(path.join(build, "zip-roundtrip-"));
    try {
      const layout = path.join(dir, "源文件 it's here");
      mkdirSync(path.join(layout, "runtime"), { recursive: true });
      mkdirSync(path.join(layout, "app"));
      const exe = path.join(dir, "app.exe");
      const hidden = path.join(layout, "app/hidden.txt");
      const zip = path.join(dir, "it's a 中文.zip");
      const extracted = path.join(dir, "extracted");
      writeFileSync(exe, "MZ test");
      writeFileSync(hidden, "隐藏 payload");
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
      zipPortableWindowsLayout(exe, layout, zip);
      const unpack = spawnSync(
        "pwsh",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "[IO.Compression.ZipFile]::ExtractToDirectory($env:XRESCONV_TEST_ZIP, $env:XRESCONV_TEST_DEST)",
        ],
        {
          env: { ...process.env, XRESCONV_TEST_ZIP: zip, XRESCONV_TEST_DEST: extracted },
          timeout: 10_000,
          windowsHide: true,
        },
      );
      expect(unpack.error).toBeUndefined();
      expect(unpack.status, unpack.stderr?.toString()).toBe(0);
      expect(readFileSync(path.join(extracted, "xresconv-gui/app/hidden.txt"), "utf8")).toBe(
        "隐藏 payload",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
