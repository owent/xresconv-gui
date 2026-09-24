/**
 * 日志面板（F08 运行日志、F10 日志展示与改写）。
 * 虚拟列表、筛选/导出、富文本白名单在 P4-07 接入；
 * 筛选不影响落盘日志与脚本 hook（docs/plan/04-ui.md）。
 */
export function LogPanel() {
  return (
    <section className="panel log-panel" aria-label="运行日志">
      <h2 className="panel-title">运行日志</h2>
      <div role="log" aria-label="日志列表" className="log-list">
        <p className="empty-state">暂无日志</p>
      </div>
    </section>
  );
}
