# 写作规则与模板

## AGENTS.md 编写规则

`AGENTS.md` 是给 AI Agent 的 README，只包含高信号内容：

- 项目目标和边界。
- 技术栈、包管理器、构建、测试、lint、类型检查、格式化命令。
- 终端命令约定：默认 shell（Windows 为 pwsh 7+）、现代工具优先级与回退规则。
- 目录结构和关键模块职责。
- 不易从代码推断的架构约束、兼容性要求和安全边界。
- 必须运行的验证步骤，以及如何缩小测试范围。
- 文档、部署、路线图、执行计划和 AI 配置更新规则。
- 秘密管理、本地调试和临时目录规则。
- 引用其他文件的按需加载规则（说明何时加载，不要求预加载全部资料）。

写作要求：

- 用短句和列表；不写“写好代码”“遵循最佳实践”这类泛泛内容。
- 说明非显而易见约束背后的原因。
- 根 `AGENTS.md` 保持简洁；模块细节放到嵌套 `AGENTS.md`、条件化规则、Skills 或 docs。
- 每次修改先尝试删减；新增规则必须说明触发条件和必要性。
- 多个 `AGENTS.md` 冲突时，离被编辑文件最近的优先；用户当前明确指令优先于仓库规则。

## CLAUDE.md 兼容规则

Claude Code 读取 `CLAUDE.md` 而非 `AGENTS.md`。为避免规则漂移：

```markdown
@AGENTS.md

## Claude Code

- 仅写 Claude Code 专属补充，例如权限模式、hooks 或本地记忆策略。
```

- 不复制 `AGENTS.md` 全文；Windows 默认用 `@AGENTS.md` 导入（最深 4 跳），不依赖符号链接。
- 需要把第三方 Agent 配置迁入 Claude Code 时，可用当前版本提供的 `/import` 命令，迁移后仍以 `@AGENTS.md` 保持单一事实源。
- `CLAUDE.md` 只写 Claude 专属差异；路径规则放 `.claude/rules/`，长流程放 Skill 或 docs。

## Agent Skills 编写规则

Agent Skills 遵循 agentskills.io 开放标准，默认创建在 `.agents/skills/<skill-name>/SKILL.md` 以便跨工具复用。工具专属目录只在该工具不读取 `.agents/skills/`、或确需工具专属字段/权限/优先级时创建，且先核验官方文档确认该路径当前有效。

Skill 必须遵守：

- frontmatter 跨工具字段：`name`（必填，1–64 字符，仅小写字母/数字/连字符，不含首尾或连续连字符，且必须与父目录同名）、`description`（必填，1–1024 字符）、可选 `license`、`compatibility`、`metadata`、`allowed-tools`（实验性，各工具支持不一）。
- `description` 用祈使句式说明做什么和何时使用（“Use when …”），聚焦用户意图而非实现细节；过宽会误触发，必要时写清近似但不适用的边界。
- 正文保持简洁（建议 <500 行 / <5000 tokens）；详细资料放 `references/`、`assets/`、`scripts/`（一层深度、相对路径引用）并说明何时读取。
- 上下文预算检查：默认加载只保留 `name`、`description` 和最短工作流；示例、长解释、脚本细节必须按需加载。
- 脚本必须非交互式，支持 `--help`，输出结构化结果，错误信息可操作，具备幂等性或 dry-run。
- 有副作用的 Skill 默认要求手动触发，或在工具支持时设置 `disable-model-invocation: true`。
- 从第三方复制或安装 Skill 前必须审计其脚本、依赖、网络访问和权限声明；可用官方校验器 `skills-ref validate` 检查规范符合性。

Skill 模板：

```markdown
---
name: example-skill
description: "Use this skill when the user asks to perform a specific repeatable workflow that needs these instructions, scripts, or references. Not for generic coding requests covered by AGENTS.md."
license: Proprietary
metadata:
  owner: project-ai-maintainers
---

# Example Skill

## Outcome

State the concrete result this skill should produce.

## Use when

- List precise trigger scenarios and near-miss boundaries.

## Workflow

1. Inspect inputs and constraints.
2. Load only the referenced files needed for this task.
3. Run scripts with explicit arguments and timeouts when applicable.
4. Validate outputs and fix issues until checks pass.

## Resources

- Read [references/example.md](references/example.md) only when the task needs detailed examples.
- Run `scripts/validate.sh --help` before running validation.

## Validation

- Define exact checks, expected files, or tests.
- Record failures and update this skill if the same issue recurs.
```

## 自定义 Agent 规则

只有在需要持久角色、工具限制、模型偏好、子代理隔离或 handoff 时才创建自定义 Agent。

- 创建或修改前，先核验目标工具当前官方字段语义（文件位置、frontmatter、description、mode、tools/permissions、subagent/handoff、model、上下文预算和安全限制）；无法核验时不要生成工具专属 Agent。
- 规划类 Agent 尽量只读；审查和安全类默认禁止写入；实现类可以写入但必须遵守测试、lint、安全和文档同步流程。
- Agent 提示词不复制 `AGENTS.md` 或 Skill 正文；用 Markdown 链接引用共享规则，只写角色边界、权限、handoff、启动检查和工具限制。
- 每次维护 Agent 提示词时删除重复、过期和低信号内容。
- 对外部工具和 MCP 权限采用最小权限原则。

## MCP 接入规则

MCP 接入的完整安全规则见 `docs/ai/spec-driven-workflow.md`“MCP 接入安全规则”。维护 AI 配置时记住两点：MCP 配置与凭据文件（OAuth token、API key、cookies、会话文件）不进仓库、不进日志；仓库新增 MCP 配置前必须先调研当前规范版本并更新来源索引。

## 第三方 Skill 调研（ClawHub）

创建或修复 self-improvement、error-repair、skill-maintenance 类 Skill 时，必须实时参考 ClawHub 当前靠前结果，但不得把某个版本的正文固化进配置：

1. 使用 ClawHub 官方 API 检索：`GET https://clawhub.ai/api/v1/search?q=<query>&limit=5&nonSuspiciousOnly=true`，必要时用 `GET /api/v1/skills?sort=trending|downloads|stars` 交叉验证。
2. 对候选只取前 3–5 个审计：slug、summary、latestVersion、安全扫描信息和 `SKILL.md` 必要片段。
3. 只提炼可迁移模式（失败记录、纠错捕获、评估、promote、dry-run、pin、rollback、审批）；不复制正文、脚本或排名。
4. 遵守速率限制和 `Retry-After`；任务结束后在来源索引记录查询词、候选 slug、版本、安全状态和取舍理由。
5. 如果 ClawHub 不可访问，明确标注“ClawHub 最新结果未验证”，不根据旧记忆推断。
