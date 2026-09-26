import { Button } from "react-aria-components";
import {
  RUN_ACTIVE_STATES,
  RUN_TERMINAL_STATES,
  type RunStateLike,
  type TreeNodeKey,
} from "../adapters/backend";
import { collectFolderKeys } from "./ConversionTree";
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

const STATE_LABELS: Record<string, string> = {
  idle: "空闲",
  ready: "就绪",
  loading: "加载中",
  before_hooks: "前置钩子执行中",
  converting: "转换中",
  after_hooks: "后置钩子执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

/**
 * 运行终态文案（P4-06，UI06）：区分实际阶段与已发生副作用，不假成功。
 * endPhase 来自终态 state_change 的 previous；缺失时退化为通用文案，不猜测阶段。
 * failedCount 混合计数（事件失败 +1 / Java 退出码累加），不伪造条目级明细
 * （stdin 批次协议无逐条确认，主计划 §7.2）。
 */
function describeRun(run: RunRecord): { tone: "ok" | "error" | "info"; lines: string[] } {
  const count = `失败计数 ${run.failedCount}`;
  switch (run.state) {
    case "succeeded":
      return {
        tone: "ok",
        lines: [
          `第 ${run.runSeq} 次运行已完成：提交 ${run.taskCount} 个任务，耗时 ${(
            run.durationMs / 1000
          ).toFixed(1)} 秒`,
        ],
      };
    case "cancelled":
      return {
        tone: "info",
        lines: [
          run.endPhase === "before_hooks"
            ? `第 ${run.runSeq} 次运行已取消：前置事件阶段取消，未启动转换`
            : run.endPhase === "converting"
              ? `第 ${run.runSeq} 次运行已取消：转换阶段取消，已提交的任务中止，已生成的输出保留`
              : run.endPhase === "after_hooks"
                ? `第 ${run.runSeq} 次运行已取消：后处理阶段取消，转换输出已生成`
                : `第 ${run.runSeq} 次运行已取消`,
        ],
      };
    case "failed":
      if (run.endPhase === "before_hooks") {
        return {
          tone: "error",
          lines: [`第 ${run.runSeq} 次运行失败：前置事件执行失败，未启动转换（${count}）`],
        };
      }
      if (run.endPhase === "converting" && run.taskCount === 0) {
        return {
          tone: "error",
          lines: [`第 ${run.runSeq} 次运行失败：转换计划构建失败，未启动转换（${count}）`],
        };
      }
      if (run.endPhase === "converting") {
        return {
          tone: "error",
          lines: [
            `第 ${run.runSeq} 次运行失败：转换批次存在失败（已提交 ${run.taskCount} 个任务，${count}）`,
            "stdin 批次协议无逐条确认，条目级成败明细未知，详见日志",
          ],
        };
      }
      if (run.endPhase === "after_hooks") {
        return {
          tone: "error",
          lines: [
            `第 ${run.runSeq} 次运行后处理失败：转换已完成并生成输出，但 on_after_convert 事件失败（${count}）`,
          ],
        };
      }
      return {
        tone: "error",
        lines: [
          `第 ${run.runSeq} 次运行失败：${count}${run.taskCount > 0 ? `（已提交 ${run.taskCount} 个任务）` : ""}`,
        ],
      };
  }
}

/**
 * 运行控制与摘要（F08）：按钮组对照旧版顺序（全部选中/全部取消/全部展开/
 * 全部收起/预览/取消），“开始转换”与“重置”为主操作（特殊色、加大）且
 * “开始转换”固定最右（2026-09-26 四轮）。
 * 预览结果只写入运行日志（本地证据行），不再占独立结果区。
 * 开始/取消门禁由后端状态机决定；重置对齐 backend 语义——任意已加载状态可调
 * （活动运行先取消等回收；ready 下为幂等清理。此前前端比后端更严，导致按钮
 * 在常见 ready 状态长期灰置）。
 */
export function RunControls() {
  const snapshot = useSessionStore((state) => state.snapshot);
  const preview = useSessionStore((state) => state.preview);
  const runPreview = useSessionStore((state) => state.runPreview);
  const runStarting = useSessionStore((state) => state.runStarting);
  const cancelRequested = useSessionStore((state) => state.cancelRequested);
  const resetting = useSessionStore((state) => state.resetting);
  const lastRun = useSessionStore((state) => state.lastRun);
  const startRun = useSessionStore((state) => state.startRun);
  const cancelRun = useSessionStore((state) => state.cancelRun);
  const resetSession = useSessionStore((state) => state.resetSession);
  const selectAll = useSessionStore((state) => state.selectAll);
  const appendLocalLog = useSessionStore((state) => state.appendLocalLog);
  const selectNone = useSessionStore((state) => state.selectNone);
  const setExpandedKeys = useSessionStore((state) => state.setExpandedKeys);

  const state = (snapshot?.state ?? null) as RunStateLike | null;
  const terminal = state !== null && RUN_TERMINAL_STATES.has(state);
  const active = state !== null && RUN_ACTIVE_STATES.has(state);
  const hasConfig = snapshot?.config != null;
  const canPreview = hasConfig && !BUSY_STATES.has(state ?? "") && preview.status !== "loading";
  const canStart = hasConfig && (state === "ready" || terminal) && !runStarting;
  const canCancel = active;
  // backend session.reset 无状态门禁（终态重新武装；ready 下幂等清理）。
  // 仅 loading（配置加载中转态）禁用。
  const canReset = hasConfig && state !== "loading" && !resetting;
  const treeOpsDisabled = !hasConfig;
  const stateText = state === null ? "未加载配置" : (STATE_LABELS[state] ?? state);

  const runResult = lastRun === null ? null : describeRun(lastRun);

  const expandAll = () => {
    const keys = new Set<TreeNodeKey>();
    collectFolderKeys(snapshot?.tree?.nodes ?? [], keys);
    setExpandedKeys(keys);
  };

  const onPreview = () => {
    void runPreview().then(() => {
      const preview = useSessionStore.getState().preview;
      if (preview.result === null) {
        // 预览失败也只进日志（2026-09-26 四轮：结果统一输出到运行日志框）。
        const message = preview.error ?? "预览失败";
        appendLocalLog(
          `预览失败：${message}${
            message.startsWith("XRESLOADER_NOT_FOUND")
              ? "（请在“详细配置”中填写有效的转表工具 xresloader JAR 路径）"
              : ""
          }`,
          "error",
        );
        return;
      }
      const result = preview.result;
      appendLocalLog(
        `预览：${String(result.plan.taskCount)} 个任务（选中 ${String(
          result.selectionCount,
        )} 条目）；执行目录 ${result.plan.workDir}；转表工具 ${result.plan.xresloaderPath}`,
        "notice",
      );
      for (const conflict of result.conflicts) {
        appendLocalLog(
          `预览发现重复输出：${conflict.items.join("、")} 以相同类型/目录/重命名被重复发射（输出目录 ${
            conflict.outputDir || "（默认）"
          } / 重命名 ${conflict.rename || "（无）"}）`,
          "warning",
        );
      }
      const shown = result.plan.tasks.slice(0, PREVIEW_TASK_LOG_LIMIT);
      for (const task of shown) {
        appendLocalLog(`预览任务：${task.display}`, "info");
      }
      if (result.plan.taskCount > shown.length) {
        appendLocalLog(
          `预览任务仅列出前 ${String(shown.length)} 条，共 ${String(result.plan.taskCount)} 条`,
          "info",
        );
      }
    });
  };

  return (
    <div className="panel run-controls">
      <fieldset className="run-buttons">
        <legend className="visually-hidden">运行控制</legend>
        <div className="run-button-row">
          <Button isDisabled={treeOpsDisabled} onPress={() => void selectAll()}>
            全部选中
          </Button>
          <Button isDisabled={treeOpsDisabled} onPress={() => void selectNone()}>
            全部取消
          </Button>
          <Button isDisabled={treeOpsDisabled} onPress={expandAll}>
            全部展开
          </Button>
          <Button isDisabled={treeOpsDisabled} onPress={() => setExpandedKeys(new Set())}>
            全部收起
          </Button>
          <Button isDisabled={!canPreview} onPress={onPreview}>
            预览
          </Button>
          <Button isDisabled={!canCancel} onPress={() => void cancelRun()}>
            取消
          </Button>
          <Button
            className="btn-success btn-run"
            isDisabled={!canReset}
            onPress={() => void resetSession()}
          >
            重置
          </Button>
          <Button
            className="btn-primary btn-run btn-run--primary"
            isDisabled={!canStart}
            onPress={() => void startRun()}
          >
            开始转换
          </Button>
        </div>
        <p role="status" aria-label="运行状态" className="run-summary run-summary--inline">
          <span className={`state-chip state-chip--${STATE_TONES[state ?? "idle"] ?? "muted"}`}>
            {stateText}
            {cancelRequested && canCancel ? "·取消中" : ""}
          </span>
          {runResult !== null && (
            <span
              role="status"
              aria-label="运行结果"
              className={`run-result run-result--${runResult.tone}`}
            >
              {runResult.lines.join("；")}
            </span>
          )}
        </p>
      </fieldset>
    </div>
  );
}
