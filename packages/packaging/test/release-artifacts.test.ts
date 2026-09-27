import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { verifyReleaseArtifacts } from "../src/release-artifacts.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-hashes-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, "job"));
  const artifact = path.join(dir, "job", "a.exe");
  fs.writeFileSync(artifact, "payload");
  fs.writeFileSync(
    `${artifact}.sha256`,
    `${createHash("sha256").update("payload").digest("hex")}  a.exe\n`,
  );
  return { dir, artifact };
}
it("requires exact artifact and sidecar sets, unique across jobs", async () => {
  const { dir, artifact } = fixture();
  expect(await verifyReleaseArtifacts(dir, ["a.exe"])).toHaveLength(1);
  await expect(verifyReleaseArtifacts(dir, ["a.exe", "missing.dmg"])).rejects.toThrow(/missing/);
  fs.copyFileSync(artifact, path.join(dir, "a.exe"));
  await expect(verifyReleaseArtifacts(dir, ["a.exe"])).rejects.toThrow(/duplicate/);
});
it("rejects modified payloads, missing hashes, and sidecars naming another file", async () => {
  const { dir, artifact } = fixture();
  fs.writeFileSync(artifact, "changed");
  await expect(verifyReleaseArtifacts(dir, ["a.exe"])).rejects.toThrow(/SHA-256/);
  fs.writeFileSync(`${artifact}.sha256`, `${"a".repeat(64)}  other.exe\n`);
  await expect(verifyReleaseArtifacts(dir, ["a.exe"])).rejects.toThrow(/sidecar/);
  fs.rmSync(`${artifact}.sha256`);
  await expect(verifyReleaseArtifacts(dir, ["a.exe"])).rejects.toThrow(/missing/);
});
