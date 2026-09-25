import { ConversionSettings } from "./ConversionSettings";
import { ConversionTree } from "./ConversionTree";
import { CustomActionBar } from "./CustomActionBar";
import { DialogHost } from "./DialogHost";
import { EnvironmentStatus } from "./EnvironmentStatus";
import { HookControls } from "./HookControls";
import { ItemDetails } from "./ItemDetails";
import { LogPanel } from "./LogPanel";
import { OutputMatrixEditor } from "./OutputMatrixEditor";
import { RunControls } from "./RunControls";
import { useBackendEvents } from "./use-backend-events";
import { useCliCustomSelectors } from "./use-cli-custom-selectors";

/**
 * 页面骨架：顶部环境状态，左侧转换树，右侧配置/详情/输出矩阵/事件/自定义按钮，
 * 底部运行控制与日志（Plan.md §5 布局 + docs/plan/04-ui.md §页面和组件边界）。
 * 各区域与 F01–F12 的映射见 ./feature-map.ts。
 */
export function AppShell() {
  useBackendEvents();
  useCliCustomSelectors();
  return (
    <div className="app-shell">
      <EnvironmentStatus />
      <ConversionTree />
      <main className="main-area">
        <ConversionSettings />
        <ItemDetails />
        <OutputMatrixEditor />
        <HookControls />
        <CustomActionBar />
      </main>
      <div className="bottom-area">
        <RunControls />
        <LogPanel />
      </div>
      <DialogHost />
    </div>
  );
}
