/**
 * 自定义按钮区（F04 选择器、F05 动作链、F09 script 入口）。
 * 加载配置后经 --custom-selector/--custom-button 渲染按钮；
 * 原 action 顺序与名称、按钮样式语义保留（docs/plan/04-ui.md），P4-05 接入。
 */
export function CustomActionBar() {
  return (
    <section className="panel custom-action-bar" aria-label="自定义按钮">
      <h2 className="panel-title">自定义按钮</h2>
      <p className="empty-state">
        加载配置后在此显示自定义选择器与脚本按钮（--custom-selector；动作
        reload/select_all/unselect_all/script）。
      </p>
    </section>
  );
}
