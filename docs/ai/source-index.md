# 技术来源

本索引只记录当前约定的来源。实现细节以链接的源码和 Schema 为准；外部资料提供平台或接口依据，不能由官方文档推导本项目已经运行通过。

## 产品与运行时

| 主题 | 官方来源 | 当前约定 | review_cadence / update_trigger / status |
| --- | --- | --- | --- |
| XML 配置 | [xresconv-conf](https://github.com/xresloader/xresconv-conf)、[sample.xml](https://github.com/xresloader/xresconv-conf/blob/main/sample.xml) | 用户配置与脚本定义按上游规范，GUI 解析见 backend/config | 协议变更时 / 配置字段变化 / current |
| 转换协议 | [xresloader](https://github.com/xresloader/xresloader)、[Main.java](https://github.com/xresloader/xresloader/blob/main/src/org/xresloader/core/Main.java) | argv 与 stdin 编码以目标 JAR 行为为准，真实差分验证 | JAR 升级时 / 分词或输出格式变化 / current |
| Tauri 架构 | [进程模型](https://v2.tauri.app/concept/process-model/)、[构建前提](https://v2.tauri.app/start/prerequisites/)、[Vite](https://v2.tauri.app/start/frontend/vite/) | Rust 管理桌面能力，业务在独立 Node 进程 | 每次升级 / 原生边界变化 / current |
| 原生命令 | [Calling Rust](https://v2.tauri.app/develop/calling-rust/) | 可能阻塞的健康与 RPC 使用 async + spawn_blocking | 每次升级 / 命令或回调变化 / current |
| 前端安全 | [Capabilities](https://v2.tauri.app/security/capabilities/)、[CSP](https://v2.tauri.app/security/csp/) | 发行能力显式配置，测试 WebDriver 与 release 隔离 | 每次安全变更 / 权限或 CSP 变化 / current |
| Node 执行 | [VM](https://nodejs.org/docs/latest-v24.x/api/vm.html)、[child_process](https://nodejs.org/docs/latest-v24.x/api/child_process.html)、[Streams](https://nodejs.org/docs/latest-v24.x/api/stream.html) | 可信脚本、独立监督、背压和明确完成确认 | 每次 Node 升级 / 调用与回收变化 / current |
| Windows 监督 | [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)、[taskkill](https://learn.microsoft.com/windows-server/administration/windows-commands/taskkill)、[Koffi](https://koffi.dev/) | Job Object 与句柄身份管理，taskkill 降级 | 每次监督变更 / 进程回收变化 / current |
| XML 解析 | [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)、[loader](../../packages/backend/src/config/loader.ts)、[isolated-loader](../../packages/backend/src/config/isolated-loader.ts) | 严格 UTF-8、包含检查、预算、30 秒 helper 截止 | 依赖升级时 / 解析和限额变化 / current |
| log4js | [配置](https://log4js-node.github.io/log4js-node/configuration.html)、[appender](https://log4js-node.github.io/log4js-node/writing-appenders.html) | 独立 sink，有界队列、配置与关闭期限 | 依赖升级时 / 日志扩展变化 / current |
| 前端 | [React](https://react.dev/)、[React Aria](https://react-spectrum.adobe.com/react-aria/)、[Vite](https://vite.dev/) | React 组件、可访问性与生产 preview 测试 | 依赖升级时 / 组件和构建变化 / current |
| 依赖管理 | [Yarn 配置](https://yarnpkg.com/configuration/yarnrc)、[Corepack](https://github.com/nodejs/corepack) | packageManager 固定 Yarn，immutable 安装，目标架构 optional 模块 | 依赖工具升级时 / 安装和闭包变化 / current |

## 桌面运行时、字体与测试

| 主题 | 官方来源 | 当前约定 | review_cadence / update_trigger / status |
| --- | --- | --- | --- |
| WebView | [Tauri WebView Versions](https://v2.tauri.app/reference/webview-versions/) | Windows WebView2、Linux WebKitGTK、macOS 系统 WKWebView | 每次支持矩阵变更 / OS 与引擎变化 / current |
| WebView2 分发 | [运行时分发](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution) | Windows bootstrap 安装器与 offline Fixed Version，系统运行时优先 | 每次运行时升级 / 布局变化 / current |
| 本机字体 | [Local Font Access](https://developer.chrome.com/docs/capabilities/web-apis/local-fonts)、[Profile4](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2profile4)、[权限枚举](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl#corewebview2_permission_kind)、[with_webview](https://docs.rs/tauri/2.11.6/tauri/webview/struct.WebviewWindow.html#method.with_webview) | Windows 原生 profile 仅允许当前应用来源的 LocalFonts，失败回退预设与手动字体 | 每次 Tauri/WebView2 升级 / COM 接口和来源变化 / current |
| 桌面驱动 | [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)、[EdgeOptions](https://learn.microsoft.com/en-us/microsoft-edge/webdriver/capabilities-edge-options) | Windows/Linux tauri-driver，macOS debug 嵌入驱动；持久化测试显式复用 profile | 驱动升级时 / 测试和 profile 变化 / current |
| 浏览器测试 | [Playwright](https://playwright.dev/docs/test-projects) | Chromium、Firefox、WebKit 使用生产 preview；原生能力另测 | 依赖升级时 / 浏览器与适配器变化 / current |
| 异步测试 | [Vitest timers](https://vitest.dev/guide/mocking/timers)、[WebDriver Element Click](https://www.w3.org/TR/webdriver2/#element-click)、[嵌入驱动源码](https://docs.rs/crate/tauri-plugin-wdio-webdriver/1.4.0/source/src/platform/executor.rs) | 单元同步使用事件和 Promise 屏障，截止逻辑使用虚拟时钟；嵌入 1.4.0 的 select 需派发 input/change，外部驱动保持原生输入；见[测试约定](../development/testing.md#异步测试同步) | 测试或驱动升级时 / 事件、时间断言和输入模拟变化 / current |
| 多语言 | [sys-locale](https://docs.rs/sys-locale/latest/sys_locale/fn.get_locales.html)、[Navigator.languages](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/languages)、[Intl.Locale](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Locale)、[React Aria](https://react-aria.adobe.com/quality#setting-the-locale)、[useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) | 原生系统偏好优先，手动选择持久化，七种语言目录以英文回退，根 lang 与组件语言同步；规则见[多语言](../development/localization.md) | 平台或界面库升级时 / 语言目录与检测规则变化 / current |

## 打包与发布

| 主题 | 官方来源 | 当前约定 | review_cadence / update_trigger / status |
| --- | --- | --- | --- |
| 平台包 | [Windows ARM](https://v2.tauri.app/distribute/windows-installer/#building-for-32-bit-or-arm)、[AppImage](https://v2.tauri.app/distribute/appimage/)、[DMG](https://v2.tauri.app/distribute/dmg/) | 支持矩阵与应用布局由 packaging 维护，构建和运行分别验证 | 平台升级时 / 包格式变化 / current |
| 目标二进制 | [Node 官方发行](https://nodejs.org/dist/)、[PE](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format)、[ELF machine](https://github.com/torvalds/linux/blob/master/include/uapi/linux/elf-em.h)、[Mach machine](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/mach/machine.h) | 校验目标 Node、ABI、模块架构、文件摘要及精确产物集合 | 目标或 ABI 升级时 / 原生闭包变化 / current |
| 应用资源包与缓存 | [adm-zip](https://github.com/cthackers/adm-zip)、[zip 8.6.0](https://docs.rs/zip/8.6.0/zip/read/struct.ZipFile.html)、[Rust 文件锁](https://doc.rust-lang.org/std/fs/struct.File.html#method.try_lock)、[Tauri 应用缓存](https://docs.rs/tauri/2.11.6/tauri/path/struct.PathResolver.html#method.app_cache_dir)、[Channel](https://v2.tauri.app/develop/calling-rust/#channels) | 单一 ZIP、逐文件校验、唯一活动缓存保存版本与摘要、删除后重建、运行使用锁和启动进度；见[合同](../development/resource-cache.md) | 依赖或布局升级时 / 缓存、清理或启动行为变化 / current |
| ARM 工具 | [QEMU user mode](https://www.qemu.org/docs/master/user/main.html)、[binfmt_misc](https://docs.kernel.org/admin-guide/binfmt-misc.html) | AppImage 工具阶段需目标主机或完整模拟用户空间，不能以交叉编译证明运行 | 打包工具升级时 / 宿主和模拟器变化 / current |
| GitHub Actions | [runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[手动运行](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)、[cache](https://github.com/actions/cache)、[checkout](https://github.com/actions/checkout) | immutable 安装，手动仅构建，tag 发布核对 sourceCommit 和下载摘要 | 每次 workflow 变更 / 缓存、矩阵、上传变化 / current |
| Release 查询与上传 | [按 tag 查询](https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name)、[列出 Release](https://docs.github.com/en/rest/releases/releases#list-releases)、[上传 action v1.6.2](https://github.com/xresloader/upload-to-github-release/blob/v1.6.2/README.md) | 草稿同名资产使用 overwrite 覆盖，上传后核对完整集合与摘要；tag 查询 404 后分页列表按 tag_name 查草稿，API 错误不视为不存在 | 发布校验变更时 / 草稿、分页、覆盖和权限变化 / current |
| 图标与 LFS | [Tauri icons](https://v2.tauri.app/develop/icons/)、[Git LFS](https://git-lfs.com/) | SVG 母版、平台导出和媒体使用 LFS | 资源变更时 / 工具与格式变化 / current |

## Agent 与维护

| 主题 | 官方来源 | 当前约定 | review_cadence / update_trigger / status |
| --- | --- | --- | --- |
| 项目规则 | [AGENTS.md](https://agents.md/)、[仓库规则](../../AGENTS.md)、[发布记录](../../CHANGELOG.md) | 单一共享入口，细节按目录和 Skills 加载；用户/开发文档维护当前约定，CHANGELOG 保留完整发布历史 | 季度 / 规则或文档维护前 / current |
| Skills | [规范](https://agentskills.io/specification)、[写作建议](https://agentskills.io/skill-creation/best-practices)、[评估](https://agentskills.io/skill-creation/evaluating-skills) | frontmatter、渐进加载、人工复核查询；触发率未在 harness 中实测 | 季度 / Skill 修改前 / current |
| Claude 规则 | [官方 memory 文档](https://code.claude.com/docs/en/memory) | 当前支持 AGENTS.md，仓库 CLAUDE.md 保持共享规则导入，不复制正文 | 季度 / Claude 兼容层变化前 / current |
| PowerShell | [pwsh](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_pwsh)、[Parsing](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_parsing)、[Quoting](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_quoting_rules) | Windows 使用 pwsh 7+、非交互、UTF-8 与明确参数 | 半年 / shell 脚本修改前 / current |
| 可选变更工具 | [OpenSpec](https://github.com/Fission-AI/OpenSpec)、[Superpowers](https://github.com/obra/superpowers) | 仓库未采用，新增前需授权和官方核验 | 引入前 / 工具选型变化 / 未采用 |
| 外部连接 | [MCP security](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices) | 仓库无项目级 MCP 接入，明确权限、凭据和数据边界 | 接入前 / 连接变化 / 未接入 |

模块入口见[开发文档](../development/README.md)，本仓库规则见[AGENTS.md](../../AGENTS.md)。
