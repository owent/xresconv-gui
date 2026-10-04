# 来源索引（source-index）

记录 AI 配置与技术决策的可追溯来源。易变条目带 `review_cadence` / `update_trigger` / `status`；只记录当前结论，不保存历史版本。

## 项目自身事实

| 主题 | 来源 | 结论 | status |
| --- | --- | --- | --- |
| 包管理器 | `package.json`、`.yarnrc.yml`、`yarn.lock`、工作树状态 | 唯一 JS 锁为 yarn.lock，Cargo.lock 服务 Tauri；2026-09-24 immutable 安装通过，WDIO 既有四项 peer 警告另列于审查记录 | current（Windows 本机） |
| 构建/打包（P7 起新架构） | `packages/packaging/src/package-cli.ts`、`.github/workflows/release.yml`、`packaging/targets.json` | 组装单份 Node 发行布局；Windows 用 Tauri 无 bundle 二进制打 7z，Linux 用 AppImage/无 bundle 二进制打 tar.zst，macOS 用 Tauri 打 DMG；产物按矩阵命名并附 SHA-256。旧 Electron/gulp 管线已删除 | current（2026-09-30 源码核验） |
| 应用图标与 LFS | `docs/brand/app-icon.svg`、`.gitattributes`、`src-tauri/tauri.conf.json`、`.github/workflows/ci.yml` / `release.yml` | SVG 母版生成平台图标与 favicon；受跟踪静态资源及不透明二进制走 LFS，两个构建入口均需获取 LFS 内容 | current（2026-09-24 本地核验） |
| 测试与 lint | [P6-06](../plan/records/P6-06.md)、[当前 CI 验收](../plan/records/MACOS-E2E-2026-10-04.md)、`package.json` | d61d639 的 ci/Portable 成功；四个桌面 job 各 13 项通过，含 macOS x64/arm64；根单测 744 通过/20 缺 JAR 或平台跳过，三引擎浏览器 24 通过。测试构建与公开资产分别取证 | current（2026-10-04 核对） |
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
| 运行结束相关用词 | 用户反馈 2026-10-04；`packages/backend/src/domain/run-state.ts`、`packages/backend/src/service/{session,run}.ts`、`apps/desktop/src/app/session-store.ts`、`packages/compat-service/src/tree-model.ts`；[Agent Skills 规范](https://agentskills.io/specification)与[写作建议](https://agentskills.io/skill-creation/best-practices)（本轮复核） | 按对象使用“结束状态”“运行结果”“最终选择状态”，重复状态更新的处理直接说明动作。源码确认 succeeded/failed/cancelled 表示本次运行结束，之后仍可重新加载；transitionSoft 在运行结束后忽略更新。文档、注释、测试名称及测试数据中的说明同步措辞，接口标识符、断言和测试预期保持原意。具体用词按现有[写作规则](../../.agents/skills/ai-agent-maintenance/references/writing-rules.md)维护，Skill 触发边界不变 | current（2026-10-04；review_cadence：随用户反馈；update_trigger：状态、结果或结束范围表述不清） |
| Tauri 桌面层用词 | 用户反馈 2026-09-30；[Tauri 进程模型](https://v2.tauri.app/concept/process-model/)；`src-tauri/`、`packages/backend/`、`packages/guardian/`；[Agent Skills 规范](https://agentskills.io/specification)与[写作建议](https://agentskills.io/skill-creation/best-practices)（2026-09-30 核验） | 现行文档称“Tauri 桌面层”，在架构概述中说明窗口、系统接口、进程启动和消息转发职责；独立 Node.js 进程处理业务。旧称“薄壳”仅在历史记录与术语说明中保留；写作约定见 Skill 按需参考，触发边界不变且未在 harness 中实测 | current（2026-09-30） |
| 研发用语与句式 | 用户反馈 2026-10-04；[晋中学院《复句》教学资料](https://wxy.jzxy.edu.cn/uploads/zwx/file/20180410/3g5np6z83k.pdf)PDF 第 8 页；[兰州大学《高级汉语综合（上）》](https://sice.lzu.edu.cn/HdAtt/att/2017/05/20170522134328597.pdf)复句分类；[Agent Skills 规范](https://agentskills.io/specification)与[写作建议](https://agentskills.io/skill-creation/best-practices)（本轮核验） | 传统分类将否定与肯定的对举列为并列复句；本仓库据用户偏好减少无上下文的否定铺垫，区分并列、递进、因果、条件和纠正。“缺证／证据／门槛”按实际状态、材料与要求展开。具体措辞及少用原则属于本仓库写作约定；[规则](../../.agents/skills/ai-agent-maintenance/references/writing-rules.md)沿用现有参考文件，AGENTS/docs 索引增加入口，Skill 触发边界不变。本轮修订限于叙述措辞，冻结接口、测试预期及历史验收结论保持原意 | current（2026-10-04；review_cadence：随用户反馈；update_trigger：用词造成状态歧义或句式关系误判） |
| 旧版“重置”入口 | `v2.6.0:src/index.html:172`、`src/main.js:54-57,2719`、`src/setup.js:220-227`；当前 `apps/desktop/src/app/RunControls.tsx`、`ConversionSettings.tsx`；用户决策 2026-09-27 | 旧按钮触发 Electron 窗口关闭并重建；当前同名按钮未重建 WebView，已从 UI 移除。配置重读用“重载配置”，运行中停止用“取消”；后端 reset RPC 保留清理合同 | current（2026-09-27 本地核验） |

## 重构决策记录（D1–D6，2026-09-23 用户决策）

D1–D5 登记与影响分析见 [P0-06](../plan/records/P0-06.md)；D6 见 [主计划 §2.3](../../Plan.md)。此处只留当前结论，不改写历史基线记录。

| 决策 | 结论 | status |
| --- | --- | --- |
| D1 32 位平台 | 允许删除 Windows ia32、Linux armv7l；新矩阵仅 64 位，旧 2.6.0 发行保留为终点版本 | current |
| D2 Linux 范围与打包 | 原 per-distro 发行版矩阵（Ubuntu 22.04/24.04、Debian 12/13、Fedora 43/44）由 2026-09-28 用户决策取代：不再输出 deb/rpm，Linux 一律发行版无关 tar.zst（bootstrap 系统 WebKitGTK + offline 自含，AppImage 并存），构建基线收敛 Ubuntu 22.04（glibc 2.35 地板）。运行环境仍覆盖原 D2 发行版集合（WebKitGTK≥2.38） | current（2026-09-28 修订） |
| D3 脚本兼容范围 | 仅承诺文档化公开接口（README + `tests/fixtures/scripts/contract.md`）；DOM/jQuery/Electron/未公开 Fancytree 内部不兼容，检测到给诊断与迁移指引 | current |
| D4 威胁模型 | 可信脚本 + 故障隔离；允许文件/外部进程；边界是故障不得白屏/杀主进程/卡死任务 + IPC 授权；不声称防恶意沙箱 | current |
| D5 macOS 交付 | 系统 WKWebView；最低 macOS 13.5 已写入 targets/tauri 配置并在 macOS 双架构 Portable 校验；低于最低系统引导升级 OS | current（双架构 CI 已验收，本轮额外实机验收由用户撤除） |
| D6 实现语言 | 业务、配置、调度、日志和 guardian 使用 TypeScript/Node.js；Rust 仅 Tauri 桌面层；脚本独立进程。P7 已移除旧实现 | current（实现、自动化及约定本机验收完成） |

## 增量审查依据（2026-09-24）

| 主题 | 官方来源与锁定实现 | 当前结论 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- | --- |
| fork 与原生句柄 | [Node child_process](https://nodejs.org/api/child_process.html)、[AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject)、`process-tree.ts` / `backend-supervisor.ts` | Node 参数放 execArgv；原生登记结果需检查；启动/关闭复用完成结果，句柄只能释放一次 | 每次运行器修改 | P2/P3 生命周期变更 | 新增回归及 Windows 真进程通过 |
| Rust 管道与窗口关闭 | [sync_channel](https://doc.rust-lang.org/std/sync/mpsc/fn.sync_channel.html)、[Tauri Window](https://docs.rs/tauri/latest/tauri/window/struct.Window.html)、[Calling Rust](https://v2.tauri.app/develop/calling-rust/) | 有界 writer 把阻塞写移出 RPC 等待路径；deadline 后通道失效；CloseRequested 等待移至后台，清理后 destroy | 每次通道修改 | P4/P5 桌面层生命周期 | Rust 8 例与真实 WebView2 通过 |
| React 异步快照 | [useEffect](https://react.dev/reference/react/useEffect)、`session-store.ts` 与适配层 | 过期异步结果不能覆盖新会话；配置加载互斥，代际/请求水位与快照去重缓存同时失效 | 每次状态流修改 | P4 RPC/UI 变更 | 6 个新增异步/搜索回归通过 |
| 发行目标与诊断 | [Rust target support](https://doc.rust-lang.org/rustc/platform-support.html)、`packaging/targets.json` / schema | OS/arch 与 triple 必须对应；生成矩阵入口同样验证完整集合；路径遵守 schema 的相对路径说明；疑似密钥只输出脱敏诊断 | 每次目标修改 | P5 目标或清单修改 | 9 个新增边界回归通过 |
| 外部 WebDriver | [官方 service 仓库](https://github.com/webdriverio/desktop-mobile/tree/main/packages/tauri-service)、锁定 `@wdio/tauri-service` 的 `afterCommand` / `ensureActiveWindowFocus` | 显式 switchToWindow 会关闭自动插件焦点探测；本项目 external provider 用原生 WebDriver 选择窗口。普通 protocol 文档页本轮抓取失败，以官方源码及锁定实现核验 | 每次 WDIO 升级 | E2E harness 修改 | 3/3 通过；DEP0190 与退出后 mock 清理告警保留记录 |

## 2026-09-27 审查复核

本轮发现、RED/GREEN 测试结果及同步清单见 [审查记录](../plan/records/REVIEW-2026-09-27.md)。仅修正当前事实，不把历史通过自动沿用到本轮。

| 主题 | 官方来源 / 本地验证记录 | 当前结论 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- | --- |
| XML 完整样本 | [sample.xml](https://github.com/xresloader/xresconv-conf/blob/main/sample.xml)、[sample_include.xml](https://github.com/xresloader/xresconv-conf/blob/main/sample_include.xml)、backend config-loader.test.ts | include 样本与冻结测试数据仅差来源注释/本地 include 文件名；包含合并、global、多矩阵、事件均有现存回归；真实项目 14 条目生成 28 文件 | 每次规范变更 | 修改配置解析 | 2026-09-27 已核验 |
| 异步 UI 与虚拟化 | [React Effect](https://react.dev/reference/react/useEffect)、[React Aria Tree](https://react-aria.adobe.com/Tree)、[TanStack Virtualizer](https://tanstack.com/virtual/latest/docs/api/virtualizer) | Effect/请求按代际隔离；稳定 key 与实际行高测量；不能用数组长度判断日志尾部改变 | 每次相关依赖升级 | UI/状态/日志修改 | 2026-09-27 回归与三引擎实测 |
| Node/Java 子进程 | [Node child_process](https://nodejs.org/api/child_process.html)、[Java launcher](https://docs.oracle.com/en/java/javase/24/docs/specs/man/java.html) | Java 诊断和转换共用 executable 优先级；版本只解析 version 行，检查退出码；探测须限输出/限时/回收树 | 每次 Node/JDK 升级 | 启动与诊断修改 | 2026-09-27 单测与真实 JAR 实测 |
| 打包入口与产物 | [Tauri build](https://v2.tauri.app/reference/cli/#build)、[发行文档](https://v2.tauri.app/distribute/)、[Node parseArgs](https://nodejs.org/api/util.html#utilparseargsconfig) | 单一 CLI 实现，验证本机 OS/arch/distro、变体 manifest、当次产物与 SHA-256；组装不等于安装 PASS | 每次 Tauri/Node 升级 | 打包脚本修改 | 2026-09-27 单元/staged 全链及 Windows 双变体实构通过；未执行安装 |
| Edge 应用启动参数 | [EdgeOptions](https://learn.microsoft.com/en-us/microsoft-edge/webdriver/capabilities-edge-options)、本机 tauri-driver 2.0.6 server.rs | 应用参数用 name=value；浏览器开关放 webviewOptions.additionalBrowserArguments。分开的 input/path 导致 CLI 解析返回空对象 | 每次 Edge/driver 升级 | 桌面 E2E 修改 | 2026-09-27 RED/GREEN 实机确认 |
| WebView2 预检 | [运行时分发](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution) | 同时查看 HKLM/HKCU，任一满足即通过；过旧 HKLM 不得遮蔽新 HKCU | 每次 WebView 升级 | 原生预检修改 | 2026-09-27 Rust 回归通过 |
| Release portable 归档（2026-09-28） | [WebView2 loader 查找顺序](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl)（`browserExecutableFolder` 须显式传入/环境变量覆盖，相邻目录不自动发现）、[Evergreen bootstrapper 短链](https://go.microsoft.com/fwlink/p/?LinkId=2124703)（微软官方文档引用的稳定下载口）、[Fixed Version 分发文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)（随应用再分发为官方支持模式；>250MB；Win10+120 unpackaged 需 AppContainer ACL；不支持 UNC）、官方下载页 developer.microsoft.com/en-us/microsoft-edge/webview2/（HTML 静态内嵌 cab 直链，\u002F 转义，最新两大版本 ×3 架构；同日 curl+HEAD 实证 200/294MB）、zstd 实测（本机 GNU tar 1.35 + zstd 1.5.7 `tar --zstd` 通过；CI Linux apt 安装） | Windows bootstrap 7z 依赖系统 Evergreen + 包内 bootstrapper sidecar（桌面层预检弹窗指引）；Windows **offline 7z 内嵌 Fixed Version**（抓下载页直链下载 cab → expand 解压 → 归档内 `webview2-runtime/`，桌面层**系统 Evergreen 优先、缺失/过旧才回落包内**——`WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` 指向并幂等补 ACL（2026-09-28 追问修订，本机双分支实证）；页面结构变化 fail-closed；压缩优化见下行）；Linux 归档 tar.zst | 每次 WebView2/工具链升级、下载页结构变化 | 打包/发布脚本修改 | 2026-09-28 旧格式实构；2026-09-29 7z 回归已通过 |
| Windows 7z 与语言策略 | [7z 格式](https://7-zip.org/7z.html)、[Windows runner 预装软件](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)、[微软 Fixed Version 分发](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)、[Chromium 语言回退](https://github.com/chromium/chromium/blob/main/ui/base/l10n/l10n_util.cc)、[同负载与完整构建](../plan/records/REVIEW-2026-09-29-ARCHIVE-FORMAT.md) | Windows bootstrap/offline 均以 7z -mx=9 -mmt=2 -ms=on 打包并执行 7z t；独立暂存保留失败前的旧产物。默认完整运行时与语言；mainstream 仍只裁已识别语言资源并保留 en-US/zh-CN 等十语言。目标机需要兼容 7z 的解压工具；旧 zstd 数值仅作历史对照 | 每次 WebView2/7-Zip 升级 | 打包/语言策略变更 | 本机单测/往返通过；2026-10-04 正式矩阵构建及本机双变体验收完成，旧系统实机范围已撤除 |
| Windows 后台子进程窗口 | [Microsoft CREATE_NO_WINDOW](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags)、[Rust CommandExt](https://doc.rust-lang.org/std/os/windows/process/trait.CommandExt.html)、[Node child_process.windowsHide](https://nodejs.org/api/child_process.html)、[发行包复现](../plan/records/REVIEW-2026-09-29-WINDOWS-CONSOLE.md) | GUI-subsystem 桌面程序启动 console-subsystem guardian 时用 `CREATE_NO_WINDOW` 阻止分配控制台；Node 监督范围统一 `windowsHide: true`。保留控制字节管道，避免用户关闭额外窗口触发 EOF；Win32 `GetConsoleWindow` 区分可见窗口与仅存在的 conhost 进程 | 每次 Rust/Node 或打包入口升级 | 进程启动、桌面发行包或 CI 修改 | 2026-09-29 Windows x64 本机实测；跨平台行为由条件分支保持 |
| Windows E2E CI 根因（2026-09-28） | [wry#1782](https://github.com/tauri-apps/wry/issues/1782)、[WebView2Feedback#5645](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5645)、[官方 workflow](https://github.com/tauri-apps/tauri/blob/dev/.github/workflows/test-api-e2e.yml) | 提权宿主的 WebView2 150+ 忽略外部驱动调试参数；Windows 测试用 medium integrity + 工作区写权限。旧“Session 0”诊断已纠正。macOS 当前改用下文嵌入驱动，不再因外部驱动不支持而排除自动测试 | 每次 runner/WebView2 变化 | ci.yml e2e 修改 | d61d639 三平台四个桌面 job 各 13 项通过，见当前 CI 验收 |
| 原生构建机 | [GitHub runner 标签](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) | 标准公共仓库 runner（2026-09-27 文档复核）：x64=ubuntu-22.04/24.04(/26.04)、windows-2022/2025、**macos-15-intel / macos-26-intel**；arm64=**ubuntu-22.04-arm / ubuntu-24.04-arm / ubuntu-26.04-arm**、windows-11-arm、**macos-15 / macos-26 / macos-latest（M1 3 vCPU）**；公共仓库标准 runner 免费。不能跳过错误架构后仍上传空产物；Ubuntu 两基线不得生成同名离线包 | 每次 runner 镜像变化 | release.yml / portable-build.yml 修改 | 2026-09-27 官方文档复核；portable-build 已实跑（见 P5-11） |
| Portable 构建与未签名 macOS | [tauri-bundler v2.11.5 `macos/app.rs`](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle/macos/app.rs)、[`sign.rs keychain()`](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle/macos/sign.rs)、[`appimage/linuxdeploy.rs`](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle/linux/appimage/linuxdeploy.rs)、[linuxdeploy `appdir.cpp`](https://github.com/linuxdeploy/linuxdeploy/blob/master/src/core/appdir.cpp)、[ditto(1)](https://www.unix.com/man-page/osx/1/ditto/) | 无 `signingIdentity` 且无 `APPLE_CERTIFICATE` 时 `keychain()`=Ok(None)，.app 不签名不公证（构建可成功）；"app" bundle 目标产出 `target/release/bundle/macos/<productName>.app`；AppImage 按 `Arch::AArch64` 下载 `linuxdeploy-aarch64.AppImage`/`AppRun-aarch64`（资产已核验 200），bundler 自身设 `APPIMAGE_EXTRACT_AND_RUN=1` 无需 FUSE，`bundleXdgOpen` 默认 true 需构建机有 `/usr/bin/xdg-open`（xdg-utils 包）；**linuxdeploy `deployDependenciesForExistingFiles` 递归扫描 AppDir/usr/lib 下全部 ELF 并 patchelf 改 rpath + strip（`NO_STRIP=1` 只免 strip 不免 patchelf）——随包负载必须经 `bundle.linux.{deb,rpm,appimage}.files` 落位 `/usr/share/<productName>`（usr/lib 之外；且不能落 `/opt`——AppImage 打包仅拷 `data/usr/` 子树），否则 .node/node 二进制被改写致 manifest 逐文件哈希失配（CI/WSL 实证）**；macOS zip 用 `ditto -c -k --sequesterRsrc --keepParent`；Linux portable tar.zst 双形态（bootstrap=系统 WebKitGTK 平铺 tar.zst，offline=AppImage 解包重压自含 tar.zst）命名不带 distro 段 | 每次 Tauri CLI/linuxdeploy 升级 | 打包脚本/工作流修改 | 2026-09-27 按 v2.11.5 tag 与 linuxdeploy master 源码核验；WSL 实测 + CI 实证 |
| SPDX 包身份 | [SPDX 2.3 包信息](https://spdx.github.io/spdx-spec/v2.3/package-information/) | 同名不同版本须分别标识；ID 不能因字符折叠冲突；Node 版本、downloadLocation 与 filesAnalyzed 明确记录 | 每次 SPDX/组装变化 | SBOM 修改 | 2026-09-27 回归通过 |
| Agent 指引纠错 | [AGENTS.md](https://agents.md/)、本仓 README/P7/脚本实现 | 删除渲染进程沙箱与 window.jQuery 的过时指引，入口只保留当前隔离边界；CLAUDE 与 Skills 路由无需复制新增规则 | 每次架构变更 | Agent 入口维护 | 2026-09-27 已同步 |

## 发行审查补充（2026-09-29）

| 主题 | 来源 | 当前结论 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- | --- |
| 归档失败与 7z 完整性 | [7z 格式](https://7-zip.org/7z.html)、[Node spawnSync](https://nodejs.org/api/child_process.html#child_processspawnsynccommand-args-options)、本仓 windows-archive 回归 | 7z 压缩使用独立参数和暂存目录；校验文件头及 7z t 后才替换旧归档；路径、隐藏文件与失败恢复有回归 | 每次工具链升级 | 归档实现变更 | 本机回归与负载逐文件哈希通过；2026-10-04 正式矩阵及新本地双包校验完成，不发布 |
| PowerShell 原生命令退出 | [官方错误偏好](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_preference_variables#psnativecommanduseerroractionpreference)、scripts/ensure-zstd.ps1 | catch 不能代替 LASTEXITCODE；检查探测、修复、复检三个阶段 | 每次 PowerShell/runner 升级 | CI 工具探测变更 | Windows 替身测试通过，未执行安装 |
| Windows 检出与格式门禁 | [Git attributes](https://git-scm.com/docs/gitattributes)、本机 core.autocrlf=true 与 Biome 检查 | 对代码/配置类型显式 text eol=lf，避免检出 CRLF 引发格式告警；保留二进制 LFS 的 -text 规则 | 每次 Git/Biome 配置变化 | 文件类型或格式规则修改 | 本机恢复 LF 后全量 lint 通过，无无关源码内容差异 |
| 其他尺寸优化边界 | [7z 格式](https://7-zip.org/7z.html)、[Node ICU](https://nodejs.org/api/intl.html)、[Cargo profiles](https://doc.rust-lang.org/cargo/reference/profiles.html) | Windows 双变体改用 7z；旧 ZIP 数值仅作历史基线；small-icu 影响用户脚本 Intl，未裁剪；现有 LTO/codegen-units 保持，不破坏签名或删媒体/渲染 DLL | 每次负载与发行策略变化 | 尺寸优化 | 结论及未验证项见本轮记录 |

## 归档压缩与 Action 标签（2026-09-29）

| 主题 | 来源 | 当前结论 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- | --- |
| Linux tar.zst 压缩 | [zstd 1.5.7 参数](https://github.com/facebook/zstd/blob/v1.5.7/programs/zstd.1.md)、[发行规范](../plan/05-packaging-release.md)、[同负载实测](../plan/records/REVIEW-2026-09-29-ARCHIVE-FORMAT.md) | Linux 两变体先落盘 tar，再用 zstd -19 -T2 --long=27 压缩并以 zstd -t 验证；long=27 保持 128 MiB 窗口，无需额外解压参数。AppImage 不经过此步骤；代表性负载级别 3→19 减少 21.43% | 每次 zstd/发行目标升级 | 压缩器与归档格式调整 | 包装模块回归/负载往返通过；2026-10-04 Ubuntu 22.04 构建与 WSL 两变体运行通过 |
| GitHub Action 版本标签 | [GitHub 官方标签用法](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/manage-custom-actions)、[checkout](https://github.com/actions/checkout/releases/tag/v7.0.1)、[setup-node](https://github.com/actions/setup-node/releases/tag/v7.0.0)、[upload-artifact](https://github.com/actions/upload-artifact/releases/tag/v7.0.1)、[download-artifact](https://github.com/actions/download-artifact/releases/tag/v8.0.1)、[stale](https://github.com/actions/stale/releases/tag/v11.0.0)、[rust-cache](https://github.com/Swatinem/rust-cache/releases/tag/v2.9.2)、[upload-to-github-release](https://github.com/xresloader/upload-to-github-release/releases/tag/v1.6.2) | 四个工作流的 uses 全部改为已核验的最新 v 数字发行标签；标签可由维护者移动，升级须复核 action.yml runtime 与 runner 要求 | 每次 Action/runner 升级 | 工作流修改 | 官方 release API/tag 已核验；d61d639 的 CI/Portable/正式矩阵通过，见当前 CI/完整构建记录 |

## Bootstrap Node 体积研究（2026-09-29）

| 主题 | 来源 | 当前结论 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- | --- |
| 同负载压缩 | [研究与样本哈希](../plan/records/RESEARCH-2026-09-29-NODE-SIZE.md)、[7z 格式](https://7-zip.org/7z.html)、[zstd 1.5.7 参数](https://github.com/facebook/zstd/blob/v1.5.7/programs/zstd.1.md)、[Windows tar](https://learn.microsoft.com/en-us/windows/tar/) | 公开 Windows x64 bootstrap ZIP 42.38 MiB，node.exe 的压缩条目占 81.09%；同负载最大 ZIP 39.28、tar.zst 30.35、7z 26.07 MiB，三个输出均与原包 1,243 文件逐项哈希相等；本轮 Windows 本机解压核验已完成，最低系统实机验收按用户指令撤除 | 每次运行时/压缩器升级 | 归档格式或尺寸策略变更 | 旧 ZIP 基线实测；7z 已进入发行配置 |
| 定制 Node | [v24.21.0 configure.py](https://github.com/nodejs/node/blob/v24.21.0/configure.py)、[node.gyp](https://github.com/nodejs/node/blob/v24.21.0/node.gyp)、[vcbuild.bat](https://github.com/nodejs/node/blob/v24.21.0/vcbuild.bat) | 锁定版本支持裁剪 Amaro/SQLite/inspector 和调整缓存/链接优化；用户动态模块、Web Storage、调试及启动性能均需验证。现有包不含 npm/corepack 安装目录；without-ssl 会关闭当前使用的 crypto，v8-lite-mode 关闭 JIT | 每次 Node 升级 | 定制运行时构建 | 选项与当前二进制配置已核验，收益未实构 |
| ICU 精细裁剪 | [Node v24 Intl](https://github.com/nodejs/node/blob/v24.21.0/doc/api/intl.md)、[icu_small.json](https://github.com/nodejs/node/blob/v24.21.0/tools/icu/icu_small.json)、[ICU Data Build Tool](https://unicode-org.github.io/icu/userguide/icu_data/buildtool.html) | small-icu 默认还删除编码转换/断词等数据，不能等同于纯语言裁剪；优先研究 locale filter 并保留其他类别，固定数据版本、保留语言依赖链、验证简体中文/GBK/Unicode/英文回退；预制 dat 可能覆盖过滤配置 | 每次 Node/ICU 升级 | 语言数据裁剪 | 官方机制已核验，定制数据接线未实构 |
| 替代运行时与 SEA | [Bun 兼容性](https://bun.sh/docs/runtime/nodejs-compat)、[Bun 1.4.2](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2)、[Deno Node 兼容性](https://docs.deno.com/runtime/fundamentals/node/)、[Deno 2.9.7](https://github.com/denoland/deno/releases/tag/v2.9.7)、[Node v24 SEA](https://github.com/nodejs/node/blob/v24.21.0/doc/api/single-executable-applications.md) | Windows x64 同参数单 exe 的 zstd 为 Node 24.56、Bun 30.47、Deno 30.75 MiB，直接替换未显示下载量收益；fork/IPC/vm/动态 require/Node-API/无窗口需迁移验收。SEA 仍嵌入 Node，不自动缩小运行时 | 每次候选版本升级 | 运行时替换或单文件化 | 资产压缩已实测，应用兼容性未运行 |

## P6 验收映射（2026-09-30）

| 主题 | 来源 | 当前结论 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- | --- |
| 用例映射审查 | [P6-01 记录](../plan/records/P6-01.md)、[06 册用例表](../plan/06-testing-acceptance.md) | 39 用例族（CF/SC/EX/UI/PK）全部有真实断言实现；14 项子场景缺口补齐；P6-03 100 轮泄漏循环本机通过（无孤儿 worker、句柄零增长）；本机验收补齐，其他环境实机范围按用户指令撤除，见本机验收记录 | 每次 P6 后续任务 | 新增用例族或测试重构 | 本机 Windows x64 范围 |
| UTF-8 拆包与原型污染测试依据 | [StringDecoder](https://nodejs.org/api/string_decoder.html)、[ECMA-262 JSON.Parse](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.parse) | LineBuffer 依赖 StringDecoder 的跨 chunk 多字节缓冲；`JSON.parse` 把 `__proto__` 记为 own property（对象字面量写法则是原型赋值语法，测试须经 JSON 构造该键） | Node 大版本升级 | 帧协议/编码器变更 | 已用例固化（ipc frame、guardian EX02/EX04） |
| 真实转换差分入口 | [转换 fixtures README](../../tests/fixtures/conversion/README.md)、[runtime.mts](../../tests/fixtures/conversion/runtime.mts) | `yarn test:conversion` 落地为统一入口；相邻仓库 target 同名多 JAR（2.23.7 + shaded）时自动解析按"拒绝猜测"退出 2，须显式 `XRESCONV_TEST_JAR`；本轮显式指定后八格式全 MATCH | JAR/样本升级 | target 目录 JAR 数量变化 | 实测通过 |
| P6-05 性能测量口径 | [P6-05 记录](../plan/records/P6-05.md) | 三项指标达标：bootstrap -81.1%、吞吐 132.7%、p95 7–55ms；启动 1737ms/进程树 676MB 为记录项（D6 架构代价）。测量脚本 quirks：RAC 按压需 PointerEvent 序列（el.click() 不触发）；真实浏览器 RAC 虚拟化树无 role="tree" 容器（jsdom 有，测试层与真实 DOM 差异）；Playwright 浏览器二进制随版本漂移需镜像重装（`PLAYWRIGHT_DOWNLOAD_HOST=npmmirror`） | Playwright/RAC 升级 | 交互测量或浏览器层失败排查 | 本机 Windows x64 实测 |

## 2026-09-30 提交审查

| 主题 | 来源 | 当前结论 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- | --- |
| 工作目录派发检查 | `packages/backend/src/service/run.ts`、[本轮回归](../plan/records/REVIEW-2026-09-30.md) | 运行前区分缺失、非目录和读取失败；普通文件不得进入 Java 派发。回归先复现错误成功态，再验证失败计数与诊断 | 每次转换编排变更 | work_dir 解析或 Java 派发修改 | 本机回归通过 |
| Windows SID 生命周期 | [ConvertStringSidToSidW](https://learn.microsoft.com/en-us/windows/win32/api/sddl/nf-sddl-convertstringsidtosidw)、[SetNamedSecurityInfoW](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setnamedsecurityinfow) | 转换出的 SID 必须用 `LocalFree` 释放；设置目录 DACL 时可将可继承 ACE 传播至现有子项。预检已补正常与部分失败路径释放 | 每次 Windows ACL 代码变更 | WebView2 预检修改 | Rust Windows fmt/test/clippy 通过；离线 VM 实机验收已按用户指令撤除 |
| Agent 入口与发行说明 | [AGENTS.md 规范](https://agents.md/)、`AGENTS.md`、`README.md`、`.github/workflows/release.yml` | Agent 入口只保留当前平台打包路径；用户文档区分发行 CI 当前构建子集、便携归档与 macOS 系统 WKWebView | 每次发行策略变化 | 打包工作流或 AI 入口修改 | 2026-09-30 同步 |

## 2026-10-03 发布事实与计划收敛

| 主题 | 来源 | 当前结论 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- | --- |
| 第一轮 Release | [dev.0 API](https://api.github.com/repos/owent/xresconv-gui/releases/tags/v3.0.0-dev.0)、[tag 对象](https://api.github.com/repos/owent/xresconv-gui/git/tags/a9b483e91a700a8e6ebcf3d57b76cbcd0626b976)、用户 2026-10-03 确认 | 公开预发布、非 draft；tag 指向 990e5d2；9 产物/9 边车；用户首轮验证完成，逐平台日志未提供。Windows 实际发布仍是 ZIP/tar.zst | 每轮候选 | tag/资产/验收反馈变化 | 已核对 API，未本轮下载资产重算 |
| 基底 gate 实跑 | [首轮 release](https://github.com/owent/xresconv-gui/actions/runs/36526010267)、[基底 ci](https://github.com/owent/xresconv-gui/actions/runs/36715370160)、[基底 portable](https://github.com/owent/xresconv-gui/actions/runs/36715369942)、[完整核对记录](../plan/records/RELEASE-2026-10-03.md) | 基底 6b65026 的质量/Windows-Linux 桌面、macOS-Linux 双架构校验通过；读了 job/step 与聚合日志（9 release/8 portable）。不覆盖后续提交/实机矩阵 | 每轮候选 | workflow/提交/产物变化 | 2026-10-03 API/job 日志核对 |
| dev.1 AppImage 依赖 | [ci](https://github.com/owent/xresconv-gui/actions/runs/37126017957)、[portable](https://github.com/owent/xresconv-gui/actions/runs/37126018018)、[失败 release](https://github.com/owent/xresconv-gui/actions/runs/37126038390)、[Tauri 2.11.5 bundler](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle/linux/appimage/linuxdeploy.rs#L130)、[修复记录](../plan/records/CI-FIX-2026-10-03.md)、[5909542 收尾](../plan/records/ACCEPTANCE-2026-10-04.md) | 9967c38 的 release ARM64 缺 /usr/bin/xdg-open，同提交 Portable 正常；两个 AppImage 入口显式安装并检查 xdg-utils，不依赖 runner 预装。后续构建记录按提交登记 | 每次 Tauri/runner 升级 | Linux 打包依赖或工作流变化 | 5909542 release 双架构及 12 产物聚合成功；d61d639 Portable 8 产物成功 |
| 当前桌面 E2E 驱动与截止 | [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)、[WDIO 插件](https://webdriver.io/docs/desktop-testing/tauri/plugin-setup/)、[WDIO waitUntil](https://webdriver.io/docs/api/browser/waitUntil/)、`tests/desktop/{run,wdio.conf,readiness,interactions}.mjs`、[当前 CI 验收](../plan/records/MACOS-E2E-2026-10-04.md) | Windows/Linux 外部 tauri-driver 2.1.0；macOS debug e2e 的可选 Rust 嵌入驱动 1.4.0，无业务 mock。该版本需测试层完整 PointerEvent 序列驱动 React Aria 标签。建连 120 秒/重试 2，单项 60 秒/每轮 5 分钟；标题等待 30 秒/100ms，错误仍失败。测试构建不覆盖公开介质/OS 对话框 | 每次 WDIO/Tauri/runner 升级 | 桌面测试流程或超时配置变化 | d61d639 四个桌面 job 各 13 项通过；6 harness 单元通过；06 册与索引矛盾已纠正 |
| IPC 大快照预算 | `packages/ipc/src/index.ts`、`src-tauri/src/guardian.rs`、`packages/guardian/bin/service.mjs`、[02 册](../plan/02-contracts-script-host.md) | 当前默认帧 64 MiB、guardian 出站积压 128 MiB；P4-08 已上调以支持 100k 快照，旧 1/8 MiB 文档已纠正 | 每次 IPC 修改 | 帧/队列预算变化 | 2026-10-03 源码核对 |
| Release API 语义 | [GitHub releases API](https://docs.github.com/en/rest/releases/releases)、[公开 release 列表](https://api.github.com/repos/owent/xresconv-gui/releases?per_page=10) | draft/prerelease/资产 size/digest 分别取证，annotated tag 解引用得到 commit；API digest 与本轮独立下载 hash 明确区分 | 每次 API 变化 | 发行核对流程修改 | 官方文档/API 已核验 |
| 文档维护入口 | [AGENTS.md](https://agents.md/)、`AGENTS.md`、[计划索引](../plan/README.md)、[完成范围](../plan/08-release-follow-up.md) | 稳定约束放入口、具体约定按需加载、已完成过程进 records；活动状态单处维护。避免旧任务/旧介质/历史版本快照覆盖当前事实 | 每次计划维护 | 发布或阶段完成 | 2026-10-04 R5/R11/R12 归档，证书与额外实机范围由用户撤除；活动任务为零，现有 AGENTS/Skills/CLAUDE 路由适用 |

## 2026-10-03～04 桌面 CI、缓存与 macOS 发布合同

| 主题 | 来源 | 当前结论 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- | --- |
| 651ea5e 三次 CI | [第二次执行](https://github.com/owent/xresconv-gui/actions/runs/37130846883/attempts/2)、[Windows 失败](https://github.com/owent/xresconv-gui/actions/runs/37130846883/job/111231872190)、[第三次执行](https://github.com/owent/xresconv-gui/actions/runs/37130846883/attempts/3)、[本轮记录](../plan/records/CI-E2E-2026-10-03.md) | 前两次 Windows 会话已建立但首个标题为空，后续握手/UI 通过；第一次 Linux Yarn fetch 取消时崩溃。第三次四 job 成功用于竞态对照；新修复须由对应提交的 CI 单独验证 | 每轮候选 | 桌面/安装失败或 runner 变化 | API/三次 job 日志核对；原始日志保留 build/ci-e2e-20261003 |
| Yarn 4.18.1 取消修复 | [官方发行](https://github.com/yarnpkg/berry/releases/tag/%40yarnpkg%2Fcli%2F4.18.1)、[官方 #7249](https://github.com/yarnpkg/berry/pull/7249) | 补丁为 got 增加 promiseSettled 防止已结束 promise 再触发取消处理；与本轮 onCancel 异常匹配。升级 packageManager，不降低 TLS/immutable；网络错误仍可能发生 | 每次 Yarn 升级 | fetch 取消异常或包管理器变化 | 已核对发行/API/补丁；Windows 及 Linux 容器实际使用 4.18.1，后者网络重置正常失败而未发生原取消崩溃 |
| Yarn archive 缓存 | [cacheFolder/enableGlobalCache/enableMirror](https://yarnpkg.com/configuration/yarnrc)、[4.18.1 Cache.ts](https://github.com/yarnpkg/berry/blob/%40yarnpkg%2Fcli%2F4.18.1/packages/yarnpkg-core/sources/Cache.ts)、[cache v6.1.0](https://github.com/actions/cache/blob/v6.1.0/README.md)、[restore metadata](https://github.com/actions/cache/blob/v6.1.0/restore/action.yml)、[composite action](https://docs.github.com/en/actions/tutorials/create-actions/create-a-composite-action) | 关闭 global cache 才会使用声明 cacheFolder；restore/install/save 路径统一，安装成功立即保存，始终 immutable。enableMirror 会影响 archive 文件名，隔离全局镜像验证使用新的 globalFolder，保留默认 mirror 配置 | 每次 Yarn/cache Action 升级 | 缓存路径、键或安装入口改变 | 668 archives 禁网/隔离镜像通过；d61d639 四个桌面 job 均精确命中并恢复，link/build 正常执行，见当前 CI 验收 |
| Rust workspace 与工具缓存 | [rust-cache 2.9.2 配置](https://github.com/Swatinem/rust-cache/blob/v2.9.2/src/config.ts#L141)、[action.yml](https://github.com/Swatinem/rust-cache/blob/v2.9.2/action.yml)、根 Cargo.toml | 当前目标目录为根 target，指定 src-tauri 会缓存错误位置；统一 `. -> target`，用途 key 分离；cache-bin 默认 true，桌面启用 cache-on-failure 并固定 tauri-driver 2.1.0 | 每次 workspace/缓存 Action 升级 | Cargo 目录或桌面工具变更 | d61d639 Windows/Linux 恢复前次缓存成功（Cargo.lock 变化，full match=false）；Mac 新桌面用途冷缓存上传至 100%，后续命中未观察，见当前 CI 验收 |
| macOS 发布去重 | [系统 WKWebView](https://v2.tauri.app/reference/webview-versions/)、targets.json、matrix.ts、[收尾记录](../plan/records/ACCEPTANCE-2026-10-04.md)、用户授权 | 正式仅每架构 bootstrap DMG；12 可构建目标→10 发行目标/12 产物，Portable 保持 8；已有公开资产不删除 | 每轮发行 | 运行时/发布集合变化 | 5909542 原生双架构构建及全量 12 集合通过，dev.1 公开保留旧 offline 资产 |

## dev.1 收尾来源（2026-10-04）

| 主题 | 来源 | 当前结论 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- | --- |
| 发布资产一致性 | [GitHub assets API](https://docs.github.com/en/rest/releases/assets)、[dev.1](https://github.com/owent/xresconv-gui/releases/tag/v3.0.0-dev.1)、[上传日志](https://github.com/owent/xresconv-gui/actions/runs/37138276258)、收尾记录 | tag=5909542；现存 14 产物，Windows/macOS x64 bootstrap 内嵌提交=651ea5e。overwrite:false 跳过全部旧同名文件；上传前后比较集合及 sha256:digest，公开版完全一致时只读结束，否则失败 | 每个 tag/资产变化 | 发布入口修改或复用 tag | API/两包下载/边车/manifest 已核实；5 回归通过，公开资产未修改 |
| 测试驱动隔离 | [官方 standalone](https://github.com/webdriverio/desktop-mobile/tree/main/packages/tauri-plugin-webdriver)、[crate 1.4.0](https://crates.io/crates/tauri-plugin-wdio-webdriver/1.4.0)、src-tauri feature/compile_error、[当前 CI 验收](../plan/records/MACOS-E2E-2026-10-04.md) | 插件自带 localhost HTTP，无 Tauri 命令，default 权限为空；standalone 无需额外前端/能力表改动。只显式 debug e2e，生产依赖树不包含插件/axum，release + e2e 必须失败 | 插件版本/feature 变化 | 测试或打包修改 | Windows Cargo/13 项与 release 拒绝实测；d61d639 Mac 双架构 debug 各 13 项、默认生产 Portable 构建/校验通过 |
| 本轮验收范围与完整介质 | 用户 2026-10-04 指令、[GitHub 手动工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)、[当前完整构建](https://github.com/owent/xresconv-gui/actions/runs/37185211013)、[最终核对](../plan/records/COMPLETION-2026-10-04.md) | R6 证书签名、公证/stapling、Gatekeeper 验收撤除，不记作通过；I11 编号不复用，PK08 保留摘要/许可证/生产隔离。workflow_dispatch 只构建 Actions 产物，不写 Release；实机范围另行核对 | 每轮候选 | 用户范围或最终介质变化 | d61d639 的 8 构建、12 产物及边车校验成功，Release 聚合 skipped；Windows 正式 bootstrap 13 项、Windows/WSL 真实 JAR 差分及各 9 项隔离/循环通过 |
| 本机验收完成与工具修复 | 用户本轮实机范围指令、[本机验收](../plan/records/LOCAL-ACCEPTANCE-2026-10-04.md)、[Tauri 原生对话框](https://v2.tauri.app/plugin/dialog/)、[Corepack packageManager](https://github.com/nodejs/corepack#usage)、[URL origin](https://url.spec.whatwg.org/#dom-url-origin) | Windows/WSL 两变体的生产包、原生打开/保存/取消及子树清理通过；仅未执行的 BACKEND_NOT_READY 允许配置加载重试；AppRun 偏好按 usr/bin 实际 GUI 位置隔离；工具链版本读取 packageManager，同源测试比较实际 origin | 每轮候选 | 启动/打包/测试路径或用户范围变化 | R5 完成；新本地包标记 95d0246 工作树 dirty，其他环境实机与证书验收撤除，不发布 |
| 原生窗口验收边界 | [UI Automation](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/obtaining-ui-automation-elements)、[窗口 PID](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowthreadprocessid)、[消息与 UIPI](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagew)、[BM_CLICK](https://learn.microsoft.com/en-us/windows/win32/controls/bm-click)、[最终核对](../plan/records/COMPLETION-2026-10-04.md) | 只操作本轮所属窗口；消息送达须与前端实际回写分别断言，隐藏窗口回调不证明可见原生交互。非活动对话框的 BM_CLICK 可能失败，不外推产品根因 | 原生驱动/窗口策略变化 | UI08 原生对话框验收 | 首轮失败诊断保留；Windows/WSL 两变体可见打开/选择回写/保存/取消已通过，见本机验收；ARM64 仅静态核验，运行免验 |

## 外部规范（易变，需定期复核）

| 主题 | 来源 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- |
| AGENTS.md 规范 | <https://agents.md/> | 季度 | 创建/修改 AGENTS.md 前 | 2026-10-04 官方复核；单一入口与就近规则不变 |
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
| Git LFS 与 Actions 检出 | <https://git-lfs.com/>、<https://github.com/actions/checkout/blob/main/README.md>、[当前 CI/Portable](../plan/records/RELEASE-2026-10-03.md) | 半年 | 修改 LFS 文件类型或构建流程前 | 构建入口已实跑，资源变更需重验；规范原复核 2026-09-24 |

## 已知缺口与后续建议

- dev.0 首轮与 dev.1 发布已核实；已下载的 Windows/macOS x64 bootstrap 包内 sourceCommit 为 651ea5e、旧 14 产物残留，见 [发布核对](../plan/records/ACCEPTANCE-2026-10-04.md)。当前 d61d639 的 ci/Portable 及四个桌面 job 各 13 项通过，见 [CI 验收](../plan/records/MACOS-E2E-2026-10-04.md)；R11 已归档，环境项唯一维护于 [08 册](../plan/08-release-follow-up.md)，不将测试构建/ARM64 免验等同全矩阵实机通过。
- Yarn 4 为唯一包管理器；锁文件及动态 require 的真实发行隔离检查见本轮记录。历史包体/CI 成功数字不能替代当前工作树的发行验收。
- 本机环境限制：`yarn` 未全局安装、`npm`/`pnpm` 的 PowerShell shim 被执行策略拦截（用 `npm.cmd` 调用）；CI 中不受影响。
- Markdown 校验：新增/修改的 Markdown 必须通过 markdownlint（配置 `.markdownlint.json`，关闭 MD013 行长与 MD041 以适应 CJK 文本与 `@import` 语法）。既有 `README.md`、`CHANGELOG.md` 存在历史告警（MD029/MD034/MD009/MD012/MD032/MD007），未在本次初始化中改动；如需清理单独提交。
- 校验命令：`npx.cmd --yes markdownlint-cli@latest <files>`（本机无全局 markdownlint）。

## Tauri 重构计划来源

当前计划收敛复核日期：2026-10-04。主计划只保留稳定目标/边界/功能/摘要，选型来源留在本索引，原始版本与通过范围由 records 保留；模块约定见 [执行索引](../plan/README.md)。**当前执行计划在用户确认的 Windows/WSL 本机范围内全部完成，活动任务为零；其他环境实机及证书验收登记为范围撤除。** 新本地工作树包与既有远端 CI 分别记录，见 [本机验收](../plan/records/LOCAL-ACCEPTANCE-2026-10-04.md)。下表按具体条目来源和日期使用，不把历史快照当当前 latest。

| 主题 | 来源 | 当前结论 | review_cadence | update_trigger | status |
| --- | --- | --- | --- | --- | --- |
| 旧脚本语义 | 旧 v2.6.0 `src/main.js`；`README.md`；`docs/custom-selector.json`；P0-03/P0-04/P0-07 | 以冻结合同及 BD 差异为准，D3 排除未公开 UI 内部；新宿主须复验状态/缓存/回调 | 每次相关改动 | P2 契约与实现前 | P0/P2 对照已完成，历史原始观察见 records |
| Tauri 必要原生层 | [构建前提](https://v2.tauri.app/start/prerequisites/)、[Node sidecar](https://v2.tauri.app/learn/sidecar-nodejs/) | Tauri 需要 Rust 工具链；Node 可承载业务，不能把 D6 写成 Tauri 完全无 Rust | 每次 Tauri 升级 | P1-00/P1/P5 | 官方文档与迁移后的 Node workspaces 已核验 |
| Tauri sidecar | [官方文档](https://v2.tauri.app/develop/sidecar/) | 外部二进制命名与目标架构关联；进程树监督仍是本项目责任。P1 以 dev 模式 exe 相对回溯 + env 覆盖定位 guardian 入口；随包 sidecar 定位属 P5 | 每次 CLI 升级 | P1/P2/P5 | 开发态及 staged 发行全链已实测，安装矩阵另验 |
| UI 权限与 CSP | [Capabilities](https://v2.tauri.app/security/capabilities/)、[CSP](https://v2.tauri.app/security/csp/) | 显式发行能力名单，不向 UI 暴露任意 shell；测试能力与发行隔离 | 每次安全/IPC 变化 | P1/P4/P5 | capabilities/CSP 已实现；变更时继续复核 |
| Node 脚本边界 | [VM](https://nodejs.org/api/vm.html)、[Permissions](https://nodejs.org/api/permissions.html) | VM/权限模型不等于恶意代码强沙箱；普通故障隔离依赖独立进程和外部监督。D4 已定：可信脚本，不声称防恶意 | 每次 Node 升级 | P2 与安全验收 | 文档已复核，威胁模型已定（D4） |
| 子进程与 IPC | [Node child_process](https://nodejs.org/api/child_process.html)、[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) | kill 不证明树回收，send 回调不证明业务完成；不可信帧需先限长，内置 IPC 回调已晚于反序列化；Windows 原生能力需适配验证 | 每次监督实现变化 | P2/P3/SC11 | Node 文档已复核；树回收实现见"进程树监督"行；旧 Tokio 方案不再作为目标实现 |
| 进程树监督 | [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)、[koffi](https://www.npmjs.com/package/koffi)（MIT，Node-API 预编译）、[taskkill](https://learn.microsoft.com/windows-server/administration/windows-commands/taskkill) | Windows 主路径 Job Object + KILL_ON_JOB_CLOSE：guardian 崩溃由内核回收整树；OpenProcess 常驻句柄防 PID 重用；taskkill /T /F 仅作降级回退；POSIX detached 进程组已实现 | 每次监督实现变化 | P2-02 | Windows 实测见 P2-02；d61d639 Linux process-tree/backend-supervision 适用项通过，Windows 专属项保留跳过，见当前 CI 验收 |
| Node XML 实现 | [fast-xml-parser 官方仓库](https://github.com/NaturalIntelligence/fast-xml-parser)、[npm 元数据](https://registry.npmjs.org/fast-xml-parser/latest)、`packages/backend/src/config/loader.ts` / `isolated-loader.ts`、[P6-05](../plan/records/P6-05.md) | 单 root/严格 UTF-8/XML、realpath/include；64/128 MiB 读取预算。加载入口使用独立 helper、30 秒外部截止及节点/脚本预算；解析器深度明确保持锁定版本默认 100 | 每次依赖升级 | 配置解析/预算修改 | Windows/WSL 门禁见执行记录；d61d639 Linux CI 的 8 项 config-isolation 回归通过，见当前 CI 验收 |
| Windows 双变体 | [WebView2 运行时分发](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)、`packages/packaging/src/package-cli.ts`、`src-tauri/src/webview_preflight.rs` | 当前发行是 bootstrap/offline 7z；前者附 Evergreen 安装器供用户手动运行，后者内嵌 Fixed Version 且系统 Evergreen 优先。旧 NSIS 配置是历史方案，不参与当前发行 CLI | 每次 WebView2/打包升级 | 归档与预检变更 | 源码策略与本机两变体运行已核验；旧 Windows/离线 VM 实机验收按用户指令撤除 |
| 系统 WebView / Linux 包 | [WebView Versions](https://v2.tauri.app/reference/webview-versions/)、[Debian](https://v2.tauri.app/distribute/debian/) | macOS 随系统；Linux 离线自含包/闭包是本项目按发行版实现的设计，非 Tauri 自动保证。D2/D5 已定 | 每次支持矩阵变化 | P5 | 文档已复核，平台矩阵已定（D1/D2/D5） |
| React Aria 树 | [组件源码](https://github.com/adobe/react-spectrum/blob/main/packages/react-aria-components/src/Tree.tsx)、[官方用例](https://github.com/adobe/react-spectrum/blob/main/packages/react-aria-components/stories/Tree.stories.tsx) | 树/虚拟化与旧三态选择需适配和实测；Tree 文档直连本轮失败，使用官方源码/用例核验 | 每次组件升级 | P4 | P4-03 三态/搜索已有单测；虚拟化已落地；2026-09-27 三引擎大字号/行点击复验 |
| React Aria 控件可见性（Checkbox/Radio） | 本仓锁定 `node_modules/react-aria-components@1.21.1/dist/private/{Checkbox,RadioGroup,utils}.mjs`（锁定源码核验，升级须重查） | RAC 把 Checkbox/Radio 原生 input 包进 `VisuallyHidden`（绝对定位裁剪，仅可键盘聚焦）；`useRenderProps` 的 `className: computedClassName ?? defaultClassName` 为**替换**而非合并——传自定义 className 会丢默认 `react-aria-Checkbox/Radio` 类。因此可见方框/圆点必须渲染真实子元素（`.checkbox-mark`）并用实际生效类写 CSS；状态挂 label 的 data-selected/data-indeterminate/data-disabled | 每次 RAC 升级 | P4 | 2026-09-26 源码核验；真实 WebView E2E 点击 `.tree-checkbox` 切换勾选 + 浏览器探针（计算样式/包围盒/elementFromPoint）双验证。四轮发现该替换语义同样影响 **Button**（`.react-aria-Button.btn-*` 复合选择器全部失效、主按钮原生灰）——按钮基样式已改元素级 `button{}`；另：`@tauri-apps/api` v2 `isTauri()` 查 `globalThis.isTauri` 标志（非 `__TAURI_INTERNALS__`），mock 桥必须同时设置两者事件订阅才建立 |
| 流与进程完成边界 | [Node Streams](https://nodejs.org/api/stream.html)、[child_process](https://nodejs.org/api/child_process.html) | write 回调/error/drain 分别处理，close 用于管道收尾；kill 成功不等于清理确认。本轮修复 IPC 异步写错、Java EPIPE/kill false/继承管道等待 | 每次运行器改动 | P2/P3 | 2026-09-24 官方文档与回归通过 |
| Java stdin 分词 | [Java 25 Pattern](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html)、相邻 xresloader `Main.java` | 默认 Pattern 的 ASCII 空白集合不同于 JS Unicode 空白；Scanner 行分隔字符也不能进入单任务行。编码器增加 Unicode 空白/换行用例 | 每次 JAR 升级 | P3-06 | 2026-09-24 源码/文档复核，八格式真实 JAR 通过 |
| log4js 扩展隔离 | [自定义 appender](https://log4js-node.github.io/log4js-node/writing-appenders.html)、`packages/backend/src/service/log-sink*.ts` | configure/append/shutdown 可执行扩展代码，改为独立进程；有界队列与超时明确报告未持久化/清理未确认 | 每次日志实现改动 | P2-08/P3-09 | 2026-09-24 死循环、独立配置与真实文件 flush 通过 |
| 前端框架/样式选型 | [React 统计](https://api.npmjs.org/downloads/point/last-week/react)、[Vue 统计](https://api.npmjs.org/downloads/point/last-week/vue)、[Svelte 统计](https://api.npmjs.org/downloads/point/last-week/svelte)、[Tailwind 兼容要求](https://tailwindcss.com/docs/compatibility) | 2026-09-23 快照 React 周下载约为 Vue 11 倍、Svelte 31 倍（含 CI/间接使用，仅作生态体量依据）；选 React 为组件/测试/可访问性生态；Tailwind 4 现代浏览器要求约束系统 WebView，不采用 | 每次框架升级 | P4/P7 | current |
| 依赖版本快照 | 2026-09-23 官方 registry/release 调研；锁定值以 `package.json`/`yarn.lock`/`Cargo.lock` 为准；随包目标以 `packaging/targets.json` 为准 | 历史 Current 候选不等于随包目标，当前 targets 为 Node 24；Tauri 2.x；Biome+tsc。发行冻结前重查稳定 release/engines/peer/MSRV，不声称本轮升级了依赖 | 每次升级 | 工具链/发行冻结 | 2026-10-03 源码目标核对；latest 未重查 |
| Tauri 命令响应性 | [Calling Rust](https://v2.tauri.app/develop/calling-rust/) | 同步 command 默认在主线程；健康检查改为 async + spawn_blocking，避免轮询子进程阻塞 UI | 每次 Tauri 桌面层命令改动 | P1/P2 | 2026-09-24 回归、原生门禁和真实 WebView2 通过 |

同步范围：增量审查更新实现、回归测试、Plan、监督/UI/发行合同与记录索引。本轮已纠正 Agent 入口的旧 Electron 事实；现有 Skills 路由与薄 CLAUDE 层继续适用。平台支持声明保留；当前实机范围按用户确认的 Windows/WSL 执行，其他环境撤除。

## 本地收尾调研（2026-10-03）

| 用途 | 来源 | 当前结论 | review_cadence / update_trigger | status |
| --- | --- | --- | --- | --- |
| XML 解析 helper | [Node child_process](https://nodejs.org/api/child_process.html)、锁定 `fast-xml-parser@5.11.1` 的 `OptionsBuilder.js` / `OrderedObjParser.js` | 异步 spawn 保持父进程响应；以 close 与所属子树回收确认完成；通过现有 ProcessScope 设置 Windows 无窗口/POSIX 进程组。parser 原有 maxNestedTags=100，显式保持并以 CONFIG_LIMIT 报告 | Node/parser/监督实现升级 | 已核对官方文档与锁定源码；真实进程回归通过 |
| Windows ARM64 交叉编译 | [Tauri Windows ARM 构建](https://v2.tauri.app/distribute/windows-installer/#building-for-32-bit-or-arm)、[PE 格式](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format) | x64 Windows 安装 ARM64 C++ 库与 Rust 目标后用 --target=aarch64-pc-windows-msvc；打包显式 --cross；PE 机器类型检验不执行目标程序 | 工具链/目标变化 | 本机具备 ARM64 C++ 库；运行验证按用户免验 |
| 交叉包 Node/原生模块 | [Node 官方校验和](https://nodejs.org/dist/v24.21.0/SHASUMS256.txt)、[Yarn supportedArchitectures](https://yarnpkg.com/configuration/yarnrc#supportedArchitectures)、[Linux ELF 机器类型](https://github.com/torvalds/linux/blob/master/include/uapi/linux/elf-em.h)、[Apple Mach 机器类型](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/mach/machine.h) | 下载与宿主同版本的官方目标 Node/headers，核验归档 SHA-256，从 headers 取得 ABI；不执行目标 Node。Yarn 同时安装 x64/arm64 optional 模块，发行闭包按目标筛选并验证二进制头 | Node/Yarn/原生模块升级 | Windows/Linux ARM64 五个产物已生成；10 个本地产物及边车集合/hash 通过 |
| WSL Linux 构建环境 | [Podman build](https://docs.podman.io/en/latest/markdown/podman-build.1.html)、[Podman run --init](https://docs.podman.io/en/latest/markdown/podman-run.1.html#init)、[Rust 安装](https://rust-lang.org/tools/install/)、[Ubuntu 镜像说明](https://mirrors.tuna.tsinghua.edu.cn/help/ubuntu/) | 发行构建保持 Ubuntu 22.04/glibc 2.35，WSL Debian 验证。权限用例须普通用户；JVM 原生文件名需 UTF-8 locale；容器需 init 回收强杀孤儿。WSL NTFS 限 2 worker；缓存挂载读取实际 CARGO_HOME，不能猜路径 | 构建环境/基线变化 | Linux 731/10、x64 三包校验及双变体桌面各 13 项通过；本轮不发布 |
| ARM AppImage 与 binfmt 诊断 | [Tauri CLI 2.11.5 linuxdeploy 源码](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.11.5/crates/tauri-bundler/src/bundle/linux/appimage/linuxdeploy.rs)、[内核匹配规则](https://docs.kernel.org/admin-guide/binfmt-misc.html)、本轮 ELF 头与 strace | Debian QEMU 规则要求 ELF 填充区为零，ARM AppImage 的 AI2 标记导致 ENOEXEC；Tauri 只清主 linuxdeploy 的三字节。采用临时精确 ARM AI2 规则，完成后移除。完整 ARM 用户空间解决宿主 ldd/GTK 插件误选架构；备份不可留在插件扫描目录 | Tauri/linuxdeploy/QEMU 升级 | ARM 离线双产物已生成；临时规则与 bind 已清理，WSLInterop 保留；只运行打包工具 |
| Windows ARM runner 工具 | [Windows 11 ARM64 软件清单](https://github.com/actions/runner-images/blob/main/images/windows/Windows11-Arm64-Readme.md) | 20260927.180.1 镜像列出 Node 24.21.0、Rust/Cargo 1.98.1、7-Zip 26.03 与 Visual Studio 2026；release matrix 使用 windows-11-arm，实际 job 结果见完整构建记录，不由软件清单推导 | runner 镜像升级 | 官方清单已核对；d61d639 正式矩阵构建结果另见完整构建记录 |
| macOS 原生模块静态合同 | [Koffi darwin-x64 3.3.1 元数据](https://registry.npmjs.org/@koromix/koffi-darwin-x64/3.3.1)、[darwin-arm64 元数据](https://registry.npmjs.org/@koromix/koffi-darwin-arm64/3.3.1) | 官方发布包经 dist.integrity 核验；两 .node 均为对应架构的薄 Mach-O 64，满足新增二进制头校验；仅静态读取，不运行 macOS 代码 | Koffi/二进制校验升级 | 双架构头已核验；不构成 macOS 应用构建或运行通过 |
| ARM AppImage 打包限制 | [Tauri AppImage](https://tauri.app/distribute/appimage/)、[QEMU user mode](https://www.qemu.org/docs/master/user/main.html)、[内核 binfmt_misc](https://docs.kernel.org/admin-guide/binfmt-misc.html) | linuxdeploy 不支持直接交叉打 ARM AppImage，须 ARM 主机或模拟器。Rust 程序交叉编译后使用 QEMU 完成 ARM 打包工具阶段；F 标志支持容器挂载空间。ARM64 应用运行验收按用户免验 | Tauri/linuxdeploy/QEMU 升级 | 官方限制已核对；WSL 架构注册生效，Windows 互操作保留 |
| Windows ARM64 CRT 来源 | [Microsoft C++ ARM64 安装](https://learn.microsoft.com/en-us/cpp/build/arm64-windows-abi-conventions)、本机 Visual Studio 官方 `catalog.json` 与已校验组件下载元数据 | 仅存在 arm64 目录不证明有 CRT；本机缺 libcmt.lib，按官方目录下载 ARM64 Desktop CRT，校验目录 SHA-256 并解包到 build，不修改全局 VS。显式选择 MSVC linker 与 ARM64 SDK/CRT LIB | MSVC/SDK 更新 | Windows ARM64 实际链接与双变体打包通过 |
| 全矩阵候选构建与发布边界 | [GitHub runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[手动 workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)、[收尾记录](../plan/records/ACCEPTANCE-2026-10-04.md)、release.yml | 12 可构建目标→10 发行目标/12 产物；手动或 build/validate-* 仅构建，写 release 只接受 v3 tag。5909542 的全量聚合成功；已发布 dev.1 的 14 产物仍属旧集合，资产身份单独核对 | Actions/矩阵/资产变化或候选冻结 | 已核对三 workflow/标签/API/下载包，2026-10-04 |

## 计划精简时迁入的设计来源

以下来源从已精简的主计划/分册迁入，供历史设计追溯；本轮未重新验证这些外部版本或链接，不作为当前 latest 证明。当前采用状态由源码/现行条目确定。

| 用途 | 保留来源 | status |
| --- | --- | --- |
| 旧配置样本链接（当前替代为 main/sample.xml，见 XML 完整样本条目） | <https://github.com/xresloader/xresconv-conf/blob/master/sample.xml> | 历史来源迁移，2026-10-03 |
| React 客户端选型 | <https://react.dev/learn/build-a-react-app-from-scratch> | 历史来源迁移，2026-10-03 |
| Tauri Vite 接入 | <https://v2.tauri.app/start/frontend/vite/> | 历史来源迁移，2026-10-03 |
| Node 官方版本清单 | <https://nodejs.org/dist/index.json> | 历史来源迁移，2026-10-03 |
| 旧 Electron 原生模块 ABI 对照，不作为当前 Node ABI 约定 | <https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules> | 历史来源迁移，2026-10-03 |
| 历史 Node 26 候选支持平台，不作为当前 Node 24 目标清单 | <https://github.com/nodejs/node/blob/v26.x/BUILDING.md> | 历史来源迁移，2026-10-03 |
| Actions 固定依赖安全建议；当前版本标签策略另列归档决策 | <https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions> | 历史来源迁移，2026-10-03 |
| Tauri Action 历史选型资料 | <https://github.com/tauri-apps/tauri-action/releases> | 历史来源迁移，2026-10-03 |
| Rust toolchain Action 历史选型资料 | <https://github.com/dtolnay/rust-toolchain> | 历史来源迁移，2026-10-03 |
