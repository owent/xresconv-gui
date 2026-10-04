# dev.1 发布核对与收尾设计

[记录索引](README.md) · [活动任务](../08-release-follow-up.md)

## 已核实的输入

- 用户确认 dev.1 已发布；API 显示公开预发布，发布时间为 2026-10-04 01:21:11（UTC+8）。标签指向 `590954289a04b7a7f8af877338011bc4fb16e7fb`。
- 该提交 [ci](https://github.com/owent/xresconv-gui/actions/runs/37138257748)、[Portable](https://github.com/owent/xresconv-gui/actions/runs/37138257795)、[release](https://github.com/owent/xresconv-gui/actions/runs/37138276258) 均成功；Windows/Linux 桌面各 13 项通过，Portable 8 产物及 release 12 产物集合验证通过，macOS 双架构原生构建成功。
- Linux 桌面恢复 Yarn archives 缓存；Windows 首次安装后已保存缓存。新键首次未命中不作为缓存失效。
- 公开 release 实际保留 14 产物及 14 边车，包含旧 macOS offline DMG。上传日志逐项记录同名资产已存在而跳过；下载的 Windows/macOS x64 bootstrap 内嵌 `sourceCommit` 均为 `651ea5e46c5d5214dc1fdab64d136a57344e7d8b`。标签与资产身份必须分开登记，不能用新构建成功覆盖旧资产验收。
- Windows 7z SHA-256：`dd7a6fb0c9c7d3a960d644c116dc0d932b74dfc6503581b9b4dc01370b49a170`；macOS x64 bootstrap DMG SHA-256：`76630d606da7f6fc77ebc0e9afb50cefe2d698e591dd7326574f86d11646f140`。两者下载后均与公开边车匹配。

## 本轮实施规范

1. 发布身份防护：上传前重新验证完整候选集合及哈希，逐项比较已有 release 的资产名称与 API `digest`。同名内容不同、额外资产、摘要缺失均拒绝；已有公开版本只有完全相同才只读结束，禁止重新写成 draft。已有 draft 允许补齐缺失资产，上传后再次验证完整集合。覆盖或删除公开 dev.1 不在本轮授权范围。
2. macOS 自动交互：使用官方 `tauri-plugin-wdio-webdriver` 1.4.0 standalone 模式，复用当前 WDIO 场景；仅显式 `e2e` feature 的 debug 构建启动本地测试服务器，release + feature 编译拒绝。Windows/Linux 默认保持已验证的外部驱动；macOS 默认嵌入驱动，每个 spec 独立应用进程、设置恢复和进程树收尾。
3. 测试构建交互与公开 DMG 验收分别报告。CI WKWebView 测试不能证明公开 DMG 的 Finder 安装、原生对话框、最低系统或 Gatekeeper；当前本机没有 macOS，不将静态解包计作实机通过。
4. 已完成任务移入本记录；主计划保留稳定编号/边界，08 册只维护活动状态与受控环境后续验收。历史 records 保留当时事实。

回滚：按 git diff 回退本轮防护及测试入口；已有生产构建和公开资产均不修改。验证：先失败回归，再单测/类型/lint、Cargo 生产与测试 feature、Windows 实际交互、workflow 语法和 Markdown；macOS 新配置远端执行结果另记，不猜测。

## 官方依据

- [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)：嵌入驱动支持三平台，直接外部 tauri-driver 仍只支持 Windows/Linux。
- [WDIO 插件配置](https://webdriver.io/docs/desktop-testing/tauri/plugin-setup/)及[standalone 插件](https://github.com/webdriverio/desktop-mobile/tree/main/packages/tauri-plugin-webdriver)：基本 WebDriver 不要求额外 mock/execute 前端插件；测试服务不得进入生产。
- [GitHub release assets API](https://docs.github.com/en/rest/releases/assets)：资产 `digest` 与名称用于逐项核对；release 的标签或创建时间不能代替资产内容身份。

## 已完成任务迁入

| 任务 | 已完成范围 | 验证记录 |
| --- | --- | --- |
| R1 发布/计划核对 | dev.0 用户首轮及 API、计划分册精简；dev.1 发布/标签/CI/包内身份复核 | 本记录及前次 RELEASE 记录 |
| R2 最终介质 | Windows/Linux x64 本机双变体逐文件与桌面各 13 项；macOS 双架构原生构建 | EXECUTION 记录；5909542 release/Portable |
| R3 XML 隔离 | 独立 helper、外部截止/取消/关闭/独立预算/100k 回归，Windows/Linux 门禁及真实 JAR | EXECUTION 记录，相关源码/回归 |
| R4 ARM64 | Windows 双 7z、Linux bootstrap tar.zst 与 offline AppImage/tar.zst；构建/静态核验完成，运行免验 | EXECUTION 记录、全量 CI |
| R7 CI 集成 | 5909542 首次 ci/Portable/release 均成功；12 正式产物和 8 Portable 集合；Linux Yarn 恢复、Windows Yarn 保存；两平台 Rust cache 上传完成 | 三 run 与 desktop 原始日志；后续 Rust 命中单独复核 |
| R8/R9 | macOS 正式仅 bootstrap 双 DMG 的配置、标题有界就绪/Yarn 取消补丁、缓存路径/保存与固定驱动 | CI-E2E 记录及本记录的远端验证记录 |
| R10 发布身份防护 | 公开资产 API/下载/边车核对；上传前后摘要门禁、5 回归与本地质量验证 | 本记录、release-publication/verify-publication 实现与测试 |

## 本轮验证与修改

- 发布防护：新增 5 项回归，首次失败后实现通过；打包工作区 155 通过 / 2 既有 Windows 平台跳过，类型检查通过。防护拒绝旧同名异内容及额外 offline 资产，完全相同的公开版本不进入写入 action；同 ref 串行，上传后复验。
- macOS 入口：锁定可选 Rust crate 1.4.0，无新增 JS 运行依赖或生产能力。配置/就绪 6 单元通过；Windows 编译测试插件后实际交互首次 12 通过 / 1 失败，事件追踪证明 label click 和 W3C pointer actions 都未发 PointerEvent；补完整指针序列后 13 项通过，产品和选择断言未改变。
- 生产隔离：默认 Cargo normal 依赖树无 WebDriver/axum；`cargo check --release --features e2e --locked` 非零，命中显式禁止生产的编译错误。fmt、Node lint/typecheck 与 actionlint 通过。
- 公开 Windows x64 bootstrap：实际下载/解压包的外部驱动 13 项通过；包内身份为 651ea5e，测试 harness 为当前工作树，不外推 macOS。651ea5e→5909542 未修改 GUI/Node 业务或 Tauri 产品代码。
- AGENTS 同步当前三平台测试、安全和资产身份边界；Skill 触发/工具专属层未改变，不增设冗余 Skill。已按 [AGENTS.md 官方规范](https://agents.md/)复核单一入口。

最终本地门禁：根单测 762 通过 / 2 既有平台跳过，TypeScript、Biome、Markdown/actionlint 零错误；Rust 19 项及 Clippy/fmt 通过。Linux 公开 bootstrap 归档 SHA-256 为 `98c1dda89d86e86cbdd0649f7b59d2196ce9da3cf87c53de2e8bfd501e205316`，WSL/Debian 的 6 harness 单元和 13 交互项通过。

下载 Windows/macOS 包逐文件验证分别为 1241/1240 文件，大小/SHA-256 全部匹配，GUI/Node 的 PE/Mach-O 架构匹配；Windows 包内 Node 24.21.0 实跑，macOS 包内 Node 24.19.0 仅静态读取，未在 Windows 执行。平台实际运行输入版本分别记录。

## 首次本地收尾时的远端执行边界

本节保留首次收尾时的限制。后续用户自行提交/推送 d61d639，macOS 双架构 CI 各 13 项通过，R11 已完成，见 [后续验收](MACOS-E2E-2026-10-04.md)。

当时 macOS 双架构交互 workflow 尚未执行。推送隔离 `build/validate-*` 分支的动作被自动审批拒绝：审查认为用户之前的“不发布”限制未授权上传尚未提交源码，须明确批准远端代码写入。没有绕过、推送分支、创建 tag 或修改公开 release；本地代码、回归、文档和可审阅候选准备继续完成。完整 macOS 实机/签名范围不由自动化覆盖。

原始记录与哈希/输入清单：`build/final-acceptance-20261004/`。本机没有 macOS；新 Mac CI 及额外原生对话框/证书/干净 VM 的实际结果单独登记，不以测试配置代替通过。
