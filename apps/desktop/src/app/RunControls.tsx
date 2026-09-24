import { Button } from "react-aria-components";

/**
 * 运行控制与摘要（F08）：预览/开始/取消/重置与运行状态。
 * 按钮可用性由领域状态决定（docs/plan/04-ui.md），配置就绪前全部禁用；
 * 真实 RunContext 在 P4-06 接入。取消/重置须先等待后端清理。
 */
export function RunControls() {
  return (
    <div className="panel run-controls">
      <fieldset className="run-buttons">
        <legend>运行控制</legend>
        <Button isDisabled>预览</Button>
        <Button isDisabled>开始转换</Button>
        <Button isDisabled>取消</Button>
        <Button isDisabled>重置</Button>
      </fieldset>
      <p role="status" aria-label="运行状态" className="run-summary">
        状态：未加载配置
      </p>
    </div>
  );
}
