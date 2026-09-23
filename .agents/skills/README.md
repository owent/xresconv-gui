# Agent Skills 索引

本目录遵循 [agentskills.io](https://agentskills.io/) 开放标准，存放跨工具复用的 Agent Skills（每个 Skill 一个子目录，内含 `SKILL.md`）。

## Skills

| Skill | 用途 | 何时使用 |
| --- | --- | --- |
| [ai-agent-maintenance](ai-agent-maintenance/SKILL.md) | AI 配置维护（AGENTS.md / CLAUDE.md / Skills / 工具专属层 / 来源索引） | 创建、修改或审计本仓库的 AI agent 配置时 |
| [cli-tooling](cli-tooling/SKILL.md) | 现代 CLI 工具选型、安装与存量脚本迁移 | 需要搜索/查找/替换等终端工具、工具缺失待安装、或替换传统 grep/find/sed 时 |

## 编写约束

新增 Skill 前先按 `ai-agent-maintenance` 的流程核验 agentskills.io 规范并完成触发评估。要点：

- frontmatter 必填 `name`（与目录同名，1–64 字符小写字母/数字/连字符）与 `description`（1–1024 字符，说明做什么与何时使用）。
- 正文保持简洁（<500 行），长资料放 `references/`、`scripts/`、`assets/` 并注明何时读取。
- 有副作用的 Skill 默认要求手动触发。
- 新增或修改 Skill 后记录到 `docs/ai/source-index.md`。
