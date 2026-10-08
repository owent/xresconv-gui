import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { ManifestFile, ResourceArchive, RuntimeManifest } from "./types.ts";

export const RESOURCE_ARCHIVE_NAME = "app-resources.zip";

interface ZipEntry {
  entryName: string;
  isDirectory: boolean;
  attr: number;
  header: { time: Date };
  getData(): Buffer;
}
interface Zip {
  addFile(name: string, data: Buffer, comment: string, mode: number): void;
  getEntry(name: string): ZipEntry | null;
  getEntries(): ZipEntry[];
  toBuffer(): Buffer;
}
// adm-zip is an existing root dependency, also supplied to user scripts.
export const ResourceZip = createRequire(new URL("../../../package.json", import.meta.url))(
  "adm-zip",
) as new (
  input?: Buffer,
) => Zip;

function hash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function isResourcePath(name: string): boolean {
  return (
    name.startsWith("app/") &&
    !/[\\:]/.test(name) &&
    !name.includes("\0") &&
    name.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/** Pack the exact application inventory, then remove its loose staging tree. */
export function packApplicationResources(
  layoutRoot: string,
  files: readonly ManifestFile[],
): ResourceArchive {
  const zip = new ResourceZip();
  for (const file of files.filter((item) => item.path.startsWith("app/"))) {
    if (!isResourcePath(file.path)) throw new Error(`invalid resource path: ${file.path}`);
    const source = path.join(layoutRoot, file.path);
    const content = readFileSync(source);
    if (content.length !== file.size || hash(content) !== file.sha256)
      throw new Error(`resource changed during packaging: ${file.path}`);
    zip.addFile(file.path, content, "", statSync(source).mode & 0o777);
    const entry = zip.getEntry(file.path);
    if (entry === null) throw new Error(`resource entry missing: ${file.path}`);
    entry.header.time = new Date(2000, 0, 1, 0, 0, 0);
  }
  const content = zip.toBuffer();
  writeFileSync(path.join(layoutRoot, RESOURCE_ARCHIVE_NAME), content);
  const archive: ResourceArchive = {
    path: RESOURCE_ARCHIVE_NAME,
    size: content.length,
    sha256: hash(content),
  };
  readApplicationResources(layoutRoot, { files: [...files], resourceArchive: archive });
  rmSync(path.join(layoutRoot, "app"), { recursive: true });
  return archive;
}

/** Verify archive bytes, exact entry set and every uncompressed file. */
export function readApplicationResources(
  layoutRoot: string,
  manifest: Pick<RuntimeManifest, "files" | "resourceArchive">,
): Map<string, { data: Buffer; mode: number }> {
  const archive = manifest.resourceArchive;
  if (!archive || archive.path !== RESOURCE_ARCHIVE_NAME)
    throw new Error("application resource archive missing from manifest");
  const content = readFileSync(path.join(layoutRoot, archive.path));
  if (content.length !== archive.size || hash(content) !== archive.sha256)
    throw new Error("application resource archive size/SHA-256 mismatch");
  const expected = new Map(
    manifest.files.filter((file) => file.path.startsWith("app/")).map((file) => [file.path, file]),
  );
  if (expected.size === 0) throw new Error("application resource inventory is empty");
  const resources = new Map<string, { data: Buffer; mode: number }>();
  for (const entry of new ResourceZip(content).getEntries()) {
    const mode = entry.attr >>> 16;
    if (
      !isResourcePath(entry.entryName) ||
      entry.isDirectory ||
      (mode & 0o170000) !== 0o100000 ||
      resources.has(entry.entryName)
    )
      throw new Error(`invalid application resource entry: ${entry.entryName}`);
    const file = expected.get(entry.entryName);
    if (file === undefined) throw new Error(`unexpected application resource: ${entry.entryName}`);
    const data = entry.getData();
    if (data.length !== file.size || hash(data) !== file.sha256)
      throw new Error(`application resource mismatch: ${file.path}`);
    resources.set(file.path, { data, mode: mode & 0o777 });
  }
  if (resources.size !== expected.size) throw new Error("application resource entries missing");
  return resources;
}

/** Media tests unpack into an empty test directory and run the Node chain there. */
export function extractApplicationResources(
  layoutRoot: string,
  manifest: RuntimeManifest,
  dest: string,
): void {
  const resources = readApplicationResources(layoutRoot, manifest);
  for (const [name, resource] of resources) {
    const target = path.join(dest, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, resource.data, { flag: "wx" });
    if (process.platform !== "win32") chmodSync(target, resource.mode);
  }
}
