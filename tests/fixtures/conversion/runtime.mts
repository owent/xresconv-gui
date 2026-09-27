import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const checkout = fileURLToPath(new URL("../../../../xresloader/", import.meta.url));
const targetDir = path.join(checkout, "target");
const candidates = existsSync(targetDir) ? readdirSync(targetDir).filter((name) => /^xresloader-[\d.]+(?:-[\w.-]+)?\.jar$/.test(name)) : [];
// Ambiguous builds require an explicit selection; never choose a JAR by guesswork.
export const JAR = process.env.XRESCONV_TEST_JAR ?? (candidates.length === 1 ? path.join(targetDir, candidates[0] as string) : "");
export const SAMPLE = process.env.XRESCONV_TEST_SAMPLE ?? path.join(checkout, "sample");
export const HAS_JAR = JAR !== "" && existsSync(JAR) && existsSync(path.join(SAMPLE, "proto_v2/kind.pb"));
