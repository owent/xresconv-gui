/**
 * Java 运行时环境检查(用户指示恢复 conv_env_check 逻辑）。
 *
 * 对齐 （conv_env_check）：
 * `java -version` 输出（stdout+stderr 合并）解析版本号；
 * 版本要求：主版本 >1 或次版本 ≥8（即 Java 8+）；
 * 非 64-Bit 视为不满足（提示下载 64 位）；
 * 不满足时给下载指引（推荐列表）。
 * 新增：java 可执行文件解析支持环境变量——`XRESCONV_JAVA`（显式路径）→
 * `JAVA_HOME/bin/java(exe)` → PATH `java`（与 java-runner 转换执行共用同一解析，
 * 保证"显示的 java"与"实际运行转换的 java"一致）。
 */

import { spawn } from "node:child_process";
import { createProcessScope, type JavaExecutable, resolveJavaExecutable } from "@xresconv/guardian";

export { type JavaExecutable, resolveJavaExecutable } from "@xresconv/guardian";

/** dep_msg 的推荐发行版(链接保留）。 */
export const JAVA_DOWNLOAD_HINTS: readonly { name: string; url: string }[] = [
  { name: "TemurinJDK", url: "https://adoptium.net/" },
  { name: "Microsoft JDK", url: "https://www.microsoft.com/openjdk" },
  { name: "LibericaJDK", url: "https://bell-sw.com/" },
  { name: "Zulu", url: "https://www.azul.com/downloads/zulu-community/" },
  { name: "OpenJDK", url: "https://developers.redhat.com/products/openjdk/download" },
];

/** checkJava 结果（UI 展示 + 转换前诊断）。 */
export interface JavaCheckResult {
  /** 找到 java 且版本满足（Java 8+ 且 64-Bit）。 */
  ok: boolean;
  /** `java -version` 原始输出（多行）。 */
  versionText: string;
  /** 解析出的版本数组（如 [25,0,4]；1.8.0_392 → [1,8,0,392]）。 */
  versions: number[];
  /** 输出含 64-Bit（大小写不敏感）。 */
  bit64: boolean;
  executable: JavaExecutable;
  /** 找到但版本/位数不满足的原因；找不到/spawn 失败为 spawn 错误信息。 */
  problem: string | null;
}

const CHECK_TIMEOUT_MS = 8000;

/** 运行 `java -version` 并按规则判定（有界超时；不经 shell）。 */
export async function checkJavaEnvironment(): Promise<JavaCheckResult> {
  const executable = resolveJavaExecutable();
  const scope = createProcessScope({ name: "java-environment-check" });
  try {
    return await new Promise<JavaCheckResult>((resolve) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(
          executable.command,
          ["-version"],
          scope.decorateSpawnOptions({
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
          }),
        );
        scope.register(child);
      } catch (err) {
        resolve({
          ok: false,
          versionText: "",
          versions: [],
          bit64: false,
          executable,
          problem: `无法启动 ${executable.command}: ${String(err)}`,
        });
        return;
      }
      let text = "";
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const settle = (problem: string | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const version = /^(?:openjdk|java) (?:version )?"?(\d+(?:[._]\d+)*)/im.exec(text)?.[1];
        const versions = version?.split(/[._]/).map(Number) ?? [];
        const bit64 = /64-bit/i.test(text);
        const versionOk = (versions[0] ?? 0) >= 8 || (versions[0] === 1 && (versions[1] ?? 0) >= 8);
        let verdict = problem;
        if (problem === null && versions.length === 0) {
          verdict = "查询不到 java 版本号";
        } else if (problem === null && !versionOk) {
          verdict = "java 版本过老（需要 64 位的 JRE 或 JDK 8 或以上）";
        } else if (problem === null && !bit64) {
          verdict = "检测到 32 位 java（需要 64 位的 JRE 或 JDK 8 或以上）";
        }
        resolve({
          ok: problem === null && versionOk && bit64,
          versionText: text.trim(),
          versions,
          bit64,
          executable,
          problem: verdict,
        });
      };
      timer = setTimeout(() => {
        settle(`java -version 超时（${CHECK_TIMEOUT_MS}ms）`);
      }, CHECK_TIMEOUT_MS);
      child.stdout?.on("data", (chunk: Buffer) => {
        text += chunk.toString("utf8").slice(0, Math.max(0, 65536 - text.length));
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        text += chunk.toString("utf8").slice(0, Math.max(0, 65536 - text.length));
      });
      child.on("error", (err: Error) => settle(`检测不到 java（${err.message}）`));
      child.on("close", (code, signal) =>
        settle(code === 0 ? null : `java -version 退出异常（${signal ?? code}）`),
      );
    });
  } finally {
    await scope.terminate(0);
    await scope.dispose();
  }
}
