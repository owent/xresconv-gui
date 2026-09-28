#!/usr/bin/env node
/** Portable 产物验证入口（portable-build.yml 使用；本机也可复跑）。
 *
 * 单目标：--os=macos|linux --arch=x64|arm64|aarch64 [--variant=offline|bootstrap]
 *         （Linux 归档发行版无关，无需 distro）
 * 聚合：  --aggregate（build/release-artifacts 全集合 + SHA-256 边车）
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gitHead } from "../packages/packaging/src/package-cli.ts";
import {
  verifyPortableAggregate,
  verifyPortableArtifacts,
} from "../packages/packaging/src/verify-portable.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  options: {
    os: { type: "string" },
    arch: { type: "string" },
    variant: { type: "string", default: "offline" },
    aggregate: { type: "boolean", default: false },
  },
});

const version = (
  JSON.parse(readFileSync(path.join(ROOT, "src-tauri/tauri.conf.json"), "utf8")) as {
    version: string;
  }
).version;

if (values.aggregate) {
  const files = await verifyPortableAggregate(path.join(ROOT, "build/release-artifacts"), version);
  console.log(`Verified ${files.length} portable artifacts and SHA-256 sidecars`);
} else {
  if (values.os !== "macos" && values.os !== "linux")
    throw new Error("--os must be macos or linux (aggregate mode covers the full set)");
  if (values.variant !== "offline" && values.variant !== "bootstrap")
    throw new Error("--variant must be offline or bootstrap");
  if (!values.arch) throw new Error("--arch is required");
  const verified = await verifyPortableArtifacts(
    path.join(ROOT, "build/dist"),
    {
      os: values.os,
      arch: values.arch,
      variant: values.variant,
      version,
      commit: gitHead(),
    },
    path.join(ROOT, "build/portable-verify"),
  );
  console.log(`verified ${verified.length} artifact(s)`);
}
