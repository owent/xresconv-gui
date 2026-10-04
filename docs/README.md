# 文档索引

- [项目使用说明](../README.md)：软件的使用、配置、脚本和开发说明（含 3.0 新界面示例截图与动图）。
- [全面重构主计划](../Plan.md)：当前目标、支持边界、功能编号与阶段摘要。
- [详细执行计划](plan/README.md)：按模块路由接口/平台/测试约定；活动任务集中在 [发行后续清单](plan/08-release-follow-up.md)；进度记录见 [plan/records](plan/records/README.md)。
- [2026-10-04 macOS 自动交互验收](plan/records/MACOS-E2E-2026-10-04.md)：当前候选的三平台桌面、macOS 双架构各 13 项、Portable 构建与缓存复用记录，以及计划收尾边界。
- [2026-10-03 发布核对](plan/records/RELEASE-2026-10-03.md)：首轮 dev.0 用户验证、实际发布资产/CI 及 dev.1 后续验收边界。
- [2026-10-03 本地执行](plan/records/EXECUTION-2026-10-03.md)：XML 解析隔离、Windows/WSL 门禁、最终包及 ARM64 交叉打包记录。
- [2026-09-30 提交审查](plan/records/REVIEW-2026-09-30.md)：从 `3610cc4` 之后 18 个提交的代码、回归测试、文档与剩余发行验收边界。
- [技术与规则来源](ai/source-index.md)：来源链接、核验状态与复查触发条件。
- [写作规则](../.agents/skills/ai-agent-maintenance/references/writing-rules.md)：研发用语、句式关系与自然表达；后半部分为 AI 配置文件的专门要求。
- [界面素材](media/README.md)：3.0 新界面 README 截图/GIF 索引与自动采集方法。
- [应用视觉资源](brand/README.md)：图标设计母版、各平台导出文件及 Git LFS 规则。
- [变更工作流](ai/spec-driven-workflow.md)：设计合同与实施流程，工具采用状态以文档说明为准。
- [自定义选择器示例](custom-selector.json)：现有按钮、scheme/sheet 选择规则示例。

当前状态（2026-10-04）：dev.0 首轮与 dev.1 发布已完成，本轮不发布；d61d639 的 ci/Portable 均通过，macOS 双架构自动交互已验收。证书验收已按用户要求撤除，完整候选构建与最终实机范围见 [后续清单](plan/08-release-follow-up.md)。分别记录公开介质与当前测试构建的验证结果；使用说明以 [项目使用说明](../README.md) 和实际源码为准。
