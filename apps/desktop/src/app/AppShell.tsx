import { ConversionSettings } from "./ConversionSettings";
import { ConversionTree } from "./ConversionTree";
import { CustomActionBar } from "./CustomActionBar";
import { DialogHost } from "./DialogHost";
import { useDisplaySettings } from "./display-settings";
import { useEnvironmentDiagnostics, usePostLoadLogSummary } from "./environment-diagnostics";
import { LogPanel } from "./LogPanel";
import { RunControls } from "./RunControls";
import { useBackendEvents } from "./use-backend-events";
import { useCliCustomSelectors } from "./use-cli-custom-selectors";

/**
 * 页面骨架（布局对照旧版 v2.6.0 index.html card-group 结构；2026-09-26 三轮
 * 改版移除顶部状态条）：左“转换列表”树（含事件开关 footer）｜右侧参数区
 * （文件行 + ⚙显示设置/详情弹窗 + 重命名/协议/输出类型）→ 大日志 → 按钮组
 * → 自定义按钮。环境/版本/Java 等调试信息不再占主面板，全部写入运行日志
 * （useEnvironmentDiagnostics）。
 * 各区域与 F01–F12 的映射见 ./feature-map.ts。
 */
export function AppShell() {
  useBackendEvents();
  useCliCustomSelectors();
  useDisplaySettings();
  useEnvironmentDiagnostics();
  usePostLoadLogSummary();
  return (
    <div className="app-shell">
      <ConversionTree />
      <main className="right-panel">
        <ConversionSettings />
        <LogPanel />
        <RunControls />
        <CustomActionBar />
      </main>
      <DialogHost />
    </div>
  );
}
