import { useState } from "react";
import { Button } from "react-aria-components";
import type { CustomSelectorViewLike } from "../adapters/backend";
import { useSessionStore } from "./session-store";

/**
 * 自定义按钮区（F04 选择器、F05 动作链、F09 script 入口，P4-05b 接入）。
 * 数据来自快照 customSelectors（CLI --custom-selector/--custom-button 经
 * setCustomSelectors 进后端；视图语义见 P4-05a 记录）：
 * - 有 action → 动作链（reload/select_all/unselect_all/script:name 顺序执行，
 *   失败中止并记 CUSTOM SELECTOR 日志）；
 * - 无 action → 匹配切换（有未选中 → 全选匹配项，否则全取消；main.js:416-428）；
 * - 错误条目不渲染按钮（旧版仅记日志，main.js:753-767；后端加载时已记）。
 */

/** 旧版 bootstrap 按钮样式词表（main.js:718-736 availableStyles）。 */
const KNOWN_STYLES = new Set([
  "outline-primary",
  "outline-secondary",
  "outline-success",
  "outline-danger",
  "outline-warning",
  "outline-info",
  "outline-light",
  "outline-dark",
  "primary",
  "secondary",
  "success",
  "danger",
  "warning",
  "info",
  "light",
  "dark",
]);

/**
 * style 原值 → 本地语义类（main.js:775-792）：白名单内（大小写不敏感）映射为
 * custom-btn--<style>；缺省/未知值回退——有 action → outline-dark，
 * 否则 outline-secondary。旧版白名单校验恒真缺陷（B6）不复活：未知值不原样进 class。
 */
function styleClass(view: { hasAction: boolean; style: string | null }): string {
  const style = view.style?.toLowerCase() ?? null;
  if (style !== null && KNOWN_STYLES.has(style)) {
    return `custom-btn--${style}`;
  }
  return view.hasAction ? "custom-btn--outline-dark" : "custom-btn--outline-secondary";
}

function CustomButton({ view }: { view: CustomSelectorViewLike & { name: string } }) {
  const invokeCustomButton = useSessionStore((state) => state.invokeCustomButton);
  // 本地在途标记：连点不并发放大同一次点击链（旧版按钮点击无禁用，但链内动作顺序执行）。
  const [pending, setPending] = useState(false);
  return (
    <Button
      className={`custom-btn ${styleClass(view)}`}
      isDisabled={pending}
      onPress={() => {
        setPending(true);
        void invokeCustomButton(view.name).finally(() => setPending(false));
      }}
    >
      {view.name}
    </Button>
  );
}

export function CustomActionBar() {
  const customSelectors = useSessionStore((state) => state.snapshot?.customSelectors ?? null);
  const buttons = (customSelectors ?? []).filter(
    (view): view is CustomSelectorViewLike & { name: string } => view.name !== null,
  );

  return (
    <section className="panel custom-action-bar" aria-label="自定义按钮">
      <h2 className="panel-title">自定义按钮</h2>
      {buttons.length > 0 ? (
        <div className="custom-btn-group">
          {buttons.map((view) => (
            <CustomButton key={view.name} view={view} />
          ))}
        </div>
      ) : (
        <p className="empty-state">
          {customSelectors === null
            ? "未配置自定义选择器（启动参数 --custom-selector/--custom-button）。"
            : "自定义选择器文件中没有可用条目（错误条目见日志）。"}
        </p>
      )}
    </section>
  );
}
