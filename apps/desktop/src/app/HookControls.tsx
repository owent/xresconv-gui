import { Checkbox } from "react-aria-components";

/**
 * 转换事件开关（F09）：on_before_convert / on_after_convert / on_append_log。
 * 骨架为禁用态；事件的 name/checked/mutable/timeout 由配置驱动，
 * immutable 开关不可改、被禁用事件不执行（docs/plan/04-ui.md），P4-05 接入。
 */
export function HookControls() {
  return (
    <section className="panel hook-controls" aria-label="转换事件">
      <h2 className="panel-title">转换事件</h2>
      <div className="hook-list">
        <Checkbox isDisabled>转表前事件（on_before_convert）</Checkbox>
        <Checkbox isDisabled>转表后事件（on_after_convert）</Checkbox>
        <Checkbox isDisabled>日志事件（on_append_log）</Checkbox>
      </div>
      <p className="empty-state">事件的启用状态与可编辑性由加载的配置决定（P4-05）。</p>
    </section>
  );
}
