# 08 发行后续环境验收

[执行索引](README.md) · [发行约定](05-packaging-release.md) · [测试约定](06-testing-acceptance.md)

更新日期：2026-10-04。**当前执行计划已全部完成，活动任务为零。** 完成范围按用户确认的 Windows 本机和 WSL/Debian 实机验收；过程、修复、介质身份与实际结果已移入 [本机验收记录](records/LOCAL-ACCEPTANCE-2026-10-04.md)。

## 完成范围

- Windows 本机 x64、WSL/Debian x86_64 的两变体桌面交互、原生文件选择/保存/取消和所属子树清理已通过；本轮发现的启动竞态和 AppRun 测试偏好隔离已修复并补回归。
- 其他系统版本、macOS 实机、ARM64 硬件、干净 VM、GNOME/KDE、完整 X11/Wayland 与原生触控验收按用户指令撤出本轮计划，记录为范围撤除。证书签名、公证/stapling、Gatekeeper 验收已撤除；ARM64 保留已完成构建/静态核验，运行免验。
- 平台支持声明、构建矩阵与现有自动化仍保留。macOS 双架构自动交互 R11 和正式 12 产物构建 R12 的提交与结果见 [CI 记录](records/MACOS-E2E-2026-10-04.md)、[完整构建](records/COMPLETION-2026-10-04.md)。
- 本轮不发布。新本地介质明确标记工作树未提交；公开 dev.1 的标签/旧资产身份按 [发布核对](records/ACCEPTANCE-2026-10-04.md)保留，不由本地验证覆盖。

## 进度更新规则

每项完成后从活动表迁入 records，保留提交/介质 digest、实际命令/数量/退出码、首轮失败与未验边界。变更接口或平台时同步模块分册、测试和 [来源索引](../ai/source-index.md)；稳定 Agent 约束改变时才更新 AGENTS/Skills。历史记录保留当时语境，不把过去的失败改成当前成功。
