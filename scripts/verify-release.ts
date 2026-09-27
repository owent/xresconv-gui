import { loadTargets } from "../packages/packaging/src/load.ts";
import { buildMatrix } from "../packages/packaging/src/matrix.ts";
import { verifyReleaseArtifacts } from "../packages/packaging/src/release-artifacts.ts";

const version = (process.env.RELEASE_VERSION ?? "").replace(/^v/, "");
const files = await verifyReleaseArtifacts(
  "build/release-artifacts",
  buildMatrix(loadTargets(), version).map((row) => row.name),
);
console.log(`Verified ${files.length} release artifacts and SHA-256 sidecars`);
