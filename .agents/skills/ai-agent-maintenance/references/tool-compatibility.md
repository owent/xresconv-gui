# 文件选择与工具兼容

## 文件选择

| 需求 | 位置与约定 |
| --- | --- |
| 项目常驻规则 | 根 AGENTS.md，高信号事实与文档入口 |
| 模块专属规则 | 就近 AGENTS.md，只写相对根规则的差异 |
| 复用工作能力 | `.agents/skills/<name>/SKILL.md`，按需加载参考 |
| Claude 入口 | CLAUDE.md 导入 AGENTS.md，共享正文只维护一次 |
| 工具专属权限或模式 | 先核验该工具官方路径与 Schema，再添加薄兼容层 |
| 自定义 Agent / prompt | 确有持续角色或复用任务时按目标工具规范创建 |
| 团队共享知识 | 用户/开发文档、来源索引或按需 Skill 参考 |

默认结构为 AGENTS.md、CLAUDE.md 和 .agents/skills/README.md，其他目录在任务实际需要时创建。

## 兼容检查

现有工具层先复用共享规则。新增 Copilot、OpenCode、Kilo 或其他工具配置前，检查当前官方文档、实际 harness 支持、发现路径、优先级、权限和字段。不要依据工具名称猜测能力，也不要为尚未使用的工具生成占位文件。

[Claude 官方文档](https://code.claude.com/docs/en/memory)支持 AGENTS.md，并提供 CLAUDE.md 的 @path 导入。仓库 CLAUDE.md 使用该导入共享规则，验证时检查客户端实际加载结果，避免正文重复。

[Agent Skills 规范](https://agentskills.io/specification)约束 frontmatter 和目录结构，客户端发现路径仍需核验目标工具。配置来源与复核条件写入[来源索引](../../../../docs/ai/source-index.md)。
