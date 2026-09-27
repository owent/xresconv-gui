import { ConversionSettings } from "./ConversionSettings";
import { ConversionTree } from "./ConversionTree";
import { CustomActionBar } from "./CustomActionBar";
import { DialogHost } from "./DialogHost";
import { useDisplaySettings } from "./display-settings";
import { useEnvironmentDiagnostics, usePostLoadLogSummary } from "./environment-diagnostics";
import { Icon } from "./Icon";
import { LogPanel } from "./LogPanel";
import { RunControls } from "./RunControls";
import { useBackendEvents } from "./use-backend-events";
import { useCliCustomSelectors } from "./use-cli-custom-selectors";

/**
 * 顶部文件工具栏、中部树与日志工作区、底部运行操作。
 * 详情和显示设置按需打开；环境诊断写入运行日志。
 * 各区域与 F01–F12 的映射见 ./feature-map.ts。
 */
export function AppShell() {
  useBackendEvents();
  useCliCustomSelectors();
  useDisplaySettings();
  useEnvironmentDiagnostics();
  usePostLoadLogSummary();
  return (
    <main className="app-shell">
      <header className="workspace-header">
        <div className="app-brand">
          <span className="brand-mark">
            <Icon name="app" />
          </span>
          <div>
            <h1>
              xresconv<span className="brand-suffix">gui</span>
            </h1>
            <p>配置转换工作台</p>
          </div>
        </div>
        <ConversionSettings />
      </header>
      <ConversionTree />
      <div className="right-panel">
        <CustomActionBar />
        <LogPanel />
      </div>
      <RunControls />
      <DialogHost />
    </main>
  );
}
