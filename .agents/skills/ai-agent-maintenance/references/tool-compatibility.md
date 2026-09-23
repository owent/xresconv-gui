# 跨工具兼容与文件选择

> 本表基于各工具官方文档调研结论，易变。新增任何工具专属文件前必须重新核验该工具当前官方文档，并更新 `docs/ai/source-index.md`。

## 文件选择决策表

| 需求 | 首选位置 | 何时使用 | 避免事项 |
| --- | --- | --- | --- |
| 项目级常驻规则 | `AGENTS.md` | 多数任务都必须知道的项目事实、命令、约束 | 不写通用废话，不放长流程 |
| Claude Code 兼容 | `CLAUDE.md` | 需要 Claude Code 读取同一套规则 | 不复制全文，优先 `@AGENTS.md` 导入 |
| 工具专属兼容覆盖 | 先用 `AGENTS.md`、`.agents/skills/`；必要时才用目标工具目录 | 共享入口无法表达优先级、权限、模式或运行时能力 | 先核验当前官方路径；只写差异 |
| 子目录规则 | 嵌套 `AGENTS.md` | 目录专属约定、模块差异明显 | 不重复父级规则 |
| 文件类型/路径规则 | 嵌套 `AGENTS.md`；必要时用工具专属规则（`.github/instructions/*.instructions.md`、`.claude/rules/`、`.devin/rules/`、`.agents/rules/`） | 需要目录、glob 或路径触发 | 不为单个工具复制通用规则；不用过宽 glob |
| 专用工作能力 | `.agents/skills/<name>/SKILL.md` | 多步骤流程、脚本、模板、参考资料、领域知识 | 不把全局编码规范塞进 Skill |
| 持久 Agent 角色 | 工具专属 agent 目录（`.github/agents/`、`.claude/agents/`、`.opencode/agents/`、`.kilo/agents/`、`.commandcode/agents/`） | 需要特定 persona、工具权限、handoff、子代理隔离 | 不复制规则；用链接引用共享规则 |
| 单次可复用任务 | 工具专属 prompt/workflow（`.github/prompts/`、Antigravity workflow） | 手动触发、轻量任务 | 不用于常驻规则；prompt files 在 VS Code Agent Host 会话中不生效 |
| 规格驱动的变更 | `openspec/specs/`、`openspec/changes/<change>/` | 新功能、行为变更、公开 API、数据模型、安全或部署合同 | 不用于微小修改；不与 roadmap/issue 重复维护同一事实 |
| 外部系统实时上下文 | MCP 配置与文档 | 数据库、Issue、CI、日志、设计稿等 | 不把密钥写入仓库；不跳过授权与审计 |
| 长期经验沉淀 | `docs/`、`AGENTS.md`、Skills | 已验证且团队共享的知识 | 不只写到本地 memory |

## 各工具当前约定

所有工具先复用根 `AGENTS.md` 和 `.agents/skills/`。只有当前官方文档证明需要优先级、权限、模式或运行时差异时，才增加工具专属薄层；薄层只写差异并链接共享规则。

- **Claude Code**：官方不原生读取 `AGENTS.md`，用 `CLAUDE.md` 的 `@AGENTS.md` 导入（最深 4 跳，Windows 不依赖符号链接）；规则拆分用 `.claude/rules/`（支持 `paths:` 作用域）；Skills 在 `.claude/skills/`；自定义 Agent 在 `.claude/agents/`（必填 `name`、`description`）；自定义 slash commands 已并入 Skills；迁移第三方配置可用 `/import`。
- **VS Code Copilot**：读取根 `AGENTS.md` 与 `.github/copilot-instructions.md`；Skills 读 `.agents/skills/`、`.github/skills/`、`.claude/skills/`；Agent 在 `.github/agents/*.agent.md`（`infer` 字段已弃用，用 `user-invocable`/`disable-model-invocation`）；用户级定制在 `~/.copilot/` 与 `~/.claude/`。
- **OpenCode**：读取 `AGENTS.md`（向上遍历）；Agent 在 `.opencode/agents/*.md`；Skills 读 `.opencode/skills/`、`.claude/skills/`、`.agents/skills/`。
- **Kilo Code**：读取根 `AGENTS.md`（`AGENT.md` 为备选）；Skills 在 `.kilo/skills/` 并兼容 `.agents/skills/`；Agent 在 `.kilo/agents/`；memory bank 已弃用，规则沉淀到 `AGENTS.md`；不再回退读取 `.opencode` 目录。
- **Pi**：读取 `AGENTS.md`；Skills 在 `.pi/skills/`、`~/.pi/agent/skills/` 并兼容 `.agents/skills/`；系统提示覆盖用 `SYSTEM.md`/`APPEND_SYSTEM.md`；扩展在 `.pi/extensions/`、`~/.pi/agent/extensions/` 或经 `pi install` 的 package；MCP 不在核心，由扩展桥接。
- **Oh My Pi（omp）**：Pi 上游 fork（含原生 Rust 核心）；自动发现 `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`/`.github/copilot-instructions.md`；原生格式为最近非空 `.omp/AGENTS.md`（优先级最高）与 `.omp/RULES.md`（sticky 规则）；Skills 多源发现，`skill://<name>` 按需加载、`/skill:<name>` 手动调用；原生支持 MCP、LSP、子代理与扩展，扩展能力前先 `/extensions` 确认。
- **Command Code**：读取 `AGENTS.md` 并兼容 `.agents/skills/`；工具专属覆盖用 `.commandcode/skills/`（冲突时优先）与 `.commandcode/agents/`。
- **Zoo Code**：Roo Code 归档后的社区 fork，配置目录仍为 `.roo/`（含 `.roo/rules/`）；读取 `AGENTS.md`/`AGENT.md`；不擅自把路径改成 `.zoo*`。
- **OpenClaw**：workspace `AGENTS.md` 为操作指令；Skills 优先级 `<workspace>/skills` > `<workspace>/.agents/skills` > `~/.agents/skills` > `~/.openclaw/skills`；`~/.openclaw/` 下凭据与会话不入库；第三方 Skill 从 ClawHub 安装前必须审计。
- **Hermes Agent**：上下文优先级 `.hermes.md`/`HERMES.md` > `AGENTS.md` > `CLAUDE.md`；Skills 兼容 agentskills.io，主目录 `~/.hermes/skills/`。
- **Devin Desktop（原 Windsurf，被 Cognition 收购）**：自动发现 `AGENTS.md`；规则首选 `.devin/rules/`，`.windsurf/rules/` 与 `.windsurfrules` 为 legacy fallback；Skills 在 `.windsurf/skills/` 并默认兼容 `.agents/skills/`；自动 memories 仅 legacy Cascade 支持，可靠规则应沉淀为规则文件。
- **Antigravity**：规则在 `.agents/rules/`（`.agent/` 已更名，仅向后兼容）；Skills 在 `.agents/skills/`；`GEMINI.md` 仅作全局规则（`~/.gemini/GEMINI.md`），无工作区级。

## 默认产物结构

首次初始化默认只创建跨工具最小骨架；其余目录仅在任务确实产生对应内容时创建，不为占位创建空目录。

```text
.
├── AGENTS.md
├── CLAUDE.md
└── .agents/
    └── skills/
        └── README.md
```

- `openspec/`：非默认；只有仓库决定采用 OpenSpec 管理可审阅变更时，才按当前官方 CLI 初始化或更新。
- `docs/ai/source-index.md`、`roadmap/`、`build/`、`development/`：按需创建。
