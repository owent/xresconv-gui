import { createHash } from "node:crypto";
import { appendFileSync, createReadStream } from "node:fs";
import path from "node:path";
import { loadTargets } from "../packages/packaging/src/load.ts";
import { buildMatrix } from "../packages/packaging/src/matrix.ts";
import { verifyReleaseArtifacts } from "../packages/packaging/src/release-artifacts.ts";
import {
  lookupRelease,
  publicationAction,
} from "../packages/packaging/src/release-publication.ts";

const repository = process.env.GITHUB_REPOSITORY;
const tag = process.env.GITHUB_REF_NAME;
const token = process.env.GITHUB_TOKEN;
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !tag || !token)
  throw new Error("GITHUB_REPOSITORY, GITHUB_REF_NAME and GITHUB_TOKEN are required");
const version = tag.replace(/^v/, "");
const files = await verifyReleaseArtifacts(
  "build/release-artifacts",
  buildMatrix(loadTargets(), version).map((row) => row.name),
);
const candidate = new Map<string, string>();
for (const file of files.flatMap((file) => [file, `${file}.sha256`])) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  candidate.set(path.basename(file), hash.digest("hex"));
}

async function api(endpoint: string) {
  return fetch(`https://api.github.com/repos/${repository}/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });
}

const release = await lookupRelease(api, tag);
const action = publicationAction(candidate, release);
if (process.argv.includes("--require-complete") && action !== "unchanged")
  throw new Error("uploaded release does not contain the complete candidate artifact set");
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `upload=${action === "upload"}\n`);
console.log(`Release content verified: ${action}; ${candidate.size} artifacts/sidecars`);
