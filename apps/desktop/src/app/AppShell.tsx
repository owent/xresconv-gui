import { ConversionSettings } from "./ConversionSettings";
import { ConversionTree } from "./ConversionTree";
import { CustomActionBar } from "./CustomActionBar";
import { DialogHost } from "./DialogHost";
import { useDisplaySettings } from "./display-settings";
import { EnvironmentStatus } from "./EnvironmentStatus";
import { LogPanel } from "./LogPanel";
import { RunControls } from "./RunControls";
import { useBackendEvents } from "./use-backend-events";
import { useCliCustomSelectors } from "./use-cli-custom-selectors";

/**
 * 页面骨架（布局对照旧版 v2.6.0 index.html card-group 结构，2026-09-26 用户
 * 指示恢复）：顶部细状态条 → 左“转换列表”树（含事件开关 footer）｜右侧参数区
 * （文件行 + 详细配置折叠 + 重命名/协议/输出类型）→ 大日志 → 按钮组
 * （全选/全取消/全展开/全收起/预览/开始/取消/重置）→ 自定义按钮。
 * 新增能力（搜索/预览/日志筛选/矩阵/条目详情）为辅助入口，不取代原布局。
 * 各区域与 F01–F12 的映射见 ./feature-map.ts。
 */
export function AppShell() {
  useBackendEvents();
  useCliCustomSelectors();
  useDisplaySettings();
  return (
    <div className="app-shell">
      <EnvironmentStatus />
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
