import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ErrorObject, ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  baselineKeys,
  DESKTOP_ARCHES,
  FORBIDDEN_ARCHES,
  LINUX_ARCHES,
  LINUX_DISTROS,
  TARGET_OSES,
  TARGET_VARIANTS,
  targetKey,
  WEBVIEW_STRATEGIES,
} from "./baseline.ts";
import { PackagingError } from "./errors.ts";
import { lintManifest } from "./lint.ts";
import type { ReleaseTarget, RuntimeManifest, TargetsFile } from "./types.ts";

/** Repo-rooted locations; this package is private and only used inside this repo. */
export const TARGETS_FILE_URL = new URL("../../../packaging/targets.json", import.meta.url);
const SCHEMA_URLS = {
  targets: new URL("../../../packaging/schema/targets.schema.json", import.meta.url),
  runtimeManifest: new URL(
    "../../../packaging/schema/runtime-manifest.schema.json",
    import.meta.url,
  ),
} as const;

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validatorCache = new Map<keyof typeof SCHEMA_URLS, ValidateFunction>();

function loadValidator(name: keyof typeof SCHEMA_URLS): ValidateFunction {
  let validate = validatorCache.get(name);
  if (!validate) {
    const schema = JSON.parse(readFileSync(fileURLToPath(SCHEMA_URLS[name]), "utf8")) as object;
    validate = ajv.compile(schema);
    validatorCache.set(name, validate);
  }
  return validate;
}

function schemaError(subject: string, errors: ErrorObject[] | null | undefined): PackagingError {
  const details = (errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
  return new PackagingError(
    "SCHEMA_VIOLATION",
    `${subject}: schema validation failed: ${details.join("; ")}`,
    details,
  );
}

function fail(
  code: "UNKNOWN_TARGET" | "FORBIDDEN_ARCH" | "INCOHERENT_TARGET",
  target: Pick<ReleaseTarget, "os" | "arch" | "variant"> & { distro?: string | null },
  reason: string,
): never {
  throw new PackagingError(code, `${targetKey(target)}: ${reason}`, [reason]);
}

function checkDomains(target: ReleaseTarget): void {
  if (!TARGET_OSES.includes(target.os)) {
    fail("UNKNOWN_TARGET", target, `unknown os "${target.os}"`);
  }
  if (!TARGET_VARIANTS.includes(target.variant)) {
    fail("UNKNOWN_TARGET", target, `unknown variant "${target.variant}"`);
  }
  const knownArches: readonly string[] = [...DESKTOP_ARCHES, ...LINUX_ARCHES];
  if (!knownArches.includes(target.arch)) {
    fail("UNKNOWN_TARGET", target, `unknown arch "${target.arch}"`);
  }
  if (target.distro !== undefined && !LINUX_DISTROS.includes(target.distro)) {
    fail("UNKNOWN_TARGET", target, `unknown distro "${target.distro}" (D2 set)`);
  }
  if (!WEBVIEW_STRATEGIES.includes(target.webviewStrategy)) {
    fail("UNKNOWN_TARGET", target, `unknown webviewStrategy "${target.webviewStrategy}"`);
  }
}

function checkCoherence(target: ReleaseTarget): void {
  switch (target.os) {
    case "windows":
    case "macos": {
      if (!(DESKTOP_ARCHES as readonly string[]).includes(target.arch)) {
        fail("INCOHERENT_TARGET", target, `${target.os} arch must be x64 or arm64`);
      }
      if (target.distro !== undefined) {
        fail("INCOHERENT_TARGET", target, `${target.os} targets must not carry a distro`);
      }
      break;
    }
    case "linux": {
      if (!(LINUX_ARCHES as readonly string[]).includes(target.arch)) {
        fail("INCOHERENT_TARGET", target, "linux arch must be x86_64 or aarch64");
      }
      break;
    }
  }
  switch (target.os) {
    case "windows": {
      const want =
        target.variant === "bootstrap"
          ? "webview2-embed-bootstrapper"
          : "webview2-offline-installer";
      if (target.webviewStrategy !== want) {
        fail("INCOHERENT_TARGET", target, `windows ${target.variant} requires ${want}`);
      }
      if (typeof target.minimumWebview !== "string") {
        fail("INCOHERENT_TARGET", target, "windows targets must declare a WebView2 floor");
      }
      break;
    }
    case "macos": {
      if (target.webviewStrategy !== "system-only") {
        fail("INCOHERENT_TARGET", target, "macOS uses the system WKWebView only (D5)");
      }
      if (target.minimumWebview !== null) {
        fail("INCOHERENT_TARGET", target, "macOS gate is osVersionRange, not a webview version");
      }
      break;
    }
    case "linux": {
      if (target.variant === "bootstrap") {
        if (target.distro === undefined) {
          fail("INCOHERENT_TARGET", target, "linux bootstrap targets require a distro");
        }
        if (target.webviewStrategy !== "webkitgtk-system") {
          fail("INCOHERENT_TARGET", target, "linux bootstrap uses the distro WebKitGTK");
        }
      } else {
        if (target.distro !== undefined) {
          fail(
            "INCOHERENT_TARGET",
            target,
            "linux offline is one self-contained package per arch (no distro)",
          );
        }
        if (target.webviewStrategy !== "webkitgtk-bundled") {
          fail("INCOHERENT_TARGET", target, "linux offline bundles WebKitGTK/GTK");
        }
      }
      break;
    }
  }
}

/**
 * Semantic gate on top of the JSON schema (PK01): duplicate targets,
 * domain membership, per-os coherence, and exact set equality with the
 * D1/D2 baseline. Exported separately so callers holding already-typed
 * targets can run it without the schema step.
 */
export function validateTargetSemantics(targets: readonly ReleaseTarget[]): void {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const target of targets) {
    if (FORBIDDEN_ARCHES.includes(target.arch)) {
      fail("FORBIDDEN_ARCH", target, `arch "${target.arch}" is forbidden (D1: 64-bit only)`);
    }
    checkDomains(target);
    checkCoherence(target);
    const key = targetKey(target);
    if (seen.has(key)) {
      duplicates.push(key);
    }
    seen.add(key);
  }
  if (duplicates.length > 0) {
    throw new PackagingError(
      "DUPLICATE_TARGET",
      `duplicate targets (same os/distro/arch/variant): ${duplicates.join(", ")}`,
      duplicates,
    );
  }
  const expected = baselineKeys();
  const expectedSet = new Set(expected);
  const missing = expected.filter((key) => !seen.has(key));
  if (missing.length > 0) {
    throw new PackagingError(
      "MISSING_TARGET",
      `matrix misses targets required by the D1/D2 baseline: ${missing.join(", ")}`,
      missing,
    );
  }
  const unexpected = [...seen].filter((key) => !expectedSet.has(key)).sort();
  if (unexpected.length > 0) {
    throw new PackagingError(
      "UNEXPECTED_TARGET",
      `targets outside the D1/D2 baseline: ${unexpected.join(", ")}`,
      unexpected,
    );
  }
}

/** Structural (JSON schema) + semantic validation of a targets file. */
export function validateTargets(data: unknown): TargetsFile {
  const validate = loadValidator("targets");
  if (!validate(data)) {
    throw schemaError("targets.json", validate.errors);
  }
  const file = data as TargetsFile;
  validateTargetSemantics(file.targets);
  return file;
}

/** Reads (default: repo packaging/targets.json), parses and fully validates. */
export function loadTargets(path?: string | URL): TargetsFile {
  const url =
    path === undefined ? TARGETS_FILE_URL : typeof path === "string" ? pathToFileURL(path) : path;
  let raw: string;
  try {
    raw = readFileSync(fileURLToPath(url), "utf8");
  } catch (error) {
    throw new PackagingError("IO_ERROR", `cannot read targets file ${fileURLToPath(url)}`, [
      String(error),
    ]);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new PackagingError("PARSE_ERROR", `targets file is not valid JSON`, [String(error)]);
  }
  return validateTargets(data);
}

/**
 * Structural validation of an artifact-side runtime manifest. By default the
 * PK01 hygiene lint (no dev-machine absolute paths, no secrets) also runs and
 * fails the manifest; pass { lint: false } only for schema-focused tests.
 */
export function validateRuntimeManifest(
  data: unknown,
  options: { lint?: boolean } = {},
): RuntimeManifest {
  const validate = loadValidator("runtimeManifest");
  if (!validate(data)) {
    throw schemaError("runtime-manifest.json", validate.errors);
  }
  if (options.lint !== false) {
    const findings = lintManifest(data);
    if (findings.length > 0) {
      throw new PackagingError(
        "MANIFEST_LINT",
        `manifest failed hygiene lint: ${findings
          .map((f) => `${f.pointer} (${f.rule})`)
          .join("; ")}`,
        findings.map((f) => `${f.pointer} ${f.rule}: ${f.excerpt}`),
      );
    }
  }
  return data as RuntimeManifest;
}
