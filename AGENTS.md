# AGENTS.md

面向 AI 编程 Agent 的项目级规则入口。只记录高信号、不易从源码直接推断的事实。AI 配置维护（本文件、Skills、工具专属层）的详细规则见 Skill `.agents/skills/ai-agent-maintenance/`。

## 项目目标与边界

- xresconv-gui：符合 [xresconv-conf](https://github.com/xresloader/xresconv-conf) 规范的 GUI 批量转表工具，以 [xresloader](https://github.com/xresloader/xresloader) 为后端。
- 基于 Electron，支持 Windows / Linux / macOS。
- 本仓库只包含 GUI 壳与打包逻辑；转表协议变更属于 xresconv-conf / xresloader 仓库。

## 不可违反的原则

- **先调研，后方案，再实施**：涉及技术选型、框架用法、Agent 规范、部署方式或工具兼容性的决策，必须先查最新官方文档；资料不足标注“未验证”，不猜测、不编造。
- **不抹除来源**：更新内容保留或迁移引用来源；来源失效时记录替代来源。来源写入 `docs/ai/source-index.md`。
- **不复制冗余**：`AGENTS.md` 是跨工具主入口；工具专属文件只在确有必要时作为薄兼容层创建，避免规则漂移。
- **不保留历史版本**：规则与 Skills 只保留当前最佳版本，历史解释进决策记录或来源索引。
- **可验证优先**：新功能必须有测试；缺陷修复必须补回归测试；能用 lint/类型检查/测试验证的不靠人工判断。
- **最小上下文成本**：默认加载只放稳定、高信号、常用事实；长流程、示例、来源细节放按需加载文件并写明何时读取。每次维护时删除过时、重复、可从源码推断的内容。
- **入口索引优先**：任务启动只读入口文件、索引、目录列表；只有任务目标或索引明确指向时才读细节。
- **原生能力优先**：开始任务先确认当前 harness 实际提供的 Skills、工具、权限；不把其他工具的能力当内置能力。
- **流程强度与风险匹配**：小改动走最短可验证路径；新功能、行为变更、公开 API、数据模型、安全或部署变更必须先形成可审阅的需求与设计合同。
- **现代工具优先与 shell 纪律**：见“终端与工具约定”。

## 调研与实时更新流程

每次任务开始时执行：

1. 只读入口与索引：`AGENTS.md`、`.agents/skills/README.md`、`docs/ai/source-index.md`、相关目录列表；工具专属目录只判断是否存在，不批量读取。
2. 判断任务依赖的外部事实（语言生态、框架版本、Agent 规范、MCP、部署平台、安全要求），查最新官方文档/规范/SDK/release；社区讨论只作补充。
3. 关键来源链接与最新结论写入 `docs/ai/source-index.md`；易变信息标记 `review_cadence`、`update_trigger`、`status`，只记录当前结论。
4. 形成可执行方案：选项、取舍理由、风险、回滚方式、验证方式；获得足够事实后再实施。发现事实变化时先更新方案和规则，再改代码。
5. 结束前刷新同步清单：Agent 规则、Skills、文档、部署配置、路线图、测试、来源索引。

## 技术栈与命令

- Node.js LTS（>=24）+ Electron 44 + gulp 5 + `@electron/packager`。入口 `src/setup.js`（主进程），`src/main.js` + `src/index.html`（渲染进程）。新架构（Tauri 2 薄壳 + Node/TS workspaces）见 `Plan.md` 与 `docs/plan/`。
- 包管理器：**Yarn 4（corepack，`packageManager: yarn@4.18.0`）为唯一 JS 包管理器**；`package-lock.json`、`pnpm-lock.yaml` 已删除（P1-02），唯一 JS 锁文件为 `yarn.lock`，`Cargo.lock` 仅服务 Tauri 薄壳。安装用 `corepack yarn install`，变更依赖时只更新 `yarn.lock`。
- 常用命令：
  - 安装依赖：`yarn install`（`prepare` 钩子会执行 `node scripts/patch-fancytree.js && gulp copy-libs`）
  - 启动：`yarn run start`；调试模式：`yarn run debug-start`；VSCode Attach：`yarn run debug`（端口 5858）
  - 打包：`yarn run package-test`（当前平台）、`package-win32` / `package-linux` / `package-darwin` / `package-all`，产物在 `out/`
- 新架构（Tauri 薄壳 + Node workspaces，见 `Plan.md`）已有质量入口：`yarn lint`、`yarn typecheck`、`yarn test:unit`、`yarn test:contracts`、`yarn test:browser`（Playwright 三引擎浏览器层，生产构建 preview；浏览器经 `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/` 安装）、`yarn test:desktop`（桌面 E2E，需 tauri-driver + 匹配 WebView2 版本的 msedgedriver，经 `MSEDGEDRIVER_PATH`/`TAURI_DRIVER_PATH`（Windows 风格路径）注入）、`yarn check:shell` / `yarn test:shell`（Cargo 薄壳）。发行打包：`yarn package:windows|linux|macos`（组装发行布局 → tauri 双配置 → 矩阵命名 + SHA-256；macOS 须在 mac 主机）。旧 Electron 命令保留至 P7 交接；旧架构验证手段为 `yarn run package-test` 打包成功 + 手动冒烟。选型依据见 `docs/ai/source-index.md` 与 `docs/plan/`。

## 目录结构

- `apps/desktop/`、`packages/{backend,guardian,contracts,ipc,script-host,compat-service,packaging}/`、`src-tauri/`、`tests/`：新架构骨架（D6，P1 已验收本机范围，见 `docs/plan/records/`）

- `src/`：应用源码（`setup.js` 主进程、`main.js` 渲染进程、`index.html`、`main.css`、`log4js.json` 日志配置）
- `scripts/patch-fancytree.js`：安装后修补 jquery.fancytree 的脚本（`prepare` 钩子调用）
- `gulpfile.js`：运行、调试与打包任务
- `docs/`：文档截图、图标、自定义选择器示例 `custom-selector.json`
- `.github/workflows/`：CI（build.yml 三平台构建并上传 release；release.yml；stale.yml）
- `.agents/skills/`：跨工具 Agent Skills（索引见 `.agents/skills/README.md`）
- `docs/ai/`：来源索引、工具清单等 AI 维护资料

## 非显而易见的约束

- 用户自定义脚本（事件 `set_name` / `on_before_convert` / `on_after_convert` / `script` / `on_append_log`）在渲染进程沙箱中执行，未捕获异常会导致 GUI 白屏——这是已知限制，修改相关代码时不得破坏 `resolve()`/`reject()` 的约定（见 README“已知问题”）。
- GUI 与文件编码统一 UTF-8；Windows 默认 GBK，文件名建议全英文（见 README“注意事项”）。
- 渲染进程里部分 npm 库不会自动挂到全局，需手动 `window.jQuery = require(...)`（见 README“关于加载和调试”）。
- macOS 打包必须 `asar = false`（asar 包在 macOS 下无法读取，`gulpfile.js` 已处理，不要改回）。
- src-tauri 中被 `#[cfg(test)]` 测试引用的模块不得触碰 tauri/wry 运行时类型（如 `AppHandle`/`Emitter`）：测试 exe 无 SxS manifest，经 Drop glue 保留 wry 对话框代码会导入 comctl32 v6 专有符号，进程加载即 0xc0000139。事件出口用注入闭包（P4-02 `EventSink`，诊断工具 `build/tools/check-imports.mjs`）。

## 任务分流

| 任务类型 | 默认流程 |
| --- | --- |
| 文案、注释、格式、边界清楚的单文件小改动 | 读取就近规则，最小改动，运行对应检查 |
| 缺陷诊断和修复 | 先复现定位根因，再写失败的回归测试，最小修复并验证原始症状消失 |
| 新功能、行为变更、跨模块重构、公开 API、数据模型、安全或部署变更 | 先形成可审阅的需求与设计合同（本仓库暂无 OpenSpec，用 issue/ADR/文档载体），获批准后再实现 |
| 需求不清或多架构方向 | 只读探索，逐个澄清问题，比较 2–3 个方案，分段确认设计后再动手 |

- 实现纪律：RED-GREEN-REFACTOR（先失败测试，再最小实现，后重构）；发现设计不成立时先更新权威合同再改代码。
- 本仓库未采用 OpenSpec、未安装 Superpowers、未接入 MCP，不得擅自安装或声称使用了对应工作流；如团队决定采用，先按官方文档初始化并更新 `docs/ai/source-index.md`。完整的 OpenSpec/Superpowers 职责边界、OpenSpec 新功能 8 步流程、MCP 接入安全规则见 `docs/ai/spec-driven-workflow.md`（高风险变更或接入外部系统前必读）。

## 终端与工具约定

### Shell 纪律（Windows）

- 一律使用 PowerShell 7+（`pwsh.exe`）；**禁止** Windows PowerShell 5.1（默认 UTF-16LE 写文件、缺 `&&`/`||`、传参有已知缺陷）。
- 不嵌套调用 `cmd.exe`、Git Bash、WSL 或其他 shell。独立进程用 `pwsh.exe -NoLogo -NoProfile`（无人值守加 `-NonInteractive`），多行脚本可用 `-Command -` 从 stdin 读取。
- 本机 `npm`/`pnpm` 的 `.ps1` shim 被执行策略拦截，调用时用 `npm.cmd` / `npx.cmd`。
- 命令选择顺序：现代 CLI 工具 → PowerShell 原生 cmdlet → 传统工具。避免含义不明确的别名（`cat`、`find`、`where`、`ps`、`sort`、`curl`、`wget`）；写入仓库的 `.ps1` 脚本一律用全名 cmdlet。
- 引用与文本：无需变量展开用单引号；双引号内用反引号转义；正则放单引号内；多行文本用 here-string（`@' ... '@`，定界符独占一行、结尾顶格），不用 Bash heredoc。
- 管道与传参：语句块输出接管道用 `& { ... } | ...` 包裹；向 .exe 传含空格/引号的参数用数组 splatting；`--%` 停止解析符仅对原生命令有效。
- 编码：写跨工具共享文件显式 `-Encoding utf8`；原生命令输出乱码时先设 `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`，不换 shell。
- 错误处理：原生命令后用 `$LASTEXITCODE -ne 0` 判断；关键 cmdlet 加 `-ErrorAction Stop` 并 `try/catch`；失败先查命令名、路径、引号、退出码，定位根因再修。

### 现代 CLI 工具

- 探测可用后优先：`rg`（搜索）、`fd`（找文件）、`bat`（读文件）、`sd`（替换）、`eza`（列表）、`jq`/`yq`（结构化数据）、`dust`、`duf`、`tokei`、`fzf --filter`、`xh` 等；缺失时回退传统工具。完整对照表、安装渠道与平台差异见 Skill `.agents/skills/cli-tooling/`（工具选型、安装或迁移存量脚本时加载）。
- 环境受限最小套装：`rg`、`fd`、`sd`、`jq`（+`yq`）、`bat`。
- 使用守则：管道捕获时确保干净输出（`--color=never`、`--paging=never`、`NO_COLOR=1`）；优先 `--json` 结构化输出 + `jq -r` 取字段，不用正则解析人类排版；保持非交互；搜索与遍历必须限流（`rg --max-count`、`-g '!node_modules'`、`fd --max-results`）；注意 `rg`/`grep` 退出码 1 表示无匹配而非错误。

### 命令超时与重试

- 常规 lint/typecheck/单测上限 10–20 分钟；构建/打包 20–30 分钟；e2e 按项目说明延长。
- 超时后保留输出，分析是依赖下载、死锁、挂起、资源不足还是命令错误；最多重试 2–3 次，每次必须调整命令、环境、等待时间或并发度，不盲目重复。
- 脚本和 Skill 中的命令必须支持非交互；需要口令/token 时让用户在终端直接输入，AI 不得获取密钥。

## 测试、lint 与质量门禁

- 新增功能必须补单元测试（外部依赖补 mock 测试）；缺陷修复必须补回归测试。
- 不得跳过失败测试；确需跳过必须记录原因、风险、负责人和恢复条件。
- 新增/修改的 Markdown 必须通过 markdownlint 零告警：`npx.cmd --yes markdownlint-cli@latest <files>`（配置 `.markdownlint.json`）。既有 `README.md`/`CHANGELOG.md` 的历史告警不在本次范围。
- 架构图优先 Mermaid/Chart.js/Draw.io，尽量验证语法和布局。

## 临时文件与密钥

- **临时文件只允许放 `build/` 目录，禁止随意乱放**：本地调试产物、临时脚本、一次性输出一律写入 `build/<task-name>/` 子目录，不得散落在仓库根目录、`docs/`、`src/`、`tests/`、用户主目录或系统临时目录；任务结束清理，需保留的产物必须有说明和索引。
- 本地开发临时资源放 `development/`；本地密钥放 `development/secret/` 并确保不被提交。
- 密钥、token 不进仓库、不进日志、不发 AI 接口；密钥值只能通过 `jq`/`yq` 在脚本中提取透传。
- 需要环境变量而仓库没有 `.env` 时，创建带占位符的 `.env.example` 并说明需用户填真实值。
- 打包产物 `out/` 与 `node_modules/` 已在 `.gitignore`，不要提交。

## 文档、路线图与执行计划

每次任务结束前判断是否需更新：`AGENTS.md`、`CLAUDE.md`、`.agents/skills/`、自定义 Agent/prompt/workflow、`docs/` 模块文档、`docs/ai/source-index.md`、部署配置、`roadmap/`（存在时）、测试说明与故障排查文档。

文档组织要求：

- 不把所有内容堆到单个文档；按模块、组件、主题建立层级目录。
- 每个目录应有 `README.md` 索引，说明文件用途和阅读顺序。
- 架构、数据流、部署和复杂流程应使用图示（优先 Mermaid/Chart.js/Draw.io）。
- 变更文档时同步更新交叉引用，避免死链。

## 自我改进机制

出现纠错、返工、遗漏、误判或测试失败时：

1. 判断根因：信息不足、规则缺失、Skill 误触发/漏触发、文档过期、测试缺失还是实现错误。
2. 同类问题可能复发时，更新最合适的位置（`AGENTS.md`、Skill、条件化规则、docs、测试），合并去重，不留多版本。
3. 为修复过的问题补测试或验证脚本。
4. 在 `docs/ai/source-index.md` 写明变更依据。

## 任务完成前检查清单

- [ ] 调研基于最新来源并已记录；能力边界已确认，未伪造 harness 能力。
- [ ] 方案说明了取舍、风险、验证方式；流程强度与任务风险匹配。
- [ ] 最小必要改动，无无关重构；测试/回归测试已补。
- [ ] 已运行必要的 lint、test、build 验证；Markdown 过 markdownlint。
- [ ] 终端命令遵守 pwsh 7+ 与现代工具纪律。
- [ ] 已检查是否需要更新 `AGENTS.md`、`CLAUDE.md`、Skills、docs、来源索引。
- [ ] 临时文件只写入过 `build/<task-name>/` 且已清理，无散落在其他目录；未泄露任何密钥。
- [ ] 已记录后续风险和未完成事项。

## 按需加载

- 用户脚本接口、启动参数、自定义选择器 JSON 结构：查 `README.md` 对应小节。
- 现代 CLI 完整工具清单、安装渠道与平台差异：Skill `.agents/skills/cli-tooling/references/modern-cli-tools.md`（需要选型、安装或迁移工具时读）。
- 高风险变更完整工作流（OpenSpec/Superpowers）与 MCP 接入安全规则：`docs/ai/spec-driven-workflow.md`。
- 外部调研结论、工具兼容性、已知缺口：`docs/ai/source-index.md`。
- AI 配置维护流程（改 AGENTS.md/CLAUDE.md/Skills/工具专属层时必读）：Skill `.agents/skills/ai-agent-maintenance/`。
