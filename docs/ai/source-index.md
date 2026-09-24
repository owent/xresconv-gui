# 来源索引（source-index）

记录 AI 配置与技术决策的可追溯来源。易变条目带 `review_cadence` / `update_trigger` / `status`；只记录当前结论，不保存历史版本。

## 项目自身事实

| 主题 | 来源 | 结论 | status |
| --- | --- | --- | --- |
| 包管理器 | `package.json`、`.yarnrc.yml`、`yarn.lock`、工作树状态 | 唯一 JS 锁为 yarn.lock，Cargo.lock 服务 Tauri；2026-09-24 immutable 安装通过，WDIO 既有四项 peer 警告另列于审查记录 | current（Windows 本机） |
| 构建/打包 | `gulpfile.js`、`package.json` scripts | gulp 5 任务驱动；`@electron/packager` 打包到 `out/`；macOS 必须 `asar=false` | current |
| 测试与 lint | [2026-09-24 审查](../plan/records/REVIEW-P0-P3-2026-09-24.md)、`package.json`、`tests/` | 217 例 Node/前端（含契约）+ 1 例 Rust 回归、3 例 WebView2 E2E、六格式真实 JAR 差分通过；Schema 重新生成无漂移 | current（win32/x64；非 G2/G3 完整验收） |
| P0 基线环境 | `docs/plan/records/P0-01.md`、`P0-04.md`、`P0-05.md` | 历史基线用 Yarn 1.22.22 + yarn.lock v1；与当前 Yarn 4 工作树区分。固定组合：OpenJDK 25.0.4.1 + xresloader 2.23.6.jar（sha256 `72fd7655…0caa88`）。记录提示旧 Electron 启动前需移除 `ELECTRON_RUN_AS_NODE=1` | 既有记录，本轮未重跑 |
| 用户脚本沙箱 | `README.md` 事件支持/已知问题 | 事件脚本在渲染进程沙箱执行，未捕获异常导致白屏；须保持 `resolve()`/`reject()` 约定 | current |
| AI 配置骨架 | 本次初始化任务 | `AGENTS.md` 主入口 + `CLAUDE.md` 导入层 + `.agents/skills/` + `docs/ai/`；不创建占位目录与工具专属薄层 | current |
| Skill `ai-agent-maintenance` | `.agents/skills/ai-agent-maintenance/` | AI 配置维护流程；标注查询集见 `references/trigger-evaluation.md`，触发率未在 harness 中实测 | 触发评估未实测 |
| Skill `cli-tooling` | `.agents/skills/cli-tooling/` | 现代 CLI 选型/安装/迁移流程；完整对照表在 `references/modern-cli-tools.md`；触发率未在 harness 中实测 | 触发评估未实测 |
| 变更工作流文档 | `docs/ai/spec-driven-workflow.md` | 任务分流细则、OpenSpec/Superpowers 职责边界与 8 步流程、MCP 接入安全规则；仓库当前均未采用 | current（能力未启用） |
| 旧行为合同 | `docs/plan/records/P0-08.md` | 2026-09-24 全量提取：main.js/setup.js 五类脚本入口上下文、转换执行、include 竞态、选择器回退、README 七处分歧；P2/P3 实现的语义基线 | current |
| xresloader stdin 协议 | `../xresloader/src/org/xresloader/core/Main.java:344-411`（本地检出） | tokenizer `('[^']*')\|("[^"]*")\|(\S+)`；空 token 丢弃；无转义；退出码=失败任务数累加。编码器实现见 packages/backend/src/convert/stdin-encoder.ts | current |
| Node 24 类型剥离 | 实测（P2-01/P2-03） | 可直接 spawn 运行 .ts；仅限 erasable 语法（biome noParameterProperties/noEnum 强制）；相对导入必须显式 `.ts` 后缀；workspace 包名导入 .ts 经 symlink 可行 | current |

| 规范复核 | webfetch 核验 agentskills.io/specification 与 agents.md | Skill frontmatter 字段、渐进式披露、嵌套 AGENTS.md 就近优先等结论与现有配置一致 | current |

## 重构决策记录（D1–D6，2026-09-23 用户决策）

D1–D5 登记与影响分析见 [P0-06](../plan/records/P0-06.md)；D6 见 [主计划 §2.3](../../Plan.md)。此处只留当前结论，不改写历史基线记录。

| 决策 | 结论 | status |
| --- | --- | --- |
| D1 32 位平台 | 允许删除 Windows ia32、Linux armv7l；新矩阵仅 64 位，旧 2.6.0 发行保留为终点版本 | current |
| D2 Linux 范围与打包 | Ubuntu 22.04/24.04、Debian 12/13、Fedora 最近两个正式版本；GNOME/KDE、X11/Wayland；offline 优先单一自含包（含 WebKitGTK），P5 原型验证，不可行回退按发行版闭包 | current（自含包可行性待 P5 验证） |
| D3 脚本兼容范围 | 仅承诺文档化公开接口（README + `tests/fixtures/scripts/contract.md`）；DOM/jQuery/Electron/未公开 Fancytree 内部不兼容，检测到给诊断与迁移指引 | current |
| D4 威胁模型 | 可信脚本 + 故障隔离；允许文件/外部进程；边界是故障不得白屏/杀主进程/卡死任务 + IPC 授权；不声称防恶意沙箱 | current |
| D5 macOS 交付 | 系统 WKWebView；系统不足引导升级 macOS；最低系统取 Node/Tauri/前端交集（候选 13.5，P5 复核） | current（最低版本待 P5 复核） |
| D6 实现语言 | 业务、配置、调度、日志和 guardian 采用 TypeScript/Node.js；Tauri 只保留必要 Rust 构建/入口/胶水；用户 JS 继续独立进程隔离 | current（本轮修订计划，迁移待实施） |

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

- P2/P3 核心已有本机测试证据，P3-06 会话编排也已落地；本轮修复 XML 边界、IPC/worker 生命周期、Java 管道失败、取消收尾和日志隔离，见最新审查。剩余：独立 guardian/backend 长期接线、三平台进程树、NodeMirror、共享对象/模块缓存合同、隔离 matcher/XML helper、完整 reset/close、P4–P7；不能把模块通过写成 G2/G3 已完成。
- Yarn 4 `--immutable` 已在本机通过；动态 require 全部样本与 CI 仍待完成，保留已有工作树改动。
- 本机环境限制：`yarn` 未全局安装、`npm`/`pnpm` 的 PowerShell shim 被执行策略拦截（用 `npm.cmd` 调用）；CI 中不受影响。
- Markdown 校验：新增/修改的 Markdown 必须通过 markdownlint（配置 `.markdownlint.json`，关闭 MD013 行长与 MD041 以适应 CJK 文本与 `@import` 语法）。既有 `README.md`、`CHANGELOG.md` 存在历史告警（MD029/MD034/MD009/MD012/MD032/MD007），未在本次初始化中改动；如需清理单独提交。
- 校验命令：`npx.cmd --yes markdownlint-cli@latest <files>`（本机无全局 markdownlint）。

## Tauri 重构计划来源

复核日期：2026-09-24。主计划保留依赖/Actions 版本快照；本轮针对当前锁定代码复核 Node 流/子进程、Java tokenizer、XML、log4js 和 Tauri 命令线程。**P0 旧版基线已有记录，新架构、安装器、兼容性与性能尚未完整验收。** 详细合同见 [执行计划索引](../plan/README.md)。

| 主题 | 来源 | 当前结论 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- | --- |
| 旧脚本语义 | `src/main.js`；`README.md`；`docs/custom-selector.json`；P0-03/P0-04/P0-07 | 以冻结合同及 BD 差异为准，D3 排除未公开 UI 内部；新宿主须复验状态/缓存/回调 | 每次相关改动 | P2 契约与实现前 | P0 已记录，新架构对照待执行 |
| Tauri 必要原生层 | [构建前提](https://v2.tauri.app/start/prerequisites/)、[Node sidecar](https://v2.tauri.app/learn/sidecar-nodejs/) | Tauri 需要 Rust 工具链；Node 可承载业务，不能把 D6 写成 Tauri 完全无 Rust | 每次 Tauri 升级 | P1-00/P1/P5 | 本轮官方文档已复核，业务迁移待实施 |
| Tauri sidecar | [官方文档](https://v2.tauri.app/develop/sidecar/) | 外部二进制命名与目标架构关联；进程树监督仍是本项目责任。P1 以 dev 模式 exe 相对回溯 + env 覆盖定位 guardian 入口；随包 sidecar 定位属 P5 | 每次 CLI 升级 | P1/P2/P5 | P1 开发态握手已实测，随包形态待 P5 |
| UI 权限与 CSP | [Capabilities](https://v2.tauri.app/security/capabilities/)、[CSP](https://v2.tauri.app/security/csp/) | 显式发行能力名单，不向 UI 暴露任意 shell；测试能力与发行隔离 | 每次安全/IPC 变化 | P1/P4/P5 | 文档已复核，配置未实现 |
| Node 脚本边界 | [VM](https://nodejs.org/api/vm.html)、[Permissions](https://nodejs.org/api/permissions.html) | VM/权限模型不等于恶意代码强沙箱；普通故障隔离依赖独立进程和外部监督。D4 已定：可信脚本，不声称防恶意 | 每次 Node 升级 | P2 与安全验收 | 文档已复核，威胁模型已定（D4） |
| 子进程与 IPC | [Node child_process](https://nodejs.org/api/child_process.html)、[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) | kill 不证明树回收，send 回调不证明业务完成；不可信帧需先限长，内置 IPC 回调已晚于反序列化；Windows 原生能力需适配验证 | 每次监督实现变化 | P2/P3/SC11 | 本轮 Node 文档已复核，三平台原型待执行；旧 Tokio 方案不再作为目标实现 |
| Node XML 实现 | [fast-xml-parser 官方仓库](https://github.com/NaturalIntelligence/fast-xml-parser)、锁定 5.11.1 的 OptionsBuilder/fxp.d.ts、[npm 元数据](https://registry.npmjs.org/fast-xml-parser/latest) | validator/parser 接受某些非目标根结构，业务仍需单 root 校验；读取/include 预算与 realpath 判重已补测试，独立 helper 待完成 | 每次依赖升级 | P3-01/02 | 2026-09-24 源码与回归复核；v4 选项页失效，改查锁定源码 |
| 三平台桌面自动化 | [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)、[WDIO Tauri](https://webdriver.io/docs/desktop-testing/tauri/) | embedded provider 可覆盖三平台；测试插件不进入正式包；原生窗口另验。P1-08 已在 win32/x64 用 tauri-driver + msedgedriver 153.0.4234.48（随 WebView2 运行时版本匹配，驱动不进仓库）跑通最小 E2E | 每次 WDIO/Tauri 升级 | P1/P4/P6 | Windows 最小 E2E 通过；Linux/macOS 待 CI |
| Windows 双变体 | [Windows Installer](https://v2.tauri.app/distribute/windows-installer/) | embedBootstrapper 与 offlineInstaller 分开出包并测试复用/缺失/过旧 | 每次运行时/打包升级 | P5 | 文档已复核，安装未验证 |
| 系统 WebView / Linux 包 | [WebView Versions](https://v2.tauri.app/reference/webview-versions/)、[Debian](https://v2.tauri.app/distribute/debian/) | macOS 随系统；Linux 离线自含包/闭包是本项目按发行版实现的设计，非 Tauri 自动保证。D2/D5 已定 | 每次支持矩阵变化 | P5 | 文档已复核，平台矩阵已定（D1/D2/D5） |
| React Aria 树 | [组件源码](https://github.com/adobe/react-spectrum/blob/main/packages/react-aria-components/src/Tree.tsx)、[官方用例](https://github.com/adobe/react-spectrum/blob/main/packages/react-aria-components/stories/Tree.stories.tsx) | 树/虚拟化与旧三态选择需适配和实测；Tree 文档直连本轮失败，使用官方源码/用例核验 | 每次组件升级 | P4 | 来源可用，组合未实测 |
| 流与进程完成边界 | [Node Streams](https://nodejs.org/api/stream.html)、[child_process](https://nodejs.org/api/child_process.html) | write 回调/error/drain 分别处理，close 用于管道收尾；kill 成功不等于清理确认。本轮修复 IPC 异步写错、Java EPIPE/kill false/继承管道等待 | 每次运行器改动 | P2/P3 | 2026-09-24 官方文档与回归通过 |
| Java stdin 分词 | [Java 25 Pattern](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html)、相邻 xresloader `Main.java` | 默认 Pattern 的 ASCII 空白集合不同于 JS Unicode 空白；Scanner 行分隔字符也不能进入单任务行。编码器增加 Unicode 空白/换行用例 | 每次 JAR 升级 | P3-06 | 2026-09-24 源码/文档复核，六格式真实 JAR 通过 |
| log4js 扩展隔离 | [自定义 appender](https://log4js-node.github.io/log4js-node/writing-appenders.html)、`packages/backend/src/service/log-sink*.ts` | configure/append/shutdown 可执行扩展代码，改为独立进程；有界队列与超时明确报告未持久化/清理未确认 | 每次日志实现改动 | P2-08/P3-09 | 2026-09-24 死循环、独立配置与真实文件 flush 通过 |
| Tauri 命令响应性 | [Calling Rust](https://v2.tauri.app/develop/calling-rust/) | 同步 command 默认在主线程；健康检查改为 async + spawn_blocking，避免轮询子进程阻塞 UI | 每次壳命令改动 | P1/P2 | 2026-09-24 回归、原生门禁和真实 WebView2 通过 |

同步范围：本轮更新实现、回归测试、Plan、配置/日志合同、审查记录及索引。已检查 Agent 规则/Skills、旧 Electron、部署/CI；本轮没有需要同步的接口或部署改动，不以原型替代正式入口。
