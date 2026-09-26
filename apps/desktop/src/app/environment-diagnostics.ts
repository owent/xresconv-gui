import { useEffect } from "react";
import { backendRpc, onBackendEvent } from "../adapters/backend";
import { getAppInfo, getBackendHealth, getCliMatches } from "../adapters/tauri";
import { useSessionStore } from "./session-store";

/**
 * 环境诊断 → 运行日志（2026-09-26 用户反馈：主面板上方不要冗余状态行，
 * 调试信息放运行日志框）。取代旧 EnvironmentStatus 状态条：
 * - 启动时记录：应用版本/协议、启动参数、guardian/backend 健康、Java 运行时
 *   （与旧版 conv_env_check 一致：java 版本进日志，检查经 backend checkJava RPC，
 *   与实际转换用同一解析，显示与执行一致）。
 * - backend-supervisor ready/died 事件后重查健康与 Java 并记录状态迁移。
 * - Java 不满足时以 warning 记录问题与推荐发行版（不再占主界面横幅）。
 *
 * 副作用经模块级 started 标记只跑一次（StrictMode 双挂载不重复记录；
 * 桥接命令本身经 adapters 在途去重）。
 */

/** checkJava 结果（镜像 backend java-env.ts JavaCheckResult + downloadHints）。 */
interface JavaStatus {
  ok: boolean;
  versionText: string;
  bit64: boolean;
  executable: { command: string; source: string };
  problem: string | null;
  downloadHints: { name: string; url: string }[];
}

/** Java 来源标记（XRESCONV_JAVA 显式 > JAVA_HOME > PATH）。 */
function javaSourceLabel(source: string): string {
  if (source === "explicit") return "（XRESCONV_JAVA）";
  if (source === "java-home") return "（JAVA_HOME）";
  return "";
}

function logHealth(): void {
  const append = useSessionStore.getState().appendLocalLog;
  getBackendHealth()
    .then((health) => {
      append(
        `后端状态：guardian ${health.ok ? "ok" : "failed"} · node ${health.node} · pid ${String(health.pid)}` +
          (health.backend
            ? ` · backend ${health.backend.state} · pid ${health.backend.pid ?? "—"} · generation ${String(health.backend.generation)}`
            : ""),
        health.ok && health.backend?.state === "ready" ? "info" : "warning",
      );
    })
    .catch((error: unknown) => {
      append(`后端状态检查失败：${String(error)}`, "warning");
    });
}

function logJava(): void {
  const append = useSessionStore.getState().appendLocalLog;
  backendRpc<JavaStatus>("checkJava")
    .then((java) => {
      if (java.ok) {
        append(
          `Java 环境：${(java.versionText.split("\n")[0] ?? "").trim()}${javaSourceLabel(java.executable.source)}`,
          "notice",
        );
        return;
      }
      append(`Java 环境不满足：${java.problem ?? "Java 运行时不满足要求"}`, "warning");
      append(
        `请安装 64 位的 JRE 或 JDK 8 或以上（可用环境变量 XRESCONV_JAVA 指定 java 路径、JAVA_HOME 指定 JDK 目录），推荐发行版：${java.downloadHints
          .map((hint) => hint.name)
          .join("、")}`,
        "warning",
      );
    })
    .catch(() => {
      /* backend 未就绪：ready 事件后会重查 */
    });
}

let started = false;

/** 测试隔离：复位一次性标记（与 resetSessionStore 配套）。 */
export function resetEnvironmentDiagnostics(): void {
  started = false;
}

function startDiagnostics(): void {
  if (started) return;
  started = true;
  const append = useSessionStore.getState().appendLocalLog;

  getAppInfo()
    .then((info) => {
      append(`${info.name} v${info.version} · protocol v${String(info.protocol_version)}`, "info");
    })
    .catch((error: unknown) => {
      append(`读取应用信息失败：${String(error)}`, "warning");
    });

  getCliMatches()
    .then((matches) => {
      const keys = Object.keys(matches);
      if (keys.length === 0) return;
      append(`启动参数：${JSON.stringify(matches)}`, "info");
    })
    .catch(() => {
      /* 无启动参数/读取失败不打扰 */
    });

  logHealth();
  logJava();
}

export function useEnvironmentDiagnostics(): void {
  useEffect(() => {
    startDiagnostics();
    // backend 就绪/死亡后重查健康与 Java（一次订阅；adapter 引用计数共享）。
    return onBackendEvent((event) => {
      const payload = event.payload as { source?: string; type?: string } | null;
      if (
        event.kind === "event" &&
        payload?.source === "backend-supervisor" &&
        (payload.type === "ready" || payload.type === "died")
      ) {
        logHealth();
        if (payload.type === "ready") logJava();
      }
    });
  }, []);
}
