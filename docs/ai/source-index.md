# 来源索引（source-index）

记录 AI 配置与技术决策的可追溯来源。易变条目带 `review_cadence` / `update_trigger` / `status`；只记录当前结论，不保存历史版本。

## 项目自身事实

| 主题 | 来源 | 结论 | status |
| --- | --- | --- | --- |
| 包管理器 | `README.md` 开发说明、`.github/workflows/build.yml` | 以 yarn 为准；三个 lockfile 并存是历史遗留，变更依赖只更新 `yarn.lock` | current |
| 构建/打包 | `gulpfile.js`、`package.json` scripts | gulp 5 任务驱动；`@electron/packager` 打包到 `out/`；macOS 必须 `asar=false` | current |
| 测试与 lint | 全仓库检索 | 当前无测试框架、无 lint/typecheck 配置；验证靠 `yarn run package-test` + 手动冒烟 | current（待补齐，见下方“已知缺口”） |
| 用户脚本沙箱 | `README.md` 事件支持/已知问题 | 事件脚本在渲染进程沙箱执行，未捕获异常导致白屏；须保持 `resolve()`/`reject()` 约定 | current |
| AI 配置骨架 | 本次初始化任务 | `AGENTS.md` 主入口 + `CLAUDE.md` 导入层 + `.agents/skills/` + `docs/ai/`；不创建占位目录与工具专属薄层 | current |
| Skill `ai-agent-maintenance` | `.agents/skills/ai-agent-maintenance/` | AI 配置维护流程；标注查询集见 `references/trigger-evaluation.md`，触发率未在 harness 中实测 | 触发评估未实测 |
| Skill `cli-tooling` | `.agents/skills/cli-tooling/` | 现代 CLI 选型/安装/迁移流程；完整对照表在 `references/modern-cli-tools.md`；触发率未在 harness 中实测 | 触发评估未实测 |
| 变更工作流文档 | `docs/ai/spec-driven-workflow.md` | 任务分流细则、OpenSpec/Superpowers 职责边界与 8 步流程、MCP 接入安全规则；仓库当前均未采用 | current（能力未启用） |
| 规范复核 | webfetch 核验 agentskills.io/specification 与 agents.md | Skill frontmatter 字段、渐进式披露、嵌套 AGENTS.md 就近优先等结论与现有配置一致 | current |

## 外部规范（易变，需定期复核）

| 主题 | 来源 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- |
| AGENTS.md 规范 | <https://agents.md/> | 季度 | 创建/修改 AGENTS.md 前 | current |
| Agent Skills 规范与最佳实践 | <https://agentskills.io/specification>、<https://agentskills.io/skill-creation/best-practices>、quickstart / optimizing-descriptions / evaluating-skills / using-scripts | 季度 | 创建/修改 Skill 前 | current |
| 客户端实现约定 | <https://agentskills.io/client-implementation/adding-skills-support> | 季度 | 评估新工具兼容前 | current |
| Claude Code（memory/skills/sub-agents/hooks/permissions） | <https://code.claude.com/docs/en/memory> 等 | 季度 | 修改 CLAUDE.md 或 .claude/ 前 | current |
| VS Code Copilot 定制 | <https://code.visualstudio.com/docs/agent-customization/overview> | 季度 | 修改 .github/ AI 配置前 | current |
| OpenCode | <https://opencode.ai/docs/rules>、agents、skills | 季度 | 新增 .opencode/ 前 | current |
| Kilo Code | <https://kilo.ai/docs/customize/agents-md>、skills | 季度 | 新增 .kilo/ 配置前 | current |
| Pi | <https://pi.dev/docs/latest>、<https://github.com/earendil-works/pi> | 季度 | 新增 .pi/ 前 | current |
| Oh My Pi | <https://github.com/can1357/oh-my-pi> | 季度 | 新增 .omp/ 前 | current |
| Command Code | <https://commandcode.ai/docs> | 季度 | 新增 .commandcode/ 前 | current |
| Zoo Code | <https://docs.zoocode.dev> | 季度 | 修改 .roo/ 前 | current |
| OpenClaw / ClawHub | <https://docs.openclaw.ai/tools/skills>、clawhub 文档 | 季度 | 安装第三方 Skill 前 | current |
| Hermes Agent | <https://hermes-agent.nousresearch.com/docs/> | 季度 | 新增 hermes 配置前 | current |
| Devin Desktop（原 Windsurf） | <https://docs.devin.ai/desktop/cascade/memories> 等 | 季度 | 新增 .devin/.windsurf 前 | current |
| Antigravity | <https://antigravity.google/docs/rules-workflows>、skills | 季度 | 新增 .agents/rules/ 前 | current |
| Superpowers | <https://github.com/obra/superpowers> 及 releases | 季度 | 考虑采用前 | 本仓库未安装，不得声称使用 |
| OpenSpec | <https://github.com/Fission-AI/OpenSpec> 及 docs/commands.md | 季度 | 团队决定采用时 | 本仓库未采用 |
| MCP 安全 | <https://modelcontextprotocol.io/docs/getting-started/intro>、security best practices | 季度 | 接入任何 MCP 前 | 本仓库未接入 |
| PowerShell 7+ 规则 | <https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_pwsh>、about_Parsing、about_Quoting_Rules、PSScriptAnalyzer | 半年 | 编写 .ps1 脚本前 | current |

## 已知缺口与后续建议

- 测试与 lint/typecheck 尚未落地；目标选型和任务已写入 [重构主计划](../../Plan.md) 与 [测试分册](../plan/06-testing-acceptance.md)：Vitest/Testing Library、Playwright、WDIO Tauri、Rust tests、TypeScript/Biome。版本兼容以主计划快照及实施时核验为准，不能将计划写成已安装。
- 三个 lockfile 并存增加混淆风险：建议经维护者确认后移除 `package-lock.json` 与 `pnpm-lock.yaml`。
- 本机环境限制：`yarn` 未全局安装、`npm`/`pnpm` 的 PowerShell shim 被执行策略拦截（用 `npm.cmd` 调用）；CI 中不受影响。
- Markdown 校验：新增/修改的 Markdown 必须通过 markdownlint（配置 `.markdownlint.json`，关闭 MD013 行长与 MD041 以适应 CJK 文本与 `@import` 语法）。既有 `README.md`、`CHANGELOG.md` 存在历史告警（MD029/MD034/MD009/MD012/MD032/MD007），未在本次初始化中改动；如需清理单独提交。
- 校验命令：`npx.cmd --yes markdownlint-cli@latest <files>`（本机无全局 markdownlint）。

## Tauri 重构计划来源

复核日期：2026-09-23。主计划保存先前核验的依赖/Actions 版本快照；本轮细化重新核验下表框架边界和源码。**实现、安装器、兼容性与性能均尚未验收。** 详细合同见 [执行计划索引](../plan/README.md)，不在本索引复制任务正文。

| 主题 | 来源 | 当前结论 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- | --- |
| 旧脚本语义 | `src/main.js` 的脚本入口、日志、节点与转换函数；`README.md`；`docs/custom-selector.json` | set_name 未注入 require；按钮 data 共享；日志依赖转换上下文；真实节点/缓存/回调兼容须建样例 | 每次相关改动 | P0/P2 契约与实现前 | 源码已核对，运行对照待执行 |
| Tauri sidecar | [官方文档](https://v2.tauri.app/develop/sidecar/) | 外部二进制命名与目标架构关联；进程树监督仍是本项目责任 | 每次 CLI 升级 | P1/P2/P5 | 文档已复核，原型待执行 |
| UI 权限与 CSP | [Capabilities](https://v2.tauri.app/security/capabilities/)、[CSP](https://v2.tauri.app/security/csp/) | 显式发行能力名单，不向 UI 暴露任意 shell；测试能力与发行隔离 | 每次安全/IPC 变化 | P1/P4/P5 | 文档已复核，配置未实现 |
| Node 脚本边界 | [VM](https://nodejs.org/api/vm.html)、[Permissions](https://nodejs.org/api/permissions.html) | VM/权限模型不等于恶意代码强沙箱；普通故障隔离依赖独立进程和外部监督 | 每次 Node 升级 | P2 与安全验收 | 文档已复核，D4 待定 |
| 子进程退出 | [Tokio Command](https://docs.rs/tokio/latest/tokio/process/struct.Command.html)、[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) | 不能把 drop/kill 当进程树回收证明；需平台所有权、wait 和宿主死亡清理 | 每次监督实现变化 | P2/P3 | 文档已复核，三平台原型待执行 |
| 三平台桌面自动化 | [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)、[WDIO Tauri](https://webdriver.io/docs/desktop-testing/tauri/) | embedded provider 可覆盖三平台；测试插件不进入正式包；原生窗口另验 | 每次 WDIO/Tauri 升级 | P1/P4/P6 | 文档已复核，测试未实现 |
| Windows 双变体 | [Windows Installer](https://v2.tauri.app/distribute/windows-installer/) | embedBootstrapper 与 offlineInstaller 分开出包并测试复用/缺失/过旧 | 每次运行时/打包升级 | P5 | 文档已复核，安装未验证 |
| 系统 WebView / Linux 包 | [WebView Versions](https://v2.tauri.app/reference/webview-versions/)、[Debian](https://v2.tauri.app/distribute/debian/) | macOS 随系统；Linux 离线闭包是本项目按发行版实现的设计，非 Tauri 自动保证 | 每次支持矩阵变化 | D2/D5/P5 | 文档已复核，平台矩阵待定 |
| React Aria 树 | [组件源码](https://github.com/adobe/react-spectrum/blob/main/packages/react-aria-components/src/Tree.tsx)、[官方用例](https://github.com/adobe/react-spectrum/blob/main/packages/react-aria-components/stories/Tree.stories.tsx) | 树/虚拟化与旧三态选择需适配和实测；Tree 文档直连本轮失败，使用官方源码/用例核验 | 每次组件升级 | P4 | 来源可用，组合未实测 |

同步范围：本轮只修改 Plan、计划分册、文档入口和本来源索引；当前 Electron 源码、依赖、工作流、Agent 规则和 Skills 保持其现有实现状态，不提前改写为 Tauri 已落地。
