# Skill 触发质量评估

新增或修改 Skill 后必须执行触发评估。当前仓库未接入可自动统计触发率的 harness 时，执行人工评审并标注“未在 harness 中实测”。

## 流程

1. 编写约 20 条标注查询：8–10 条应触发，8–10 条不应触发（重点覆盖 near-miss 近似场景、口语、拼写错误、隐式意图）。
2. 每条查询至少运行 3 次统计触发率，默认通过阈值 0.5；按约 60/40 划分 train/validation 防止过拟合。
3. 误触发则缩窄 `description`，漏触发则补充意图描述；**禁止**把失败查询的具体关键词直接塞回 `description`。
4. 更新 Skill 的 `metadata.last-reviewed`、`docs/ai/source-index.md` 和维护记录。

## ai-agent-maintenance 标注查询集

### 应触发（正例）

1. “更新 AGENTS.md 加入新的打包命令”
2. “给仓库新增一个发布流程的 Skill”
3. “这个 Skill 的 description 写得对不对”
4. “Claude Code 读不到我们的规则，怎么处理”
5. “帮我加一个 .kilo 专属的 agent 配置”
6. “审计一下 .agents/skills 是否符合规范”
7. “把 Copilot 的 instructions 和 AGENTS.md 对齐”
8. “source-index.md 里的来源过期了，刷新一下”
9. “我想给 OpenCode 加个子代理”
10. “SKILL.md 的 frontmatter 缺了哪些字段”

### 不应触发（负例 / near-miss）

1. “修复打包时 icon 路径错误”（普通缺陷修复）
2. “给 GUI 加一个自定义按钮功能”（功能开发）
3. “README.md 里的截图链接失效了”（普通文档修复，非 AI 配置）
4. “升级 electron 到最新版本”（依赖升级）
5. “帮我写一个用户脚本 on_after_convert”（运行时功能）
6. “gulp 打包报错怎么排查”（构建问题）
7. “CI workflow 上传 release 失败”（CI 修复，非 AI 配置）
8. “把 log4js 日志级别改成 debug”（配置调整）
9. “agent 这个词在代码里什么意思”（代码理解）
10. “帮我审查这次 PR 的代码质量”（代码审查）

## 评估记录

- 2026-09-25：`description` 统一为 `Use When:` 标准前缀（用户决策，语义与触发边界未变）；触发率未在 harness 中实测，待按上方流程补测。
