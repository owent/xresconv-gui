import { useState } from "react";
import { Button } from "react-aria-components";
import type { CustomSelectorViewLike } from "../adapters/backend";
import { translate as t, useI18n } from "../i18n";
import { useSessionStore } from "./session-store";

/**
 * 自定义选择器、动作链和脚本按钮。
 * 数据来自快照 customSelectors（CLI --custom-selector/--custom-button 经
 * setCustomSelectors 进后端）：
 * 有 action → 动作链（reload/select_all/unselect_all/script:name 顺序执行，
 *   失败中止并记 CUSTOM SELECTOR 日志）；
 * 无 action → 匹配切换（有未选中 → 全选匹配项，否则全取消)；
 * 错误条目不渲染按钮，后端加载时记录诊断日志。
 */

/** 配置可用的按钮样式词表。 */
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
 * style 原值 → 本地语义类：白名单内（大小写不敏感）映射为
 * custom-btn--<style>；缺省/未知值回退——有 action → outline-dark，
 * 否则 outline-secondary。白名单校验恒真缺陷（B6）不复活：未知值不原样进 class。
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
  // 本地在途标记：连点不并发放大同一次点击链（按钮点击无禁用，但链内动作顺序执行）。
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
  useI18n();
  const customSelectors = useSessionStore((state) => state.snapshot?.customSelectors ?? null);
  const buttons = (customSelectors ?? []).filter(
    (view): view is CustomSelectorViewLike & { name: string } => view.name !== null,
  );

  // 自适应：未定义任何选择器/按钮时不占位渲染。
  if (buttons.length === 0) {
    return null;
  }

  return (
    <section className="panel custom-action-bar" aria-label={t("custom.title")}>
      <h2 className="panel-title">{t("custom.title")}</h2>
      <div className="custom-btn-group">
        {buttons.map((view) => (
          <CustomButton key={view.name} view={view} />
        ))}
      </div>
    </section>
  );
}
