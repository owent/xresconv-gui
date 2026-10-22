import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

export type Parallelism = number | "auto";
export const DEFAULT_PARALLELISM = "auto";
export const MAX_PARALLELISM = 16;
export const LEGACY_PARALLELISM = 2;

export function normalizeParallelism(value: Parallelism): Parallelism {
  if (value === "auto") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError("parallelism must be auto or a finite number");
  }
  return Math.min(MAX_PARALLELISM, Math.max(1, Math.floor(value)));
}

interface VersionEntry {
  header: { size: number };
  getData(): Buffer;
}

const Zip = createRequire(import.meta.url)("adm-zip") as new (
  data: Buffer,
) => { getEntry(name: string): VersionEntry | null };

/** Properties.load(InputStream)：续行去掉缩进，非续行的空白或注释行跳过。 */
function* propertyLines(properties: string): Generator<string> {
  let logicalLine = "";
  let continuing = false;
  for (const line of properties.split(/\r\n|\r|\n/)) {
    const segment = line.replace(/^[ \t\f]+/, "");
    if (!continuing && (!segment || /^[#!]/.test(segment))) continue;
    logicalLine += segment;
    const slashes = /\\+$/.exec(logicalLine)?.[0].length ?? 0;
    continuing = slashes % 2 === 1;
    if (continuing) {
      logicalLine = logicalLine.slice(0, -1);
    } else {
      yield logicalLine;
      logicalLine = "";
    }
  }
  if (continuing) yield logicalLine;
}

function unescapeProperty(value: string): string {
  return value.replace(/\\(u[\da-fA-F]{4}|u|[^\r\n])/g, (_, escaped: string) => {
    if (escaped === "u") throw new Error("Invalid Unicode escape in Java properties");
    if (escaped.startsWith("u")) return String.fromCharCode(Number.parseInt(escaped.slice(1), 16));
    switch (escaped) {
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "n":
        return "\n";
      case "f":
        return "\f";
      default:
        return escaped;
    }
  });
}

function readVersionProperty(properties: string): string | null {
  let version: string | null = null;
  for (const line of propertyLines(properties)) {
    let keyEnd = 0;
    while (keyEnd < line.length && !/[=:\t\f ]/.test(line[keyEnd] ?? "")) {
      keyEnd += line[keyEnd] === "\\" ? 2 : 1;
    }
    const key = unescapeProperty(line.slice(0, keyEnd));
    // key 与 value 可由空白、冒号或等号分隔；空白后可再有一个显式分隔符。
    const value = unescapeProperty(line.slice(keyEnd).replace(/^[ \t\f]*[:=]?[ \t\f]*/, ""));
    if (key === "version") version = value.trim() || null;
  }
  return version;
}

/** 并发能力取决于 JAR 构建版本；-Dxresloader.version 仅覆盖展示与默认数据版本。 */
export async function readXresloaderVersion(
  jarPath: string,
  signal?: AbortSignal,
): Promise<string | null> {
  signal?.throwIfAborted();
  try {
    const data = await readFile(jarPath, { signal });
    signal?.throwIfAborted();
    const entry = new Zip(data).getEntry("application.properties");
    if (!entry || entry.header.size > 65536) return null;
    return readVersionProperty(entry.getData().toString("latin1"));
  } catch {
    signal?.throwIfAborted();
    // 缺失、损坏或未知布局沿用旧版调度，实际执行仍由 Java runner 报告错误。
    return null;
  }
}

/** 2.24 的 beta 已提供 stdin 内置并发；数值比较兼容后续次版本和主版本。 */
export function supportsNativeParallelism(version: string | null): boolean {
  const match = /^(\d+)\.(\d+)(?:\.\d+)?(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.exec(version ?? "");
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return (
    Number.isSafeInteger(major) &&
    Number.isSafeInteger(minor) &&
    (major > 2 || (major === 2 && minor >= 24))
  );
}
