# AGENTS.md

面向 AI 编程 Agent 的项目规则入口。AI 配置维护细节见 [ai-agent-maintenance Skill](.agents/skills/ai-agent-maintenance/SKILL.md)。

## 项目目标与边界

xresconv-gui 是符合 xresconv-conf 规范、以 xresloader 为后端的 GUI 批量转表工具。Tauri 2 桌面层管理窗口、系统接口、进程启动和消息转发，React/TypeScript 提供界面，独立 Node.js workspaces 承担业务。支持 Windows、Linux、macOS 的 x64/ARM64，平台边界以 [packaging/targets.json](packaging/targets.json) 为准。

本仓库负责 GUI、业务进程和打包，外部转换规范属于 xresconv-conf / xresloader。架构和接口从[开发索引](docs/development/README.md)按任务读取。

## 任务启动与实现

- 先读本文件、[Skills 索引](.agents/skills/README.md)、[来源索引](docs/ai/source-index.md)和相关目录列表，按入口加载细节。
- 先核对 git status / diff，保留用户已有改动。确认 harness 实际工具、Skills 和权限。
- 框架、依赖、工具、平台和安全决策先核对当前官方资料，资料不足标注未验证；依据写入来源索引。
- 小型文案和格式改动走最短验证路径；缺陷先定位并增加失败回归测试，再最小修复。
- 新功能、行为、公开接口、数据、安全或部署变更先形成可审阅的需求与设计合同，按已有用户授权实施。流程见[变更工作流](docs/ai/spec-driven-workflow.md)。
- 不做无关重构，不复制冗余规则。用户/开发文档和注释只保留现行约定，来源与引用随内容迁移。CHANGELOG.md 保留完整发布历史，新版本变化追加到顶部。

## 技术栈与命令

Node.js >=24；Yarn 4 由根 packageManager 固定；Rust 工具链由 rust-toolchain.toml 固定。Yarn 是唯一 JS 包管理器，仅维护 yarn.lock；Cargo.lock 服务桌面层。

| 操作 | 命令 |
| --- | --- |
| 依赖 | `corepack yarn install --immutable` |
| 开发 / 构建 | `corepack yarn dev:desktop` / `corepack yarn build:desktop` |
| JS 与文档检查 | `corepack yarn lint` / `corepack yarn typecheck` |
| 单元 / 契约 | `corepack yarn test:unit` / `corepack yarn test:contracts` |
| Rust | `corepack yarn check:shell` / `corepack yarn test:shell` |
| 浏览器 / 桌面 | `corepack yarn test:browser` / `corepack yarn test:desktop` |
| 真实转换 | `corepack yarn test:conversion` |
| 发行 | `corepack yarn package:windows` / `package:linux` / `package:macos` |

环境、命令参数及检查边界见[测试](docs/development/testing.md)和[打包](docs/development/packaging.md)。Windows 驱动通过 Windows 风格路径的 MSEDGEDRIVER_PATH / TAURI_DRIVER_PATH 提供；多个候选 JAR 时必须显式设置 XRESCONV_TEST_JAR。

## 非显而易见的约束

- 用户脚本可信，可访问模块和进程，故障隔离不能防恶意代码。保持 resolve/reject、弹框回调及树镜像约定，脚本不获得 DOM/jQuery/Electron。见[脚本接口](docs/user/scripts.md)。
- GUI、配置和脚本文件统一 UTF-8，Windows 默认代码页可能为 GBK。
- JSON Schema 在 packages/contracts/schema 维护，生成目录的类型与注释只通过生成命令更新，批量整理时排除该目录。修改后生成类型并运行契约测试。
- Rust 测试引用模块避免 tauri/wry 运行时类型，事件用注入闭包；测试 exe 缺 SxS manifest，运行时 Drop glue 可能引入 comctl32 v6 符号并导致 0xc0000139。
- Windows guardian 使用 CREATE_NO_WINDOW，受监督子进程使用 ProcessScope.decorateSpawnOptions 的 windowsHide。检查窗口和选项，不能只数 conhost。
- 嵌入 WebDriver 只允许 debug e2e，release + e2e 编译拒绝。测试构建不能代替公开介质或原生系统对话框验证。
- 跨架构打包显式 --cross --arch，Node 和原生模块必须属于目标架构。静态检查、构建、安装和运行分别报告。
- Windows 使用 7z；Linux 先 tar 后外部 zstd，校验真实负载再发布。语言裁剪默认关闭，显式 mainstream 后复验固定运行时版本。

## 终端与工具约定

Windows 使用 PowerShell 7+（pwsh.exe），禁止 Windows PowerShell 5.1，不嵌套 cmd、Git Bash、WSL 等 shell。独立 pwsh 使用 -NoLogo -NoProfile，无人值守加 -NonInteractive。

优先 rg 搜索、现代 CLI，再用 PowerShell 原生命令，避免 cat/find/where/ps/sort/curl/wget 等模糊别名。工具选型与安装按 [cli-tooling Skill](.agents/skills/cli-tooling/SKILL.md)。搜索限流、排除 node_modules、build 和工具工作树；管道输出关闭颜色与分页，结构化数据用 jq/yq。

无需展开时用单引号，正则置于单引号，多行文本用 here-string。语句块管道用 `& { ... } | ...`，原生命令参数用数组 splatting，避免 shell 字符串插值。共享文本写入显式 UTF-8，不重用 HOME/CODEX_HOME 等系统变量。

原生命令检查 LASTEXITCODE，rg 无匹配的退出码 1 属正常；关键 cmdlet 使用 ErrorAction Stop。npm/npx 受执行策略影响时用 .cmd shim，项目依赖仍使用 Yarn。

普通检查限时 10–20 分钟，构建/打包 20–30 分钟，桌面按 runner 截止。超时先定位下载、挂起、资源或命令问题，最多调整后重试 2–3 次。需要口令时由用户在终端输入，Agent 不读取密钥。

## 验证、文档和临时文件

新增功能补单元测试，缺陷补回归测试，不能跳过失败后宣称通过。Markdown 使用仓库 markdownlint 零告警，文档链接检查同步验证。图示优先 Mermaid，检查语法和引用。

临时脚本、报告和调试产物只放 `build/<task-name>`，结束清理。需要保留时说明用途。本地开发资源放 development，密钥放忽略提交的 development/secret，不写入日志或模型上下文。需要环境变量且没有模板时提供 .env.example 占位符。

文档、注释和回复使用自然具体的研发用语，按需读取[写作规则](.agents/skills/ai-agent-maintenance/references/writing-rules.md)。结束前核对受影响的用户/开发文档、来源、测试、部署和 Agent 配置，确保内容与引用有效。反复出现的问题修正对应约定或测试，避免重复规则。

AGENTS.md 为共享入口，CLAUDE.md 只导入共享规则并写差异。新增工具层前核验官方资料，仓库未采用的工具不能声称已使用。
