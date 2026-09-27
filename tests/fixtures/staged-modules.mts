import fs from "node:fs";
import path from "node:path";

/** 唯一包名阻止测试误用仓库祖先目录的 node_modules，并验证依赖实际来自发行树。 */
export function installStagedProbe(nodeModules: string): void {
  const dir = path.join(nodeModules, "xresconv-staged-probe");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "xresconv-staged-probe", main: "index.cjs" }));
  fs.writeFileSync(path.join(dir, "index.cjs"), `
const path = require("node:path");
for (const name of ["adm-zip", "compressing", "koffi"]) {
  const relative = path.relative(path.dirname(__dirname), require.resolve(name));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("dependency escaped staged layout: " + name);
  exports[name] = require(name);
}
`);
}
