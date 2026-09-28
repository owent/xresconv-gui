import { parseArgs } from "node:util";
import { loadTargets } from "../packages/packaging/src/load.ts";
import { buildMatrix, selectMatrix } from "../packages/packaging/src/matrix.ts";
import { verifyReleaseArtifacts } from "../packages/packaging/src/release-artifacts.ts";

// --target=<os>/<distro-or-dash>/<arch>/<variant>（targetKey 格式，可重复）：
// 本次 release CI 实际构建的目标子集，与 release.yml 三个 build job 的 matrix
// 同步维护。不传任何 --target 时按全量矩阵校验（本地预检语义）。
const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  options: {
    target: { type: "string", multiple: true, default: [] },
  },
});

const version = (process.env.RELEASE_VERSION ?? "").replace(/^v/, "");
const fullMatrix = buildMatrix(loadTargets(), version);
const matrix = values.target.length > 0 ? selectMatrix(fullMatrix, values.target) : fullMatrix;
const files = await verifyReleaseArtifacts(
  "build/release-artifacts",
  matrix.map((row) => row.name),
);
console.log(`Verified ${files.length} release artifacts and SHA-256 sidecars`);
