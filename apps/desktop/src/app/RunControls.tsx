import { Button } from "react-aria-components";
import { useSessionStore } from "./session-store";

/** 预览任务展示上限（有界展示；超出仅给总数）。 */
const PREVIEW_TASK_LIMIT = 200;

const BUSY_STATES = new Set(["loading", "before_hooks", "converting", "after_hooks"]);

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
 * 运行控制与摘要（F08）：预览已接入（P4-04b，UI04）；开始/取消/重置属 P4-06，保留禁用。
 * 预览展示计划任务列表（有界，前 200 条）与 (outputDir, rename) 输出冲突；
 * XRESLOADER_NOT_FOUND 等错误给可读提示。配置未加载/运行中禁用预览。
 */
export function RunControls() {
  const snapshot = useSessionStore((state) => state.snapshot);
  const preview = useSessionStore((state) => state.preview);
  const runPreview = useSessionStore((state) => state.runPreview);

  const state = snapshot?.state ?? null;
  const canPreview =
    snapshot?.config != null && !BUSY_STATES.has(state ?? "") && preview.status !== "loading";
  const stateText = state === null ? "未加载配置" : (STATE_LABELS[state] ?? state);

  const result = preview.status === "ok" ? preview.result : null;
  const shownTasks = result?.plan.tasks.slice(0, PREVIEW_TASK_LIMIT) ?? [];

  return (
    <div className="panel run-controls">
      <fieldset className="run-buttons">
        <legend>运行控制</legend>
        <Button isDisabled={!canPreview} onPress={() => void runPreview()}>
          预览
        </Button>
        <Button isDisabled>开始转换</Button>
        <Button isDisabled>取消</Button>
        <Button isDisabled>重置</Button>
      </fieldset>
      <p role="status" aria-label="运行状态" className="run-summary">
        状态：{stateText}
      </p>
      {preview.status === "loading" && <p className="empty-state">预览生成中…</p>}
      {preview.status === "error" && (
        <p role="alert" className="preview-error">
          预览失败：{preview.error}
          {preview.error?.startsWith("XRESLOADER_NOT_FOUND") &&
            "（请在“转换参数”中配置有效的转表工具 xresloader JAR 路径）"}
        </p>
      )}
      {result !== null && (
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
      )}
    </div>
  );
}
