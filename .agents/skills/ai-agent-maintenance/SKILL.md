---
name: ai-agent-maintenance
description: "Use When: creating, updating, or auditing AI agent configuration in this repository — AGENTS.md, CLAUDE.md, Agent Skills, tool-specific compatibility layers (.claude/, .github/, .kilo/, .opencode/, etc.), custom agents, or the AI source index. Not for ordinary feature code or bug fixes covered by AGENTS.md."
license: MIT
metadata:
  owner: project-ai-maintainers
  last-reviewed: 2026-09-25
---

# AI Agent 配置维护

## Outcome

产出跨工具一致、低冗余、可追溯来源的 AI 配置：`AGENTS.md` 保持高信号单一事实源，Skills 符合 agentskills.io 规范，工具专属层只写差异，`docs/ai/source-index.md` 记录全部依据。

## Use when

- 创建或修改 `AGENTS.md`、`CLAUDE.md`、`.agents/skills/**`、任何工具专属配置目录。
- 新增或修改 Agent Skill、自定义 Agent、prompt/workflow 文件。
- 定期复核 AI 工具兼容性、来源索引、Skill 触发质量。
- 不适用：普通功能开发、缺陷修复（走 `AGENTS.md` 任务分流）。

## Workflow

1. 读 `AGENTS.md`“不可违反的原则”与本文件；确认本次改动属于哪类产物。
2. **先核验当前官方文档**：改 Skill 前查 agentskills.io 的 specification / best-practices；改工具专属层前查该工具当前文档（路径、schema、字段语义）。核验不到就标注“未验证”，不生成。
3. 按文件选择决策表确定写入位置（见 [references/tool-compatibility.md](references/tool-compatibility.md) 第一节）。
4. 按写作规则撰写（见 [references/writing-rules.md](references/writing-rules.md)）：AGENTS.md 只放高信号常驻事实；Skill 遵守 frontmatter 与渐进式披露；工具专属层只写差异并链接共享规则。
5. 删除被替代的旧内容，合并去重，不留历史版本；新增/迁移来源写入 `docs/ai/source-index.md`。
6. 新增或修改 Skill 后执行触发评估（流程与查询集见 [references/trigger-evaluation.md](references/trigger-evaluation.md)），并更新 `metadata.last-reviewed`。
7. 运行 markdownlint 验证全部改动文件：`npx.cmd --yes markdownlint-cli@latest <files>`。
8. 结束前按 `AGENTS.md`“任务完成前检查清单”核对。

## Resources

- [references/tool-compatibility.md](references/tool-compatibility.md)：文件选择决策表 + 各 AI 工具（Claude Code、Copilot、OpenCode、Kilo、Pi、Oh My Pi、Command Code、Zoo、OpenClaw、Hermes、Devin、Antigravity）当前配置目录约定。**新增任何工具专属文件前必读**。
- [references/writing-rules.md](references/writing-rules.md)：AGENTS.md / CLAUDE.md / SKILL.md / 自定义 Agent 的写作规则与模板。**撰写内容前必读**。
- [references/trigger-evaluation.md](references/trigger-evaluation.md)：Skill 触发评估流程与标注查询集。**新增/修改 Skill 后必读**。
- `docs/ai/source-index.md`：来源与复核节奏登记处，每次维护后更新。

## Validation

- markdownlint 零告警（配置 `.markdownlint.json`）。
- Skill frontmatter 通过官方校验：`skills-ref validate <skill-dir>`（工具不可用时人工核对必填字段与命名规则）。
- `AGENTS.md` 无与 Skills/工具层重复的正文；`CLAUDE.md` 仅含 `@AGENTS.md` 导入与差异补充。
- 触发评估结果已记录（或明确标注“未在 harness 中实测”）。
