import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { artifactName, buildMatrix, releaseArtifacts } from "../src/matrix.ts";
import { verifyReleaseArtifacts } from "../src/release-artifacts.ts";
import { realTargetsFile } from "./fixtures.ts";

it("ships one system-WebView DMG per macOS architecture and a 12-artifact release", () => {
  const matrix = buildMatrix(realTargetsFile(), "3.0.0-dev.1");
  expect(matrix).toHaveLength(12);
  const macos = matrix.filter((artifact) => artifact.os === "macos");
  expect(macos.map(({ arch, variant, format }) => ({ arch, variant, format }))).toEqual([
    { arch: "arm64", variant: "bootstrap", format: "dmg" },
    { arch: "x64", variant: "bootstrap", format: "dmg" },
  ]);
});

it("keeps offline macOS build targets available without shipping duplicate DMGs", () => {
  const offline = realTargetsFile().targets.filter(
    (target) => target.os === "macos" && target.variant === "offline",
  );
  expect(offline).toHaveLength(2);
  for (const target of offline) expect(releaseArtifacts(target, "3.0.0-dev.1")).toEqual([]);
});

it("accepts the complete release and rejects an extra offline macOS DMG with a valid hash", async () => {
  const targets = realTargetsFile();
  const version = "3.0.0-dev.1";
  const names = buildMatrix(targets, version).map(({ name }) => name);
  const dir = new URL(`../../../build/macos-release-test-${randomUUID()}/`, import.meta.url);
  fs.mkdirSync(dir, { recursive: true });
  const writeArtifact = (name: string) => {
    const payload = Buffer.from(`fixture:${name}`);
    fs.writeFileSync(new URL(name, dir), payload);
    fs.writeFileSync(
      new URL(`${name}.sha256`, dir),
      `${createHash("sha256").update(payload).digest("hex")}  ${name}\n`,
    );
  };
  try {
    for (const name of names) writeArtifact(name);
    expect(await verifyReleaseArtifacts(fileURLToPath(dir), names)).toHaveLength(12);
    const offline = targets.targets.find(
      (target) => target.os === "macos" && target.variant === "offline",
    );
    expect(offline).toBeDefined();
    if (!offline) throw new Error("missing macOS offline fixture");
    writeArtifact(artifactName(offline, version));
    await expect(verifyReleaseArtifacts(fileURLToPath(dir), names)).rejects.toThrow(
      /extra: .*macos.*offline/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
