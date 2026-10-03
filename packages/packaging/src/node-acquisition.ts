import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { NodeAcquisition } from "./assemble.ts";
import type { ReleaseTarget } from "./types.ts";

function digest(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

async function get(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!response.ok) throw new Error(`Node download failed: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Cross builds verify official archives and obtain ABI from matching official headers; never run target Node. */
export async function acquireCrossNode(
  target: ReleaseTarget,
  buildDir: string,
): Promise<NodeAcquisition> {
  const version = process.versions.node;
  if (version.split(".")[0] !== target.nodeVersion)
    throw new Error("cross build host Node major must match the pinned target");
  const os = target.os === "windows" ? "win" : target.os === "macos" ? "darwin" : "linux";
  const arch = target.arch === "aarch64" ? "arm64" : target.arch === "x86_64" ? "x64" : target.arch;
  const base = `https://nodejs.org/dist/v${version}`;
  const checksums = (await get(`${base}/SHASUMS256.txt`)).toString("utf8");
  const archiveName = `node-v${version}-${os}-${arch}.${target.os === "windows" ? "zip" : "tar.xz"}`;
  const headerName = `node-v${version}-headers.tar.gz`;
  const dir = path.join(buildDir, `node-v${version}-${os}-${arch}`);
  mkdirSync(dir, { recursive: true });
  for (const name of [archiveName, headerName]) {
    const matches = checksums
      .split(/\r?\n/)
      .map((line) => line.split(/\s+/))
      .filter((entry) => entry[1] === name);
    const expected = matches.length === 1 ? matches[0]?.[0] : undefined;
    if (!expected || !/^[a-f0-9]{64}$/.test(expected))
      throw new Error(`missing official Node checksum: ${name}`);
    const archive = path.join(dir, name);
    if (!existsSync(archive) || digest(readFileSync(archive)) !== expected)
      writeFileSync(archive, await get(`${base}/${name}`));
    if (digest(readFileSync(archive)) !== expected)
      throw new Error(`Node archive checksum mismatch: ${name}`);
    const args = ["-xf", archive, "-C", dir];
    if (name === headerName) args.push(`node-v${version}/include/node/node_version.h`);
    const extracted = spawnSync("tar", args, {
      stdio: "inherit",
      windowsHide: true,
      timeout: 60_000,
    });
    if (extracted.error || extracted.status !== 0)
      throw new Error(`Node archive extraction failed: ${name}`);
  }
  const header = readFileSync(
    path.join(dir, `node-v${version}/include/node/node_version.h`),
    "utf8",
  );
  const nodeAbi = /^#define NODE_MODULE_VERSION\s+(\d+)/m.exec(header)?.[1];
  if (!nodeAbi) throw new Error("official Node headers carry no module ABI");
  const binary = path.join(
    dir,
    `node-v${version}-${os}-${arch}`,
    target.os === "windows" ? "node.exe" : "bin/node",
  );
  const expectedSha256 = digest(readFileSync(binary));
  return {
    path: binary,
    source: `${base}/${archiveName}`,
    expectedSha256,
    crossFacts: { exactVersion: version, nodeAbi, os: target.os, arch: target.arch },
  };
}
