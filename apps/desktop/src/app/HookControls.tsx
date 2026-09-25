import { Checkbox } from "react-aria-components";
import { guiHooksOf, HOOK_GROUPS } from "../adapters/backend";
import { useSessionStore } from "./session-store";

/**
 * 转换事件开关（F09；main.js:1122-1188 复选框，P4-05b 接入）。
 * 仅命名 hook（带 name 属性 → toggle）渲染复选框；匿名 hook 无 UI 开关不渲染。
 * checked 初始值由配置驱动（快照 hook.enabled），mutable="no" 禁用；
 * 切换经 setHookEnabled RPC 生效（无运行状态门禁，旧版复选框全程可改）。
 */
export function HookControls() {
  const config = useSessionStore((state) => state.snapshot?.config ?? null);
  const setHookEnabled = useSessionStore((state) => state.setHookEnabled);

  const gui = guiHooksOf(config);
  const namedGroups = HOOK_GROUPS.map(({ group, key, label }) => ({
    group,
    label,
    hooks: (gui?.[key] ?? [])
      .map((hook, index) => ({ hook, index }))
      .filter(({ hook }) => hook.toggle !== undefined),
  }));
  const hasAny = namedGroups.some(({ hooks }) => hooks.length > 0);

  return (
    <details className="panel hook-controls collapsible" aria-label="转换事件">
      <summary className="panel-title collapsible-summary">转换事件</summary>
      {hasAny ? (
        namedGroups.map(({ group, label, hooks }) =>
          hooks.length > 0 ? (
            <div className="hook-group" key={group}>
              <h3 className="hook-group-title">{label}</h3>
              <div className="hook-list">
                {hooks.map(({ hook, index }) => (
                  <Checkbox
                    key={`${group}:${String(index)}:${hook.toggle?.name ?? ""}`}
                    isSelected={hook.enabled}
                    isDisabled={hook.toggle?.mutable === false}
                    onChange={(selected) => void setHookEnabled(group, index, selected)}
                  >
                    {hook.toggle?.name}
                  </Checkbox>
                ))}
              </div>
            </div>
          ) : null,
        )
      ) : (
        <p className="empty-state">
          {gui === null ? "加载配置后在此显示可开关的转换事件。" : "当前配置没有可开关的命名事件。"}
        </p>
      )}
    </details>
  );
}
