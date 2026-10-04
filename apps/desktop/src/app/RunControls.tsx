import { Button } from "react-aria-components";
import { RUN_ACTIVE_STATES, RUN_TERMINAL_STATES, type RunStateLike } from "../adapters/backend";
import { translate as t, useI18n } from "../i18n";
import { Icon } from "./Icon";
import { type RunRecord, useSessionStore } from "./session-store";

/** 预览任务写入运行日志的上限（有界输出；超出仅给总数）。 */
const PREVIEW_TASK_LOG_LIMIT = 50;

/** 预览/开始禁用的繁忙状态（加载中 + 活动运行三态）。 */
const BUSY_STATES = new Set(["loading", "before_hooks", "converting", "after_hooks"]);

/** 状态→语义色（状态用实底色章表达）。 */
const STATE_TONES: Record<string, string> = {
  idle: "muted",
  ready: "info",
  loading: "info",
  before_hooks: "info",
  converting: "info",
  after_hooks: "info",
  succeeded: "success",
  failed: "danger",
  cancelled: "warning",
};

function stateLabels(): Record<string, string> {
  return {
    idle: t("state.idle"),
    ready: t("state.ready"),
    loading: t("state.loading"),
    before_hooks: t("state.before_hooks"),
    converting: t("state.converting"),
    after_hooks: t("state.after_hooks"),
    succeeded: t("state.succeeded"),
    failed: t("state.failed"),
    cancelled: t("state.cancelled"),
  };
}

/**
 * 运行结果文案：区分实际阶段与已发生副作用，不假成功。
 * endPhase 来自进入结束状态的 state_change 的 previous；缺失时退化为通用文案，不猜测阶段。
 * failedCount 混合计数（事件失败 +1 / Java 退出码累加），不伪造条目级明细
 */
function describeRun(run: RunRecord): { tone: "ok" | "error" | "info"; lines: string[] } {
  const params = {
    run: run.runSeq,
    tasks: run.taskCount,
    failures: t("run.failureCount", { count: run.failedCount }),
  };
  switch (run.state) {
    case "succeeded":
      return {
        tone: "ok",
        lines: [t("run.completed", { ...params, seconds: (run.durationMs / 1000).toFixed(1) })],
      };
    case "cancelled":
      return {
        tone: "info",
        lines: [
          run.endPhase === "before_hooks"
            ? t("run.cancelBefore", params)
            : run.endPhase === "converting"
              ? t("run.cancelConvert", params)
              : run.endPhase === "after_hooks"
                ? t("run.cancelAfter", params)
                : t("run.cancelled", params),
        ],
      };
    case "failed":
      if (run.endPhase === "before_hooks") {
        return {
          tone: "error",
          lines: [t("run.failBefore", params)],
        };
      }
      if (run.endPhase === "converting" && run.taskCount === 0) {
        return {
          tone: "error",
          lines: [t("run.failPlan", params)],
        };
      }
      if (run.endPhase === "converting") {
        return {
          tone: "error",
          lines: [t("run.failConvert", params), t("run.seeLogs")],
        };
      }
      if (run.endPhase === "after_hooks") {
        return {
          tone: "error",
          lines: [t("run.failAfter", params)],
        };
      }
      return {
        tone: "error",
        lines: [run.taskCount > 0 ? t("run.failedWithTasks", params) : t("run.failed", params)],
      };
  }
}

/**
 * 运行控制与摘要：预览、取消和开始转换；开始转换固定最右。
 * 预览结果只写入运行日志（本地证据行），不再占独立结果区。
 * 开始/取消门禁由后端状态机决定。
 */
export function RunControls() {
  const { locale } = useI18n();
  const snapshot = useSessionStore((state) => state.snapshot);
  const preview = useSessionStore((state) => state.preview);
  const runPreview = useSessionStore((state) => state.runPreview);
  const runStarting = useSessionStore((state) => state.runStarting);
  const settingsPending = useSessionStore((state) => state.settingsPending > 0);
  const cancelRequested = useSessionStore((state) => state.cancelRequested);
  const lastRun = useSessionStore((state) => state.lastRun);
  const startRun = useSessionStore((state) => state.startRun);
  const cancelRun = useSessionStore((state) => state.cancelRun);
  const appendLocalLog = useSessionStore((state) => state.appendLocalLog);

  const state = (snapshot?.state ?? null) as RunStateLike | null;
  const terminal = state !== null && RUN_TERMINAL_STATES.has(state);
  const active = state !== null && RUN_ACTIVE_STATES.has(state);
  const hasConfig = snapshot?.config != null;
  const canPreview =
    hasConfig && !BUSY_STATES.has(state ?? "") && preview.status !== "loading" && !settingsPending;
  const canStart = hasConfig && (state === "ready" || terminal) && !runStarting && !settingsPending;
  const canCancel = active;
  const stateText = state === null ? t("run.noConfig") : (stateLabels()[state] ?? state);

  const runResult = lastRun === null ? null : describeRun(lastRun);

  const onPreview = () => {
    void runPreview().then((ok) => {
      const preview = useSessionStore.getState().preview;
      if (!ok && preview.status !== "error") return;
      if (preview.result === null) {
        // 预览失败也只进日志。
        const message = preview.error ?? t("preview.failed");
        appendLocalLog(
          t("preview.error", {
            message,
            hint: message.startsWith("XRESLOADER_NOT_FOUND") ? t("preview.jarHint") : "",
          }),
          "error",
        );
        return;
      }
      const result = preview.result;
      appendLocalLog(
        t("preview.summary", {
          tasks: result.plan.taskCount,
          selected: result.selectionCount,
          directory: result.plan.workDir,
          jar: result.plan.xresloaderPath,
        }),
        "notice",
      );
      for (const conflict of result.conflicts) {
        appendLocalLog(
          t("preview.conflict", {
            items: conflict.items.join(locale.startsWith("zh") ? "、" : ", "),
            directory: conflict.outputDir || t("common.default"),
            rename: conflict.rename || t("common.none"),
          }),
          "warning",
        );
      }
      const shown = result.plan.tasks.slice(0, PREVIEW_TASK_LOG_LIMIT);
      for (const task of shown) {
        appendLocalLog(t("preview.task", { command: task.display }), "info");
      }
      if (result.plan.taskCount > shown.length) {
        appendLocalLog(
          t("preview.limit", { shown: shown.length, total: result.plan.taskCount }),
          "info",
        );
      }
    });
  };

  return (
    <div className="panel run-controls">
      <fieldset className="run-buttons">
        <legend className="visually-hidden">{t("run.controls")}</legend>
        <div className="run-button-row">
          <Button isDisabled={!canPreview} onPress={onPreview}>
            {t("run.preview")}
          </Button>
          <Button isDisabled={!canCancel} onPress={() => void cancelRun()}>
            {t("common.cancel")}
          </Button>
          <Button
            className="btn-primary btn-run btn-run--primary"
            isDisabled={!canStart}
            onPress={() => void startRun()}
          >
            <Icon name="play" />
            {t("run.start")}
          </Button>
        </div>
        <p role="status" aria-label={t("run.status")} className="run-summary run-summary--inline">
          <span className={`state-chip state-chip--${STATE_TONES[state ?? "idle"] ?? "muted"}`}>
            {stateText}
            {cancelRequested && canCancel ? t("run.cancelling") : ""}
          </span>
          {runResult !== null && (
            <span
              role="status"
              aria-label={t("run.result")}
              className={`run-result run-result--${runResult.tone}`}
            >
              {runResult.lines.join(locale.startsWith("zh") ? "；" : "; ")}
            </span>
          )}
        </p>
      </fieldset>
    </div>
  );
}
