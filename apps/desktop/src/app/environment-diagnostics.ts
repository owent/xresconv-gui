import { useEffect } from "react";
import { backendRpc, onBackendEvent } from "../adapters/backend";
import { getAppInfo, getBackendHealth, getCliMatches } from "../adapters/tauri";
import { getLocale, translate as t } from "../i18n";
import { useSessionStore } from "./session-store";

/** 将应用、后端和 Java 环境诊断写入运行日志，失败时保留明确修复信息。 */

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
        t("diagnostics.health", {
          status: health.ok ? "ok" : "failed",
          node: health.node,
          pid: health.pid,
          backend: health.backend
            ? ` · backend ${health.backend.state} · pid ${health.backend.pid ?? "—"} · generation ${String(health.backend.generation)}`
            : "",
        }),
        health.ok && health.backend?.state === "ready" ? "info" : "warning",
      );
    })
    .catch((error: unknown) => {
      append(t("diagnostics.healthError", { error: String(error) }), "warning");
    });
}

function logJava(): void {
  const append = useSessionStore.getState().appendLocalLog;
  backendRpc<JavaStatus>("checkJava")
    .then((java) => {
      if (java.ok) {
        append(
          t("diagnostics.java", {
            version: (java.versionText.split("\n")[0] ?? "").trim(),
            source: javaSourceLabel(java.executable.source),
          }),
          "notice",
        );
        return;
      }
      append(
        t("diagnostics.javaError", { problem: java.problem ?? t("diagnostics.javaProblem") }),
        "warning",
      );
      append(
        t("diagnostics.javaInstall", {
          distributions: java.downloadHints
            .map((hint) => hint.name)
            .join(getLocale().startsWith("zh") ? "、" : ", "),
        }),
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
      append(t("diagnostics.appError", { error: String(error) }), "warning");
    });

  getCliMatches()
    .then((matches) => {
      const keys = Object.keys(matches);
      if (keys.length === 0) return;
      append(t("diagnostics.cli", { args: JSON.stringify(matches) }), "info");
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

/** 输出矩阵概要行。 */
function matrixSummaryLines(config: Record<string, unknown> | null): string[] {
  const matrix = config?.outputMatrix;
  if (!Array.isArray(matrix) || matrix.length === 0) {
    return [t("diagnostics.noMatrix")];
  }
  return matrix.map((rule, index) => {
    const typed = (rule ?? {}) as {
      type?: unknown;
      rename?: unknown;
      outputDir?: unknown;
      tags?: unknown;
      classes?: unknown;
    };
    const parts: string[] = [
      `type=${typeof typed.type === "string" && typed.type !== "" ? typed.type : t("common.default")}`,
    ];
    if (Array.isArray(typed.tags) && typed.tags.length > 0) {
      parts.push(`tag=${typed.tags.join(" ")}`);
    }
    if (Array.isArray(typed.classes) && typed.classes.length > 0) {
      parts.push(`class=${typed.classes.join(" ")}`);
    }
    if (typeof typed.rename === "string" && typed.rename !== "") {
      parts.push(`rename=${typed.rename}`);
    }
    if (typeof typed.outputDir === "string" && typed.outputDir !== "") {
      parts.push(t("diagnostics.matrixDir", { directory: typed.outputDir }));
    }
    return t("diagnostics.matrix", { count: index + 1, rules: parts.join("; ") });
  });
}

/**
 * 加载后日志摘要：loadConfig/reload 成功会重置
 * 运行日志显示面——重置后补写启动同款 Java 环境信息与本次配置的输出矩阵
 * 概要。触发点 store.configLoadSeq（仅加载成功 +1；ops/run 的重同步不动）。
 */
export function usePostLoadLogSummary(): void {
  const configLoadSeq = useSessionStore((state) => state.configLoadSeq);
  useEffect(() => {
    if (configLoadSeq === 0) return;
    // Java 信息（与启动一致；backend 未就绪时静默，ready 事件不会重复打扰）
    logJava();
    const config = useSessionStore.getState().snapshot?.config ?? null;
    for (const line of matrixSummaryLines(config)) {
      useSessionStore.getState().appendLocalLog(line, "info");
    }
  }, [configLoadSeq]);
}
