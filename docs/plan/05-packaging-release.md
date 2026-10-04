# 05 打包、运行时与 CI 发布

[执行索引](README.md) · [上一册](04-ui.md) · [下一册](06-testing-acceptance.md) · [当前任务](08-release-follow-up.md)

本册只维护当前约定。NSIS/DEB/RPM、tar.gz 和早期 Portable 范围已被用户的便携归档决策取代，实施/原型证据见 [P5 记录](records/README.md)、[P5-11](records/P5-11.md) 与 [发行审查](records/REVIEW-2026-09-29.md)。

dev.0 首轮验证和 dev.1 发布均已完成。当前发行约定见下表；dev.1 公开资产仍保留旧 14 产物集合，与标签及最新 12 产物 CI 的身份差异见 [收尾记录](records/ACCEPTANCE-2026-10-04.md)。活动状态只维护在 08 册。

## 目标、产物和身份

`packaging/targets.json` 与 schema 是目标/manifest 唯一来源；`matrix.ts` 生成命名与精确集合。当前 12 个可构建目标中，10 个正式发行目标产生 12 个产物：

| 平台/架构 | bootstrap | offline | 全量产物数 |
| --- | --- | --- | --- |
| Windows x64 / arm64 | 7z，系统 Evergreen + 包内引导器 | 7z，包内 Fixed Version，系统 Evergreen 优先 | 4 |
| macOS x64 / arm64 | DMG，系统 WKWebView | 不重复发布；本地/Portable 入口保留 | 2 |
| Linux x86_64 / aarch64 | tar.zst，系统 WebKitGTK | AppImage + tar.zst，自含运行时闭包 | 6 |

文件名为 `xresconv-gui-<version>-<os>-<arch>-<variant>.<ext>`，不带 distro 段；每个产物附 `.sha256`。版本与 Tauri/根 package 一致，OS/架构/triple 对应。拒绝重复、缺失、未知目标及穿越路径；敏感信息不回显。

两变体共享同版 GUI/Node/业务模块能力，分别组装并登记运行时差异。所有变体含一份固定架构 Node、backend/guardian/worker JS、生产 npm 闭包、必要原生适配；Java/JAR 外置，用户机不需要全局 Node/npm/开发工具，不在首次运行联网补 JS 依赖。

## manifest、负载与大小

`runtime-manifest.json` 按 schema 记录应用版本/sourceCommit、目标/变体/WebView 策略、Node 来源/哈希/ABI、moduleTreeHash、文件大小/SHA-256/许可及签名/验证信息。禁止开发机绝对路径、密钥和 `.`/`..` 安装路径段。

组装器打包三个角色与 matcher/log-sink 独立 worker，保留动态 require 所需文件、嵌套依赖/多版本和许可。staged 探针必须检查解析路径，不能借用仓库祖先 node_modules。Linux 负载落位见下文。manifest 自身有 hash 不代表可信发行。

安装/实机验收未导入时 `verificationReport.result` 保持 `fail`；构建/文件校验不自动修改成完整验收通过。每轮最终介质逐文件核验与报告必须绑定同一提交和 digest。

大小分开记录桌面层/前端、Node、各 JS 角色、npm/原生模块、资源、引导器/离线运行时、压缩和展开总量。offline 单列运行时成本，不套用 bootstrap 的降幅；实验数据见 [Node 体积研究](records/RESEARCH-2026-09-29-NODE-SIZE.md) 和 [P6-05](records/P6-05.md)，新候选重新测量。

## Windows

最低系统/运行时以 targets 为准（当前 Windows ≥10.0.17763、WebView2 ≥120.0.0）。两种归档顶层均为 `xresconv-gui/`：GUI exe、构建附带时的 WebView2Loader.dll、`runtime/`、`app/`、manifest。

- bootstrap 另附微软 `MicrosoftEdgeWebview2Setup.exe`。合格系统 Evergreen 直接复用；缺失/过旧时原生诊断指导用户手动运行引导器，不能把未完成系统安装当成功。
- offline 另附 `webview2-runtime/` 与 `webview2-runtime-policy.json`。合格系统 Evergreen 优先，并清理继承的 `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`；缺失/过旧才指向包内 Fixed Version。Win10 Fixed≥120 的 AppContainer 读执行 ACL 必须幂等补齐；不可用时原生诊断退出。
- 官方下载页 Fixed cab 链接按架构/版本解析，结构变化构建失败；缓存校验 MSCF/体积并以官方 `expand -F:*` 解包。最终候选须记录实际版本/来源/hash，安全更新随应用发行维护。
- 两变体共用 GUI subsystem 桌面程序；guardian 用 CREATE_NO_WINDOW，受监督 Node 子进程用 windowsHide。窗口 API + 行为回归检查控制台，不能仅数 conhost。证据见 [控制台回归记录](records/REVIEW-2026-09-29-WINDOWS-CONSOLE.md)。
- 不能裁掉整个 Fixed runtime 后仍称完整 offline；它不带 bootstrapper。共享 Evergreen 不随删除应用目录卸载，UNC/企业策略/权限路径按官方分发边界单列验证。

### 7z 与语言策略

暂存目录 `build/windows-archive-*` 内压缩：`7z a -t7z -mx=9 -mmt=2 -ms=on`。检查文件头 + `7z t`，真实解压往返与逐文件校验另做；失败清理暂存并保留旧归档/旧边车，验证成功才替换归档并生成新 SHA-256。隐藏/Unicode 路径保留，参数不经 shell 拼接。目标机需兼容 7z 的解压工具。

默认 `--webview-locales=all` 保留微软完整运行时。显式 `mainstream` 保留 en-US、zh-CN、zh-TW、ja、ko、de、fr、es、pt-BR、ru，只裁已识别语言包/overlay；缺任一保留语言失败，未知资源/ICU/媒体/渲染/许可/原始缓存保留。仅适用 Windows offline（all 变体选择时只影响 offline）。微软未承诺裁剪支持，Fixed 升级后重验语言/回退；不默认裁剪 Node ICU。

## macOS

最低 macOS 13.5；原生 x64/arm64 分别构建。两命名变体 `webviewStrategy=system-only`，使用系统 WKWebView，系统不足只能升级 OS，offline 不能补装独立 WKWebView。两个变体的运行时负载没有差异；manifest 变体字段和构建元数据不构成独立运行时策略。

Finder/终端/Applications、中文/空格/只读目录须正确定位 Resources、随包 Node 与各角色。正式 release CI 仅输出 x64/arm64 两个 bootstrap DMG；已发布旧产物不删除。本地 offline 目标及 Portable 的 `--portable --variant=offline` 未签名 `.app.zip`（ditto）兼容入口保留，Portable 不验证 DMG 介质。

目前无苹果开发者证书，未签名开发预发布如实登记。签名渠道 R6 在受控环境按嵌套代码→app→介质顺序核验 entitlements/签名、公证/stapling 和断网首次 Gatekeeper；不以禁用保护替代。签名后不再 strip/改写可执行文件，最终哈希按签名后介质重算。

## Linux

发行无 distro 段；原生 x86_64/aarch64 在 Ubuntu 22.04 最老构建基线生成（glibc 2.35）。运行环境仍覆盖 D2：Ubuntu 22.04/24.04、Debian 12/13、Fedora 最近两个正式版本；GNOME/KDE、X11/Wayland 实机验证。

AppImage 构建环境须显式安装 `xdg-utils`：当前 Tauri bundler 会从 `/usr/bin/xdg-open` 复制文件到 AppDir，不能依赖 runner 预装。release/portable 两入口在依赖安装后以 `test -x /usr/bin/xdg-open` 提前检查；缺失依赖回归与同提交 ARM64 Portable 成功对照见 CI 修复记录。

- bootstrap tar.zst：裸程序/Node/app/manifest/preflight.sh 平铺；复用系统 WebKitGTK 4.1 ≥2.38。先经不依赖 GTK/WebKit 的 preflight 给缺库/安装指引，参数、cwd、退出码、信号保真；不自动永久修改软件源。
- offline：自含 AppImage 与同闭包解包重压 tar.zst 并存；无缓存/无网络的最小/已更新桌面验证 GPU/EGL、字体、IME、媒体、D-Bus/portal 等集成，不以拷贝单个 webkit 库证明完整性。
- 负载落位固定 `/usr/share/xresconv-gui`，桌面候选探测 `../share/<productName>`。不能恢复 `usr/lib`（linuxdeploy 递归 patchelf/strip 改写 Node/koffi）或 `/opt`（AppImage 只拷 data/usr 子树）；原始失败与修复见 [P5-11](records/P5-11.md)。
- tar.zst 先生成 tar 文件，再执行外部 `zstd -19 -T2 --long=27`，检查头 + `zstd -t`，成功后替换归档；不以默认压缩管道替代。AppImage 由 Tauri/linuxdeploy 生成，不再经 zstd。
- 系统闭包不适配某个 D2 环境时保留失败和适配约定，不能悄悄减支持矩阵或恢复已取消的 DEB/RPM 发行。运行时缺失、包锁、权限、冲突、磁盘不足的诊断/恢复按 06 册实测。

## CI 范围与聚合

| 入口 | 当前范围 | 出口/边界 |
| --- | --- | --- |
| ci.yml | Node/Rust 门禁，三引擎浏览器，Windows/Linux 外部驱动、macOS 双架构 WKWebView 测试构建 | macOS 仅 debug e2e feature；不替代公开 DMG、原生对话框或全目标离线 VM |
| release.yml | Windows/Linux/macOS 双架构全量构建；Windows 双 7z、Linux 三产物、macOS 每架构一个 bootstrap DMG | 10 发行目标→12 产物及边车；手动或 build/validate-* 分支仅核验/上传 Actions 产物，只有 v3 tag push 才创建 draft；远端执行结果单独记录 |
| portable-build.yml | macOS 双架构 offline app.zip；Linux 双架构 bootstrap tar.zst + offline AppImage/tar.zst | 精确 8 产物；解包/manifest 身份/逐文件 hash/包内 Node，Linux 另验运行时；无 release 写权限 |
| stale.yml | 既有 90 天/标签维护语义 | 最小 issues/PR 权限 |

Action 使用已核验稳定 v 数字标签。Node 安装后调用仓库 `.github/actions/setup-yarn`：Yarn 4.18.1，`enableGlobalCache=false`，显式 archives 目录 `build/yarn-cache`；key 包含 OS/架构及 yarn.lock/.yarnrc.yml/package.json，restore 前缀只在同 OS/架构复用。始终执行 immutable 安装，成功后立即保存，后续测试失败不丢已下载缓存；不缓存 node_modules。

Rust 门禁使用 --locked，发行输入包含 Cargo.lock。所有 rust-cache workspace 显式设 `. -> target`，质量/桌面/生产用途 key 分离；desktop 失败也保存依赖与 cargo bin，tauri-driver 固定为 2.1.0。APT 库正常安装，Windows msedgedriver 与实际 WebView2 精确匹配。缓存命中不是验证通过；每个外部命令检查退出码，失败日志/截图/清理均留证据，不上传敏感配置。

`scripts/verify-release.ts --target=<os>/<distro-or-dash>/<arch>/<variant>` 的键集合与 build job 同步；发行矩阵当前 distro 段为 `-`。不传 target 校验完整 12 产物；子集校验也必须集合相等，拒绝多余/缺失/错误边车，并计算实际 SHA-256。macOS offline DMG 即使带正确 hash 也属于多余产物。聚合通过证明当时构建产物，不替代完整实机/签名验收。

已有 tag 触发 release；发布权限仅聚合 job，PR 不接触签名密钥。同 ref 发行串行执行，避免上传竞态。`verify-publication.ts` 上传前后复验本地集合/实际哈希及 GitHub assets API 摘要：已有同名异内容、多余资产或未知摘要均失败；完整同内容时只读结束，禁止将公开版本改成 draft；仅新版本或缺件且已有摘要相同的 draft 可上传。不能仅靠 `overwrite:false` 的“跳过同名”声称当前候选发布成功。

runner 无目标平台/干净状态时由维护者导入绑定 digest 的实机记录，不能用交叉编译代替。生产构建无 WebDriver 依赖；显式 e2e 只允许 debug，release + e2e 编译拒绝。

## Portable 构建验证与后续验收

`package:<os> --portable --variant=…` 对 macOS 改输出 app.zip；Windows/Linux 归档与是否传 portable 无关。`verify:portable --os=windows|macos|linux --arch=… --variant=…` 支持 Windows 7z、macOS app.zip 和 Linux 归档，仍不验证 DMG。Windows 核验完整业务文件清单、Node、目标 PE 架构与 bootstrapper/Fixed 附件；`--static-only` 仅限 Windows，显式避免执行交叉目标 Node，不构成运行验收。聚合 `--aggregate` 的既有 Portable 集合仍为 macOS/Linux 8 产物。

## 本地交叉打包

同 OS 的异构构建使用 `package:<os> --cross --arch=arm64`（Linux 为 `--arch=aarch64`），必须明确传 `--cross`；默认仍拒绝与宿主不同架构。Tauri 使用声明目标 triple，产物从 `target/<triple>/release/` 取出。跨 OS 构建仍拒绝；macOS 需要 macOS 主机与 SDK。

交叉 Node 来自与宿主同精确版本的官方目标归档：校验 SHASUMS256.txt、解析匹配官方 headers 的 NODE_MODULE_VERSION、核验目标二进制头；不执行目标 Node。Yarn supportedArchitectures.cpu 同时安装 x64/arm64 optional 包，组装按目标 os/cpu 筛选；缺少目标 Koffi 包或 .node 架构错误立即失败。

Windows 必须具备 ARM64 CRT 与 Windows SDK 库，并保证 Cargo 实际使用 MSVC linker。存在同名 Scoop `link.exe` 时显式配置 `CARGO_TARGET_AARCH64_PC_WINDOWS_MSVC_LINKER` 与 ARM64 `LIB`；仅看到 ARM64 目录不能证明 libcmt.lib 等标准库齐全。用户本轮免验 ARM64 运行，不把该例外扩展为长期默认。Linux 构建继续保留 Ubuntu 22.04 基线，WSL/Debian 运行验证不改变支持地板。

Linux ARM offline 的 linuxdeploy/ldd/GTK 插件需要完整 ARM 用户空间；仅安装 ARM 开发库并注册 QEMU 的 x64 容器不足以可靠收集依赖。本轮在 x64 Ubuntu 22.04 交叉编译，再用模拟的 ARM Ubuntu 22.04 运行打包工具，复用同一程序与布局；临时 binfmt 处理、命令和 digest 见执行记录。模拟打包不计作 ARM64 运行验收。

P5-01～P5-11 的实现与历史原型见 records，本轮本地产物与交叉打包见执行记录；任务状态只维护于 08 册。Windows/Linux 升级/修复/移除按便携目录操作，保留用户数据及共享系统运行时。

## 来源

- [WebView2 分发](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)、[Tauri Windows](https://v2.tauri.app/distribute/windows-installer/)：运行时与旧安装器资料，当前使用便携归档。
- [Tauri WebView](https://v2.tauri.app/reference/webview-versions/)、[macOS bundle](https://v2.tauri.app/distribute/macos-application-bundle/)。
- [Tauri AppImage](https://v2.tauri.app/distribute/appimage/)、[Debian](https://v2.tauri.app/distribute/debian/)、[RPM](https://v2.tauri.app/distribute/rpm/)：Linux 打包/资源布局与历史原型依据。
- [来源索引](../ai/source-index.md)：归档/语言策略、官方版本调研、发布 API 与本轮 CI 证据。
