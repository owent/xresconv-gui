/** Shared native packaging workflow; platform scripts only select the OS. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { assembleRuntimeLayout } from "./assemble.ts";
import { loadTargets, validateRuntimeManifest } from "./load.ts";
import { artifactName, formatFor } from "./matrix.ts";
import type { ReleaseTarget, RuntimeManifest, TargetOs } from "./types.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function parsePackageArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      variant: { type: "string", default: "all" },
      arch: { type: "string" },
      distro: { type: "string" },
      "skip-assemble": { type: "boolean", default: false },
    },
  });
  if (!["all", "bootstrap", "offline"].includes(values.variant))
    throw new Error("invalid --variant");
  return values;
}

export function nativeArch(os: TargetOs, platform = process.platform, arch = process.arch): string {
  const wanted = os === "windows" ? "win32" : os === "macos" ? "darwin" : "linux";
  if (platform !== wanted || !["x64", "arm64"].includes(arch))
    throw new Error(`package-${os} requires a native x64/arm64 host`);
  return os === "linux" ? (arch === "arm64" ? "aarch64" : "x86_64") : arch;
}

export function detectDistro(text: string): string {
  const field = (name: string) =>
    new RegExp(`^${name}=(.*)$`, "m")
      .exec(text)?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, "") ?? "";
  const id = field("ID");
  const version = field("VERSION_ID");
  if (id === "ubuntu") return `${id}-${version}`;
  if (id === "debian" || id === "fedora") return `${id}-${version.split(".")[0]}`;
  throw new Error(`unsupported distro ${id}/${version}`);
}

/** Reuse never changes a manifest identity or silently trusts edited payloads. */
export function verifyReusableLayout(
  dir: string,
  target: ReleaseTarget,
  version: string,
  commit: string,
): RuntimeManifest {
  const manifest = validateRuntimeManifest(
    JSON.parse(readFileSync(path.join(dir, "runtime-manifest.json"), "utf8")),
  );
  for (const key of [
    "os",
    "arch",
    "distro",
    "variant",
    "targetTriple",
    "webviewStrategy",
    "minimumWebview",
    "osVersionRange",
  ] as const) {
    if (manifest[key] !== target[key]) throw new Error(`--skip-assemble target mismatch: ${key}`);
  }
  if (manifest.appVersion !== version || manifest.sourceCommit !== commit)
    throw new Error("--skip-assemble version/commit mismatch");
  for (const file of manifest.files) {
    const payload = readFileSync(path.join(dir, file.path));
    if (
      payload.length !== file.size ||
      createHash("sha256").update(payload).digest("hex") !== file.sha256
    )
      throw new Error(`--skip-assemble payload mismatch: ${file.path}`);
  }
  return manifest;
}

export function selectArtifact(dir: string, extension: string, builtAfter: number): string {
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith(extension))
        .map((name) => path.join(dir, name))
        .filter((file) => statSync(file).mtimeMs >= builtAfter)
    : [];
  if (files.length !== 1)
    throw new Error(`expected one fresh ${extension} artifact under ${dir}, found ${files.length}`);
  return files[0] as string;
}

function git(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error("cannot obtain repository identity");
  return result.stdout.trim();
}

function signingBundle(os: TargetOs): Record<string, unknown> {
  if (os === "macos" && process.env.XRESCONV_MACOS_SIGNING_IDENTITY)
    return { macOS: { signingIdentity: process.env.XRESCONV_MACOS_SIGNING_IDENTITY } };
  if (
    os !== "windows" ||
    (!process.env.XRESCONV_SIGN_CERT_THUMBPRINT && !process.env.XRESCONV_SIGN_COMMAND)
  )
    return {};
  return {
    windows: {
      digestAlgorithm: process.env.XRESCONV_SIGN_DIGEST_ALGORITHM ?? "sha256",
      timestampUrl: process.env.XRESCONV_SIGN_TIMESTAMP_URL ?? "http://timestamp.digicert.com",
      ...(process.env.XRESCONV_SIGN_CERT_THUMBPRINT
        ? { certificateThumbprint: process.env.XRESCONV_SIGN_CERT_THUMBPRINT }
        : {}),
      ...(process.env.XRESCONV_SIGN_COMMAND
        ? { signCommand: process.env.XRESCONV_SIGN_COMMAND }
        : {}),
    },
  };
}

export async function packageNative(os: TargetOs, args = process.argv.slice(2)): Promise<void> {
  const options = parsePackageArgs(args);
  const arch = nativeArch(os);
  if (options.arch !== undefined && options.arch !== arch)
    throw new Error("--arch must match the native host architecture");
  const distro = os === "linux" ? detectDistro(readFileSync("/etc/os-release", "utf8")) : undefined;
  if (options.distro !== undefined && options.distro !== distro)
    throw new Error("--distro must match the native build baseline");
  const version = (
    JSON.parse(readFileSync(path.join(ROOT, "src-tauri/tauri.conf.json"), "utf8")) as {
      version: string;
    }
  ).version;
  const tag =
    process.env.GITHUB_REF_TYPE === "tag"
      ? process.env.GITHUB_REF_NAME?.replace(/^v/, "")
      : undefined;
  if (tag && tag !== version)
    throw new Error(`release tag ${tag} disagrees with tauri.conf.json version ${version}`);
  const variants = options.variant === "all" ? ["bootstrap", "offline"] : [options.variant];
  if (options["skip-assemble"] && variants.length > 1)
    throw new Error("--skip-assemble requires one explicit --variant");
  const targets = loadTargets().targets;
  const commit = git(["rev-parse", "HEAD"]);
  const layout = path.join(ROOT, "build/release-layout");
  const output = path.join(ROOT, "build/dist");
  const overlays = path.join(ROOT, "build/package-config");
  mkdirSync(output, { recursive: true });
  mkdirSync(overlays, { recursive: true });
  for (const variant of variants) {
    const target = targets.find(
      (t) =>
        t.os === os &&
        t.arch === arch &&
        t.variant === variant &&
        (os !== "linux" || variant === "offline" || t.distro === distro),
    );
    if (!target) throw new Error(`no declared target for ${os}/${distro ?? ""}/${arch}/${variant}`);
    if (options["skip-assemble"]) verifyReusableLayout(layout, target, version, commit);
    else {
      // This fixed, repo-owned directory contains only generated staging data.
      rmSync(layout, { recursive: true, force: true });
      await assembleRuntimeLayout({
        target,
        outDir: layout,
        node: {
          path: process.execPath,
          source: `local-build:node-v${process.versions.node}-${process.platform}-${process.arch}`,
        },
        appVersion: version,
        sourceCommit: commit,
        repositorySnapshot: {
          repository: "https://github.com/xresloader/xresconv-gui.git",
          dirty: git(["status", "--porcelain"]).length > 0,
        },
        // Building alone is not installer acceptance. A controlled release must replace this evidence.
        verificationReport: { result: "fail", reportPath: "docs/plan/05-packaging-release.md" },
      });
    }
    const baseName =
      os === "macos" ? "tauri.macos.release.conf.json" : `tauri.${os}.${variant}.conf.json`;
    const base = JSON.parse(readFileSync(path.join(ROOT, "src-tauri", baseName), "utf8"));
    const signing = signingBundle(os);
    for (const key of Object.keys(signing))
      base.bundle[key] = { ...base.bundle[key], ...(signing[key] as object) };
    const format = formatFor(target);
    base.bundle.targets = [format];
    const overlay = path.join(overlays, `tauri.${os}.${variant}.conf.json`);
    writeFileSync(overlay, `${JSON.stringify(base, null, 2)}\n`, "utf8");
    const started = Date.now();
    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, "node_modules/@tauri-apps/cli/tauri.js"), "build", "--config", overlay],
      { cwd: ROOT, stdio: "inherit", windowsHide: true, timeout: 30 * 60_000 },
    );
    if (result.error || result.status !== 0)
      throw new Error(`tauri build failed (${result.error?.message ?? result.status})`);
    const name = artifactName(target, version);
    const source = selectArtifact(
      path.join(ROOT, "target/release/bundle", format),
      path.extname(name),
      started,
    );
    const dest = path.join(output, name);
    cpSync(source, dest);
    const digest = createHash("sha256").update(readFileSync(dest)).digest("hex");
    writeFileSync(`${dest}.sha256`, `${digest}  ${name}\n`, "utf8");
    console.log(`${digest}  ${name}`);
  }
}
