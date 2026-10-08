import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  packApplicationResources,
  ResourceZip,
  readApplicationResources,
} from "../src/resource-archive.ts";
import type { ManifestFile } from "../src/types.ts";
import { verifyLayoutPayload } from "../src/verify-portable.ts";
import { pickTarget, sampleManifest } from "./fixtures.ts";

let root: string;
let files: ManifestFile[];
beforeEach(() => {
  const build = fileURLToPath(new URL("../../../build/resource-archive-tests/", import.meta.url));
  mkdirSync(build, { recursive: true });
  root = mkdtempSync(path.join(build, "case-"));
  mkdirSync(path.join(root, "app"));
  const data = Buffer.from("export default '资源';");
  writeFileSync(path.join(root, "app/service.mjs"), data);
  files = [
    {
      path: "app/service.mjs",
      size: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      origin: "build:@xresconv/backend",
      license: "MIT",
    },
  ];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("ships a single archive and verifies its real uncompressed payload", () => {
  const resourceArchive = packApplicationResources(root, files);
  expect(existsSync(path.join(root, "app"))).toBe(false);
  const manifest = {
    ...sampleManifest(
      pickTarget(
        (target) =>
          target.os === "windows" && target.arch === "x64" && target.variant === "bootstrap",
      ),
    ),
    files,
    resourceArchive,
  };
  expect(() => verifyLayoutPayload(root, manifest)).not.toThrow();
  expect(
    readApplicationResources(root, manifest).get("app/service.mjs")?.data.toString(),
  ).toContain("资源");
  writeFileSync(path.join(root, resourceArchive.path), "broken");
  expect(() => verifyLayoutPayload(root, manifest)).toThrow(/archive size\/SHA-256 mismatch/);
});

it("rejects missing and extra entries even when the archive digest matches", () => {
  const resourceArchive = packApplicationResources(root, files);
  const zip = new ResourceZip(readFileSync(path.join(root, resourceArchive.path)));
  zip.addFile("app/unexpected.js", Buffer.from("extra"), "", 0o644);
  const data = zip.toBuffer();
  writeFileSync(path.join(root, resourceArchive.path), data);
  resourceArchive.size = data.length;
  resourceArchive.sha256 = createHash("sha256").update(data).digest("hex");
  expect(() => readApplicationResources(root, { files, resourceArchive })).toThrow(/unexpected/);
  const missing = { ...files[0], path: "app/missing.mjs" } as ManifestFile;
  expect(() =>
    readApplicationResources(root, { files: [...files, missing], resourceArchive }),
  ).toThrow();
});

it("checks the uncompressed digest and archive identity", () => {
  const resourceArchive = packApplicationResources(root, files);
  expect(() =>
    readApplicationResources(root, {
      files: [{ ...files[0], sha256: "0".repeat(64) } as ManifestFile],
      resourceArchive,
    }),
  ).toThrow(/resource mismatch/);
  expect(() => readApplicationResources(root, { files })).toThrow(/archive missing/);
});
