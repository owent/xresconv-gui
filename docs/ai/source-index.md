# 来源索引（source-index）

记录 AI 配置与技术决策的可追溯来源。易变条目带 `review_cadence` / `update_trigger` / `status`；只记录当前结论，不保存历史版本。

## 项目自身事实

| 主题 | 来源 | 结论 | status |
| --- | --- | --- | --- |
| 包管理器 | `package.json`、`.yarnrc.yml`、`yarn.lock`、工作树状态 | 唯一 JS 锁为 yarn.lock，Cargo.lock 服务 Tauri；2026-09-24 immutable 安装通过，WDIO 既有四项 peer 警告另列于审查记录 | current（Windows 本机） |
| 构建/打包（P7 起新架构） | `scripts/package-{windows,linux,macos}.ts`、`src-tauri/tauri.*.conf.json` | 组装发行布局（单份 Node+闭包）→ tauri 双配置（bootstrap/offline）→ 矩阵命名+SHA-256；旧 Electron/gulp 管线已于 P7 删除 | current |
| 应用图标与 LFS | `docs/brand/app-icon.svg`、`.gitattributes`、`src-tauri/tauri.conf.json`、`.github/workflows/ci.yml` / `release.yml` | SVG 母版生成平台图标与 favicon；受跟踪静态资源及不透明二进制走 LFS，两个构建入口均需获取 LFS 内容 | current（2026-09-24 本地核验） |
| 测试与 lint | [2026-09-27 审查](../plan/records/REVIEW-2026-09-27.md)、[前次审查](../plan/records/REVIEW-P2-P5-2026-09-24.md)、`package.json`、`tests/` | 当前通过数、失败回归、环境与未验证项以本轮审查为准；模块通过不等于跨平台阶段验收 | current（Windows 本机） |
| P0 基线环境 | `docs/plan/records/P0-01.md`、`P0-04.md`、`P0-05.md` | 历史基线用 Yarn 1.22.22 + yarn.lock v1；与当前 Yarn 4 工作树区分。固定组合：OpenJDK 25.0.4.1 + xresloader 2.23.6.jar（sha256 `72fd7655…0caa88`）。记录提示旧 Electron 启动前需移除 `ELECTRON_RUN_AS_NODE=1` | 既有记录，本轮未重跑 |
| 用户脚本沙箱 | `README.md`、[脚本合同](../plan/02-contracts-script-host.md)、`packages/script-host`、`packages/guardian` | 独立 Node worker 承载可信脚本并隔离普通故障；保留 resolve/reject 与弹框回调；不提供 DOM/jQuery/Electron，不声称防恶意沙箱 | current（2026-09-27） |
| AI 配置骨架 | 本次初始化任务 | `AGENTS.md` 主入口 + `CLAUDE.md` 导入层 + `.agents/skills/` + `docs/ai/`；不创建占位目录与工具专属薄层 | current |
| Skill `ai-agent-maintenance` | `.agents/skills/ai-agent-maintenance/` | AI 配置维护流程；标注查询集见 `references/trigger-evaluation.md`，触发率未在 harness 中实测 | 触发评估未实测 |
| Skill `cli-tooling` | `.agents/skills/cli-tooling/` | 现代 CLI 选型/安装/迁移流程；完整对照表在 `references/modern-cli-tools.md`；触发率未在 harness 中实测 | 触发评估未实测 |
| 变更工作流文档 | `docs/ai/spec-driven-workflow.md` | 任务分流细则、OpenSpec/Superpowers 职责边界与 8 步流程、MCP 接入安全规则；仓库当前均未采用 | current（能力未启用） |
| 旧行为合同 | `docs/plan/records/P0-08.md` | 2026-09-24 全量提取：main.js/setup.js 五类脚本入口上下文、转换执行、include 竞态、选择器回退、README 七处分歧；P2/P3 实现的语义基线 | current |
| xresloader stdin 协议 | `../xresloader/src/org/xresloader/core/Main.java:344-411`（本地检出） | tokenizer `('[^']*')\|("[^"]*")\|(\S+)`；空 token 丢弃；无转义；退出码=失败任务数累加。编码器实现见 packages/backend/src/convert/stdin-encoder.ts | current |
| Node 24 类型剥离 | 实测（P2-01/P2-03） | 可直接 spawn 运行 .ts；仅限 erasable 语法（biome noParameterProperties/noEnum 强制）；相对导入必须显式 `.ts` 后缀；workspace 包名导入 .ts 经 symlink 可行 | current |
| 规范复核 | webfetch 核验 agentskills.io specification、skill-creation/best-practices、skill-creation/optimizing-descriptions 与 agents.md（2026-09-25） | Skill frontmatter 字段、渐进式披露、嵌套 AGENTS.md 就近优先与现有配置一致；官方对 `description` 仅要求祈使句式（示例 “Use this skill when…”），本仓库按用户决策统一为 `Use When:` 前缀，兼容官方要求 | current |
| AI 写作与临时文件约定 | 用户决策 2026-09-25；译名调研 [GitHub 中文文档](https://docs.github.com/zh/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)、[Microsoft Learn](https://learn.microsoft.com/zh-cn/azure/key-vault/general/basic-concepts)（2026-09-25，两家官方均用“机密”，本仓库判定为不常用词而弃用）；规则载体 `AGENTS.md` 与 `.agents/skills/ai-agent-maintenance/references/writing-rules.md` | Skill `description` 统一 `Use When:` 前缀；Secret 按具体对象译“密钥/凭据/口令/敏感信息”，不译“秘密”、尽量不用“机密”；fixture 译“测试数据”不译“夹具”；临时文件只放 `build/<task-name>/`，禁止散落其他目录 | current |
| 转表预览冲突用词 | `packages/backend/src/convert/plan-builder.ts`、`packages/backend/src/service/rpc-app.ts`、`apps/desktop/src/app/RunControls.tsx`、用户反馈 2026-09-27 | 转换计划逐条目、逐匹配规则生成任务；同条目同输出类型/目录/重命名规则生成多个任务时提示“重复转换任务”并引导检查输出矩阵。“发射”不适用于此处；规范见写作规则 | current（2026-09-27 本地核验） |
| 旧版“重置”入口 | `v2.6.0:src/index.html:172`、`src/main.js:54-57,2719`、`src/setup.js:220-227`；当前 `apps/desktop/src/app/RunControls.tsx`、`ConversionSettings.tsx`；用户决策 2026-09-27 | 旧按钮触发 Electron 窗口关闭并重建；当前同名按钮未重建 WebView，已从 UI 移除。配置重读用“重载配置”，运行中停止用“取消”；后端 reset RPC 保留清理合同 | current（2026-09-27 本地核验） |

## 重构决策记录（D1–D6，2026-09-23 用户决策）

D1–D5 登记与影响分析见 [P0-06](../plan/records/P0-06.md)；D6 见 [主计划 §2.3](../../Plan.md)。此处只留当前结论，不改写历史基线记录。

| 决策 | 结论 | status |
| --- | --- | --- |
| D1 32 位平台 | 允许删除 Windows ia32、Linux armv7l；新矩阵仅 64 位，旧 2.6.0 发行保留为终点版本 | current |
| D2 Linux 范围与打包 | Ubuntu 22.04/24.04、Debian 12/13、Fedora 最近两个正式版本（2026-09-24 核验 = 43/44，[Fedora 44 于 2026-04-28 发布](https://fedoramagazine.org/announcing-fedora-linux-44/)；P5-01 已固化进 `packaging/targets.json` 与 `packages/packaging/src/baseline.ts`，F45 正式发布后滚动替换 43）；GNOME/KDE、X11/Wayland；offline 优先单一自含包（含 WebKitGTK），P5 原型验证，不可行回退按发行版闭包 | current（自含包可行性待 P5 验证） |
| D3 脚本兼容范围 | 仅承诺文档化公开接口（README + `tests/fixtures/scripts/contract.md`）；DOM/jQuery/Electron/未公开 Fancytree 内部不兼容，检测到给诊断与迁移指引 | current |
| D4 威胁模型 | 可信脚本 + 故障隔离；允许文件/外部进程；边界是故障不得白屏/杀主进程/卡死任务 + IPC 授权；不声称防恶意沙箱 | current |
| D5 macOS 交付 | 系统 WKWebView；系统不足引导升级 macOS；最低系统取 Node/Tauri/前端交集（候选 13.5，P5 复核） | current（最低版本待 P5 复核） |
| D6 实现语言 | 业务、配置、调度、日志和 guardian 采用 TypeScript/Node.js；Tauri 只保留必要 Rust 构建/入口/胶水；用户 JS 继续独立进程隔离 | current（Node 业务/监督层与 Tauri 薄壳已实现至当前切片） |

## 增量审查依据（2026-09-24）

| 主题 | 官方来源与锁定实现 | 当前结论 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- | --- |
| fork 与原生句柄 | [Node child_process](https://nodejs.org/api/child_process.html)、[AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject)、`process-tree.ts` / `backend-supervisor.ts` | Node 参数放 execArgv；原生登记结果需检查；启动/关闭复用完成结果，句柄只能释放一次 | 每次运行器修改 | P2/P3 生命周期变更 | 新增回归及 Windows 真进程通过 |
| Rust 管道与窗口关闭 | [sync_channel](https://doc.rust-lang.org/std/sync/mpsc/fn.sync_channel.html)、[Tauri Window](https://docs.rs/tauri/latest/tauri/window/struct.Window.html)、[Calling Rust](https://v2.tauri.app/develop/calling-rust/) | 有界 writer 把阻塞写移出 RPC 等待路径；deadline 后通道失效；CloseRequested 等待移至后台，清理后 destroy | 每次通道修改 | P4/P5 壳生命周期 | Rust 8 例与真实 WebView2 通过 |
| React 异步快照 | [useEffect](https://react.dev/reference/react/useEffect)、`session-store.ts` 与适配层 | 过期异步结果不能覆盖新会话；配置加载互斥，代际/请求水位与快照去重缓存同时失效 | 每次状态流修改 | P4 RPC/UI 变更 | 6 个新增异步/搜索回归通过 |
| 发行目标与诊断 | [Rust target support](https://doc.rust-lang.org/rustc/platform-support.html)、`packaging/targets.json` / schema | OS/arch 与 triple 必须对应；生成矩阵入口同样验证完整集合；路径遵守 schema 的相对路径说明；疑似密钥只输出脱敏诊断 | 每次目标修改 | P5 目标或清单修改 | 9 个新增边界回归通过 |
| 外部 WebDriver | [官方 service 仓库](https://github.com/webdriverio/desktop-mobile/tree/main/packages/tauri-service)、锁定 `@wdio/tauri-service` 的 `afterCommand` / `ensureActiveWindowFocus` | 显式 switchToWindow 会关闭自动插件焦点探测；本项目 external provider 用原生 WebDriver 选择窗口。普通 protocol 文档页本轮抓取失败，以官方源码及锁定实现核验 | 每次 WDIO 升级 | E2E harness 修改 | 3/3 通过；DEP0190 与退出后 mock 清理告警保留记录 |

## 2026-09-27 审查复核

本轮发现、RED/GREEN 证据及同步清单见 [审查记录](../plan/records/REVIEW-2026-09-27.md)。仅修正当前事实，不把历史通过自动沿用到本轮。

| 主题 | 官方来源 / 本地证据 | 当前结论 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- | --- |
| XML 完整样本 | [sample.xml](https://github.com/xresloader/xresconv-conf/blob/main/sample.xml)、[sample_include.xml](https://github.com/xresloader/xresconv-conf/blob/main/sample_include.xml)、backend config-loader.test.ts | include 样本与冻结测试数据仅差来源注释/本地 include 文件名；包含合并、global、多矩阵、事件均有现存回归；真实项目 14 条目生成 28 文件 | 每次规范变更 | 修改配置解析 | 2026-09-27 已核验 |
| 异步 UI 与虚拟化 | [React Effect](https://react.dev/reference/react/useEffect)、[React Aria Tree](https://react-aria.adobe.com/Tree)、[TanStack Virtualizer](https://tanstack.com/virtual/latest/docs/api/virtualizer) | Effect/请求按代际隔离；稳定 key 与实际行高测量；不能用数组长度判断日志尾部改变 | 每次相关依赖升级 | UI/状态/日志修改 | 2026-09-27 回归与三引擎实测 |
| Node/Java 子进程 | [Node child_process](https://nodejs.org/api/child_process.html)、[Java launcher](https://docs.oracle.com/en/java/javase/24/docs/specs/man/java.html) | Java 诊断和转换共用 executable 优先级；版本只解析 version 行，检查退出码；探测须限输出/限时/回收树 | 每次 Node/JDK 升级 | 启动与诊断修改 | 2026-09-27 单测与真实 JAR 实测 |
| 打包入口与产物 | [Tauri build](https://v2.tauri.app/reference/cli/#build)、[发行文档](https://v2.tauri.app/distribute/)、[Node parseArgs](https://nodejs.org/api/util.html#utilparseargsconfig) | 单一 CLI 实现，验证本机 OS/arch/distro、变体 manifest、当次产物与 SHA-256；组装不等于安装 PASS | 每次 Tauri/Node 升级 | 打包脚本修改 | 2026-09-27 单元/staged 全链及 Windows 双变体实构通过；未执行安装 |
| Edge 应用启动参数 | [EdgeOptions](https://learn.microsoft.com/en-us/microsoft-edge/webdriver/capabilities-edge-options)、本机 tauri-driver 2.0.6 server.rs | 应用参数用 name=value；浏览器开关放 webviewOptions.additionalBrowserArguments。分开的 input/path 导致 CLI 解析返回空对象 | 每次 Edge/driver 升级 | 桌面 E2E 修改 | 2026-09-27 RED/GREEN 实机确认 |
| WebView2 预检 | [运行时分发](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution) | 同时查看 HKLM/HKCU，任一满足即通过；过旧 HKLM 不得遮蔽新 HKCU | 每次 WebView 升级 | 原生预检修改 | 2026-09-27 Rust 回归通过 |
| 原生构建机 | [GitHub runner 标签](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) | macos-15-intel=x64、macos-15=arm64；不能跳过错误架构后仍上传空产物；Ubuntu 两基线不得生成同名离线包 | 每次 runner 镜像变化 | release.yml 修改 | 2026-09-27 文档复核；未触发 CI |
| SPDX 包身份 | [SPDX 2.3 包信息](https://spdx.github.io/spdx-spec/v2.3/package-information/) | 同名不同版本须分别标识；ID 不能因字符折叠冲突；Node 版本、downloadLocation 与 filesAnalyzed 明确记录 | 每次 SPDX/组装变化 | SBOM 修改 | 2026-09-27 回归通过 |
| Agent 指引纠错 | [AGENTS.md](https://agents.md/)、本仓 README/P7/脚本实现 | 删除渲染进程沙箱与 window.jQuery 的过时指引，入口只保留当前隔离边界；CLAUDE 与 Skills 路由无需复制新增规则 | 每次架构变更 | Agent 入口维护 | 2026-09-27 已同步 |

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
| 桌面图标格式与生成 | <https://v2.tauri.app/develop/icons/> | 每次升级 Tauri | 变更图标源或打包配置前 | 2026-09-24 官方文档复核；本机生成验证 |
| Git LFS 与 Actions 检出 | <https://git-lfs.com/>、<https://github.com/actions/checkout/blob/main/README.md> | 半年 | 修改 LFS 文件类型或构建流程前 | 2026-09-24 官方文档复核；CI 待运行 |

## 已知缺口与后续建议

- 当前 P2/P3/P4 与发行布局已有本机复验证据，见 [本轮审查](../plan/records/REVIEW-2026-09-27.md)。未完成：全目标安装/签名、公证与 G5/G6、缺失的发行 CI 目标、Linux preflight 本轮回归；P7 已切换，不再列为待实现。
- Yarn 4 为唯一包管理器；锁文件及动态 require 的真实发行隔离检查见本轮记录。历史包体/CI 成功数字不能替代当前工作树的发行验收。
- 本机环境限制：`yarn` 未全局安装、`npm`/`pnpm` 的 PowerShell shim 被执行策略拦截（用 `npm.cmd` 调用）；CI 中不受影响。
- Markdown 校验：新增/修改的 Markdown 必须通过 markdownlint（配置 `.markdownlint.json`，关闭 MD013 行长与 MD041 以适应 CJK 文本与 `@import` 语法）。既有 `README.md`、`CHANGELOG.md` 存在历史告警（MD029/MD034/MD009/MD012/MD032/MD007），未在本次初始化中改动；如需清理单独提交。
- 校验命令：`npx.cmd --yes markdownlint-cli@latest <files>`（本机无全局 markdownlint）。

## Tauri 重构计划来源

复核日期：2026-09-27。主计划保留依赖/Actions 版本快照；本轮针对锁定实现复核 GUI 状态、虚拟化、Java 诊断、模块闭包、Tauri/Edge 自动化与发行校验。**P0 旧版基线已有记录，新架构、安装器、兼容性与性能尚未完整验收。** 详细合同见 [执行计划索引](../plan/README.md)。

| 主题 | 来源 | 当前结论 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- | --- |
| 旧脚本语义 | `src/main.js`；`README.md`；`docs/custom-selector.json`；P0-03/P0-04/P0-07 | 以冻结合同及 BD 差异为准，D3 排除未公开 UI 内部；新宿主须复验状态/缓存/回调 | 每次相关改动 | P2 契约与实现前 | P0 已记录，新架构对照待执行 |
| Tauri 必要原生层 | [构建前提](https://v2.tauri.app/start/prerequisites/)、[Node sidecar](https://v2.tauri.app/learn/sidecar-nodejs/) | Tauri 需要 Rust 工具链；Node 可承载业务，不能把 D6 写成 Tauri 完全无 Rust | 每次 Tauri 升级 | P1-00/P1/P5 | 官方文档与迁移后的 Node workspaces 已核验 |
| Tauri sidecar | [官方文档](https://v2.tauri.app/develop/sidecar/) | 外部二进制命名与目标架构关联；进程树监督仍是本项目责任。P1 以 dev 模式 exe 相对回溯 + env 覆盖定位 guardian 入口；随包 sidecar 定位属 P5 | 每次 CLI 升级 | P1/P2/P5 | 开发态及 staged 发行全链已实测，安装矩阵另验 |
| UI 权限与 CSP | [Capabilities](https://v2.tauri.app/security/capabilities/)、[CSP](https://v2.tauri.app/security/csp/) | 显式发行能力名单，不向 UI 暴露任意 shell；测试能力与发行隔离 | 每次安全/IPC 变化 | P1/P4/P5 | capabilities/CSP 已实现；变更时继续复核 |
| Node 脚本边界 | [VM](https://nodejs.org/api/vm.html)、[Permissions](https://nodejs.org/api/permissions.html) | VM/权限模型不等于恶意代码强沙箱；普通故障隔离依赖独立进程和外部监督。D4 已定：可信脚本，不声称防恶意 | 每次 Node 升级 | P2 与安全验收 | 文档已复核，威胁模型已定（D4） |
| 子进程与 IPC | [Node child_process](https://nodejs.org/api/child_process.html)、[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) | kill 不证明树回收，send 回调不证明业务完成；不可信帧需先限长，内置 IPC 回调已晚于反序列化；Windows 原生能力需适配验证 | 每次监督实现变化 | P2/P3/SC11 | Node 文档已复核；树回收实现见"进程树监督"行；旧 Tokio 方案不再作为目标实现 |
| 进程树监督 | [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)、[koffi](https://www.npmjs.com/package/koffi)（MIT，Node-API 预编译）、[taskkill](https://learn.microsoft.com/windows-server/administration/windows-commands/taskkill) | Windows 主路径 Job Object + KILL_ON_JOB_CLOSE：guardian 崩溃由内核回收整树；OpenProcess 常驻句柄防 PID 重用；taskkill /T /F 仅作降级回退；POSIX detached 进程组已实现 | 每次监督实现变化 | P2-02 | 2026-09-24 win32 实测通过（terminate 杀树、宿主 SIGKILL 后内核回收）；POSIX 分支待 CI |
| Node XML 实现 | [fast-xml-parser 官方仓库](https://github.com/NaturalIntelligence/fast-xml-parser)、锁定 5.11.1 的 OptionsBuilder/fxp.d.ts、[npm 元数据](https://registry.npmjs.org/fast-xml-parser/latest) | validator/parser 接受某些非目标根结构，业务仍需单 root 校验；读取/include 预算与 realpath 判重已补测试，独立 helper 待完成 | 每次依赖升级 | P3-01/02 | 2026-09-24 源码与回归复核；v4 选项页失效，改查锁定源码 |
| 桌面自动化 | [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)、[官方手动接线示例](https://v2.tauri.app/develop/tests/webdriver/example/webdriverio/)、[原 WDIO 服务资料](https://webdriver.io/docs/desktop-testing/tauri/) | 当前直接管理外部 tauri-driver 与匹配的原生驱动，显式超时/进程树回收；不再依赖 @wdio/tauri-service 的自动下载及 mock 注入 | 每次驱动升级 | 桌面测试入口修改 | 2026-09-27 Windows 12 项通过；Linux/macOS 未在本轮实跑 |
| Windows 双变体 | [Windows Installer](https://v2.tauri.app/distribute/windows-installer/) | embedBootstrapper 与 offlineInstaller 分开出包并测试复用/缺失/过旧 | 每次运行时/打包升级 | P5 | 文档已复核，安装未验证 |
| 系统 WebView / Linux 包 | [WebView Versions](https://v2.tauri.app/reference/webview-versions/)、[Debian](https://v2.tauri.app/distribute/debian/) | macOS 随系统；Linux 离线自含包/闭包是本项目按发行版实现的设计，非 Tauri 自动保证。D2/D5 已定 | 每次支持矩阵变化 | P5 | 文档已复核，平台矩阵已定（D1/D2/D5） |
| React Aria 树 | [组件源码](https://github.com/adobe/react-spectrum/blob/main/packages/react-aria-components/src/Tree.tsx)、[官方用例](https://github.com/adobe/react-spectrum/blob/main/packages/react-aria-components/stories/Tree.stories.tsx) | 树/虚拟化与旧三态选择需适配和实测；Tree 文档直连本轮失败，使用官方源码/用例核验 | 每次组件升级 | P4 | P4-03 三态/搜索已有单测；虚拟化已落地；2026-09-27 三引擎大字号/行点击复验 |
| React Aria 控件可见性（Checkbox/Radio） | 本仓锁定 `node_modules/react-aria-components@1.21.1/dist/private/{Checkbox,RadioGroup,utils}.mjs`（锁定源码核验，升级须重查） | RAC 把 Checkbox/Radio 原生 input 包进 `VisuallyHidden`（绝对定位裁剪，仅可键盘聚焦）；`useRenderProps` 的 `className: computedClassName ?? defaultClassName` 为**替换**而非合并——传自定义 className 会丢默认 `react-aria-Checkbox/Radio` 类。因此可见方框/圆点必须渲染真实子元素（`.checkbox-mark`）并用实际生效类写 CSS；状态挂 label 的 data-selected/data-indeterminate/data-disabled | 每次 RAC 升级 | P4 | 2026-09-26 源码核验；真实 WebView E2E 点击 `.tree-checkbox` 切换勾选 + 浏览器探针（计算样式/包围盒/elementFromPoint）双验证。四轮发现该替换语义同样影响 **Button**（`.react-aria-Button.btn-*` 复合选择器全部失效、主按钮原生灰）——按钮基样式已改元素级 `button{}`；另：`@tauri-apps/api` v2 `isTauri()` 查 `globalThis.isTauri` 标志（非 `__TAURI_INTERNALS__`），mock 桥必须同时设置两者事件订阅才建立 |
| 流与进程完成边界 | [Node Streams](https://nodejs.org/api/stream.html)、[child_process](https://nodejs.org/api/child_process.html) | write 回调/error/drain 分别处理，close 用于管道收尾；kill 成功不等于清理确认。本轮修复 IPC 异步写错、Java EPIPE/kill false/继承管道等待 | 每次运行器改动 | P2/P3 | 2026-09-24 官方文档与回归通过 |
| Java stdin 分词 | [Java 25 Pattern](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html)、相邻 xresloader `Main.java` | 默认 Pattern 的 ASCII 空白集合不同于 JS Unicode 空白；Scanner 行分隔字符也不能进入单任务行。编码器增加 Unicode 空白/换行用例 | 每次 JAR 升级 | P3-06 | 2026-09-24 源码/文档复核，八格式真实 JAR 通过 |
| log4js 扩展隔离 | [自定义 appender](https://log4js-node.github.io/log4js-node/writing-appenders.html)、`packages/backend/src/service/log-sink*.ts` | configure/append/shutdown 可执行扩展代码，改为独立进程；有界队列与超时明确报告未持久化/清理未确认 | 每次日志实现改动 | P2-08/P3-09 | 2026-09-24 死循环、独立配置与真实文件 flush 通过 |
| 前端框架/样式选型 | [React 统计](https://api.npmjs.org/downloads/point/last-week/react)、[Vue 统计](https://api.npmjs.org/downloads/point/last-week/vue)、[Svelte 统计](https://api.npmjs.org/downloads/point/last-week/svelte)、[Tailwind 兼容要求](https://tailwindcss.com/docs/compatibility) | 2026-09-23 快照 React 周下载约为 Vue 11 倍、Svelte 31 倍（含 CI/间接使用，仅作生态体量依据）；选 React 为组件/测试/可访问性生态；Tailwind 4 现代浏览器要求约束系统 WebView，不采用 | 每次框架升级 | P4/P7 | current |
| 依赖版本快照 | 2026-09-23 自 npm registry/crates.io/官方发行页读取；锁定值以 `package.json`/`yarn.lock`/`Cargo.lock` 为准 | 快照为执行起点非永久锁定；Node 26.x Current 候选 + 24.x LTS 基线；Tauri 2.x（3.x alpha 不采用）；typescript-eslint peer 冲突不引入（Biome+tsc）；React Compiler 单独验证后启用 | 每次升级 | P1/P5 复查 | current |
| Tauri 命令响应性 | [Calling Rust](https://v2.tauri.app/develop/calling-rust/) | 同步 command 默认在主线程；健康检查改为 async + spawn_blocking，避免轮询子进程阻塞 UI | 每次壳命令改动 | P1/P2 | 2026-09-24 回归、原生门禁和真实 WebView2 通过 |

同步范围：增量审查更新实现、回归测试、Plan、监督/UI/发行合同与记录索引。本轮已纠正 Agent 入口的旧 Electron 事实；现有 Skills 路由与薄 CLAUDE 层继续适用。跨平台与实体安装验收范围保持。
