import { createHash } from "node:crypto";
import { createReadStream, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** 汇总只接受完整矩阵及一一对应的校验文件；重复文件名不能被覆盖后蒙混通过。 */
export async function verifyReleaseArtifacts(
  root: string,
  expected: readonly string[],
): Promise<string[]> {
  const files = new Map<string, string>();
  function collect(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(file);
      else {
        if (!entry.isFile()) throw new Error(`unsupported artifact entry: ${file}`);
        if (files.has(entry.name)) throw new Error(`duplicate artifact: ${entry.name}`);
        files.set(entry.name, file);
      }
    }
  }
  collect(root);
  const names = new Set(expected.flatMap((name) => [name, `${name}.sha256`]));
  const missing = [...names].filter((name) => !files.has(name));
  const extra = [...files.keys()].filter((name) => !names.has(name));
  if (missing.length || extra.length)
    throw new Error(
      `artifact set mismatch; missing: ${missing.join(", ")}; extra: ${extra.join(", ")}`,
    );
  const verified: string[] = [];
  for (const name of expected) {
    const file = files.get(name) as string;
    const sidecar = readFileSync(files.get(`${name}.sha256`) as string, "utf8").trim();
    const match = /^([a-fA-F0-9]{64}) [ *](.+)$/.exec(sidecar);
    if (!match || match[2] !== name) throw new Error(`invalid SHA-256 sidecar: ${name}`);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest("hex") !== match[1]?.toLowerCase())
      throw new Error(`SHA-256 mismatch: ${name}`);
    verified.push(file);
  }
  return verified;
}
