import { Button } from "react-aria-components";
import {
  RUN_ACTIVE_STATES,
  RUN_TERMINAL_STATES,
  type RunStateLike,
  type TreeNodeKey,
} from "../adapters/backend";
import { collectFolderKeys } from "./ConversionTree";
import { type RunRecord, useSessionStore } from "./session-store";

/** 预览任务展示上限（有界展示；超出仅给总数）。 */
const PREVIEW_TASK_LIMIT = 200;

/** 预览/开始禁用的繁忙状态（加载中 + 活动运行三态）。 */
const BUSY_STATES = new Set(["loading", "before_hooks", "converting", "after_hooks"]);

/** 状态→语义色（2026-09-26 紧凑改版：状态用颜色表达结果）。 */
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
 * 运行控制与摘要（F08）：按钮组对照旧版 conv_list_internal_btn_group 顺序
 * （全部选中/全部取消/全部展开/全部收起/开始转换/重置），新增能力（预览/取消）
 * 排在其间不改变原按钮语义；预览结果收纳为折叠区（旧版无此面板，不占主界面）。
 * 开始/取消/重置门禁由后端状态机决定（run 允许自 ready/终态；cancel 仅活动
 * 运行且幂等；reset 先取消等清理再重新武装）。结果区只显示有证据的信息。
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
  const selectNone = useSessionStore((state) => state.selectNone);
  const setExpandedKeys = useSessionStore((state) => state.setExpandedKeys);

  const state = (snapshot?.state ?? null) as RunStateLike | null;
  const terminal = state !== null && RUN_TERMINAL_STATES.has(state);
  const active = state !== null && RUN_ACTIVE_STATES.has(state);
  const hasConfig = snapshot?.config != null;
  const canPreview = hasConfig && !BUSY_STATES.has(state ?? "") && preview.status !== "loading";
  const canStart = hasConfig && (state === "ready" || terminal) && !runStarting;
  const canCancel = active;
  const canReset = (active || terminal) && !resetting;
  const treeOpsDisabled = !hasConfig;
  const stateText = state === null ? "未加载配置" : (STATE_LABELS[state] ?? state);

  const result = preview.status === "ok" ? preview.result : null;
  const shownTasks = result?.plan.tasks.slice(0, PREVIEW_TASK_LIMIT) ?? [];
  const runResult = lastRun === null ? null : describeRun(lastRun);

  const expandAll = () => {
    const keys = new Set<TreeNodeKey>();
    collectFolderKeys(snapshot?.tree?.nodes ?? [], keys);
    setExpandedKeys(keys);
  };

  return (
    <div className="panel run-controls">
      <fieldset className="run-buttons">
        <legend>运行控制</legend>
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
        <Button isDisabled={!canPreview} onPress={() => void runPreview()}>
          预览
        </Button>
        <Button isDisabled={!canStart} onPress={() => void startRun()}>
          开始转换
        </Button>
        <Button isDisabled={!canCancel} onPress={() => void cancelRun()}>
          取消
        </Button>
        <Button isDisabled={!canReset} onPress={() => void resetSession()}>
          重置
        </Button>
      </fieldset>
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
      {preview.status === "loading" && <p className="empty-state">预览生成中…</p>}
      {preview.status === "error" && (
        <p role="alert" className="preview-error">
          预览失败：{preview.error}
          {preview.error?.startsWith("XRESLOADER_NOT_FOUND") &&
            "（请在“转换参数”中展开详细配置，填写有效的转表工具 xresloader JAR 路径）"}
        </p>
      )}
      {result !== null && (
        <details className="preview-details">
          <summary>
            预览结果：{result.plan.taskCount} 个任务
            {result.conflicts.length > 0 ? ` · ${result.conflicts.length} 组输出冲突` : ""}
          </summary>
          <section className="preview-panel" aria-label="预览结果">
            <p className="preview-summary">
              任务数：{result.plan.taskCount}；选中条目：{result.selectionCount}；执行目录：
              {result.plan.workDir}；转表工具：{result.plan.xresloaderPath}
            </p>
            {result.conflicts.length > 0 && (
              <div className="preview-conflicts" role="alert">
                <h3 className="preview-conflicts-title">输出冲突（同输出目录 + 重命名）</h3>
                <ul>
                  {result.conflicts.map((conflict) => (
                    <li key={`${conflict.outputDir}${conflict.rename}`}>
                      输出目录 {conflict.outputDir || "（默认）"} / 重命名{" "}
                      {conflict.rename || "（无）"}：{conflict.items.join("、")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ol className="preview-tasks">
              {shownTasks.map((task, index) => (
                // 预览结果是只读快照，列表不重排；display 可重复，无稳定业务 id。
                // biome-ignore lint/suspicious/noArrayIndexKey: 预览任务为一次性只读快照的有序列表
                <li key={index}>
                  <code>{task.display}</code>
                </li>
              ))}
            </ol>
            {result.plan.taskCount > shownTasks.length && (
              <p className="empty-state">
                仅显示前 {shownTasks.length} 条，共 {result.plan.taskCount} 条
              </p>
            )}
          </section>
        </details>
      )}
    </div>
  );
}
