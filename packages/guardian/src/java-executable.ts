import { existsSync } from "node:fs";
import path from "node:path";

export interface JavaExecutable {
  command: string;
  source: "explicit" | "java-home" | "path";
}

/** Diagnostics and conversion must resolve the same executable. */
export function resolveJavaExecutable(): JavaExecutable {
  if (process.env.XRESCONV_JAVA) return { command: process.env.XRESCONV_JAVA, source: "explicit" };
  if (process.env.JAVA_HOME) {
    const command = path.join(
      process.env.JAVA_HOME,
      "bin",
      process.platform === "win32" ? "java.exe" : "java",
    );
    if (existsSync(command)) return { command, source: "java-home" };
  }
  return { command: "java", source: "path" };
}
