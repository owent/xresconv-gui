import { translate as t, useI18n } from "../i18n";
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

/** 桌面工作区布局，组合配置、树、运行控制、日志和弹窗。 */
export function AppShell() {
  useI18n();
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
            <p>{t("app.subtitle")}</p>
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
