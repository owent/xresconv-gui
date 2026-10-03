# EXECUTION-2026-10-03 本地收尾与交叉打包

[记录索引](README.md) · [活动任务](../08-release-follow-up.md) · [发行约定](../05-packaging-release.md)

## 范围与源码身份

- task_id: R2/R3/R4
- owner: 当前 AI 会话
- app_version: `3.0.0-dev.1`
- source_commit: `6b65026bb716149331d20447c15de29756ab142d`，含本轮未提交改动；不将该提交已有 CI 当作本轮源码的 CI
- product_test_inputs_sha256: `131c1ffec07d5ca1d444aa693f8b3fb849412fcf38209dbceaefe292182abf27`；390 个产品/测试/依赖锁输入，Linux 两工作副本与当前输入零差异；逐文件表在任务目录，不包含文档与工作流
- os_arch: Windows x64 原生 / ARM64 交叉；WSL Debian 13 上 Ubuntu 22.04 构建基线，Linux x86_64 原生 / aarch64 交叉
- rollback: 本轮源码 diff 可独立回退；保留 dev.0 与 v2.6.0，不覆盖已发布资产
- release_action: 不创建 tag、draft 或公开 Release；远端临时构建分支尚待授权

用户指定 Linux 可用 WSL/Debian 本地验证，ARM64 交叉编译后打包即可，运行免验。额外实机、干净离线 VM 和签名渠道不计作已验证；本记录不替代这些渠道的 G5/G6。

## 实现与依据

XML 解析移入独立 Node helper，外部 30 秒截止、AbortSignal 与 ProcessScope 回收，1 GiB V8 堆预算；细分 XML 节点/深度与脚本文本预算见 [03 册](../03-domain-conversion.md)。打包增加 config-worker.mjs；会话取消/关闭不提交未完成候选。状态订阅在 loading 时抛错的加载占用已通过先失败的回归测试定位并修复。

设计取舍：每次加载启动 helper，沿用现有有界帧传递候选与 ConfigError；外部截止覆盖启动、读取、同步 XML 校验/解析及传输，终止和确认回收后才返回。业务进程继续处理健康/取消。保持 strict XML/include/声明路径、set_name 和候选提交语义，新增累计 100 万元素、单脚本 1 MiB/累计 8 MiB；元素深度保持锁定 parser 原有默认 100。真实子进程回归覆盖死循环 helper、父计时器响应、外部截止/AbortSignal、错误位置/include/文本往返、独立预算及 100k 候选。风险为启动成本与拒绝超大误配置；失败保留旧候选，解析路由与 helper 组装可整体回退。

交叉打包显式 `--cross --arch`，下载与宿主同版本的官方 Node/headers，校验归档 SHA-256、读取 ABI、检查目标二进制头，按目标筛选原生模块；不执行交叉目标 Node。权威来源与 ARM AppImage 模拟器限制见 [来源索引](../../ai/source-index.md)“本地收尾调研”。

## 已执行质量门禁

| 环境 / 命令 | 实际结果 | 边界 |
| --- | --- | --- |
| Windows `yarn lint` / `yarn typecheck` | 通过；Biome 243 文件，Markdown/typecheck exit 0 | 本轮源码，不沿用已有 CI |
| Windows `yarn test:unit` | 739 passed / 2 skipped | 跳过的是已有 Linux 条件用例 |
| Windows `yarn test:browser` | 24 passed，Chromium/Firefox/WebKit | 生产前端构建，不替代桌面 |
| Windows `yarn test:shell` / `yarn check:shell` | Rust 19 passed；Clippy all-targets `-D warnings` 通过 | Windows 本机范围 |
| Windows `yarn test:conversion` | xresloader-2.23.7.jar；8 格式 / 30 文件全部 MATCH，0 基线失败 | 显式选定 JAR；报告 `build/g3-e2e/report.json` |
| Windows 最终 x64 双 7z `verify:portable` | 两包各 1,241 业务负载文件的大小/hash/manifest 与 Node 24.21.0 通过 | offline 附件结构/架构/完整语言策略通过，当前系统有 Evergreen |
| Windows 解压包 `test:desktop` | bootstrap/offline 各 13 passed，均覆盖空会话与 CLI 加载 | tauri-driver；msedgedriver 与 WebView2 同为 154.0.4258.53；进程所属树由 runner 收尾 |
| Linux 普通用户、UTF-8、容器 init `test --maxWorkers=2` | 731 passed / 10 skipped，exit 0；typecheck 另通过 | 4 项 Windows 监督条件、6 项 Windows 打包条件跳过；真实 JAR 用例未跳过；原始日志在任务目录 |
| Debian `verify:portable` | Linux x86_64 三产物各 1,240 负载文件 / manifest / Node 24.21.0 / 运行时检查通过 | Ubuntu 22.04 构建，Debian 13.7 / WebKitGTK 2.52.6 验证；不替代干净断网 VM |
| Debian 最终解压包 `test:desktop` | bootstrap 与 offline AppRun 各 13 passed，exit 0 | tauri-driver 2.1.0 / WebKitWebDriver / dbus-run-session / xvfb；覆盖空会话与 CLI 加载 |
| Debian `test:conversion` | xresloader-2.23.7.jar / OpenJDK 21.0.12.1；8 格式 / 30 文件全部 MATCH | JAR SHA-256 `d71d52437089896f9b15f4116df346de2f9af9039b0ab7a5a0d120ea6f084f2c`；报告在 Linux 工作副本的 build/g3-e2e |
| release.yml | actionlint 1.7.12 通过 | 新工作流源码检查；远端执行结果另记 |
| `verify-release.ts` 显式本地目标子集 | 8 目标 / 10 产物 / 10 SHA-256 边车通过 | 精确集合与实际文件 hash；四 macOS DMG 尚缺，不冒充全量 14 通过 |

## Windows 最终产物

产物在 `build/dist/`，每个都有同名 `.sha256`。Node 固定 24.21.0 / ABI 137；offline Fixed Version 154.0.4258.53，语言策略 all。

| 文件后缀 | 字节数 | SHA-256 |
| --- | ---: | --- |
| windows-x64-bootstrap.7z | 27,339,152 | `eff5f3220249c6ba9c61462528cc177180651eccedb3089cf3de516af607e372` |
| windows-x64-offline.7z | 218,377,911 | `470a4aa4be945fd4dc926fd889fb0cc86d3b1750a37d4bed9d3a12c9050961d5` |
| windows-arm64-bootstrap.7z | 23,917,670 | `a024fd6cdd2c13290f7d4b14e9f1f4dbf5ceaa890c4171127d5f7ab87e01659e` |
| windows-arm64-offline.7z | 200,723,560 | `caaf0651b15ac657dc5f69e7263d625c17da32ac9142bef09645beb077d0ff3c` |

Windows ARM64 使用 `aarch64-pc-windows-msvc`、MSVC 14.51.36231 的 linker 与 ARM64 SDK/CRT。起初误命中 Scoop 的同名 link.exe；指定 MSVC 后又定位出本机 arm64 库目录缺 libcmt.lib。依据 Visual Studio 官方 catalog 下载 `Microsoft.VC.14.51.CRT.ARM64.Desktop.base.vsix`，SHA-256 `c30a1064ef39efd3e969a1cac2bb56173de42aee558efbf7b5c1ca8910228687`，仅解包到任务 build 目录。最终双包链接/归档通过，未运行 ARM64 应用。

## Linux 环境问题与修正

首轮环境失败均保留原始日志，未通过跳过掩盖：root 绕过只读文件；最小容器 POSIX locale 使 Java 文件名原生编码为 ASCII；WSL 目录大量并发模块加载影响短启动截止；普通 shell PID 1 未回收强杀后的孤儿。分别改为普通用户、C.UTF-8、限制 2 个测试 worker、Podman `--init` 后全量通过。测试前提同步到 [06 册](../06-testing-acceptance.md)。

Ubuntu 22.04 镜像与目标系统库保持 glibc 2.35 基线；Node 官方归档经 SHASUMS 校验；Rust 1.98.1 与 aarch64 标准库锁定。下载慢时保留缓存层并改用 HTTPS Ubuntu 镜像，APT 仍核验仓库签名。QEMU 仅用于 ARM 打包工具阶段；WSL Windows 互操作入口保留，binfmt 挂载已恢复原先只读状态。

ARM 打包的环境诊断：strace 确认 linuxdeploy 外部 AppImage 插件 execve 返回 ENOEXEC；二进制头的 AI2 填充区与 Debian qemu-aarch64 的严格 mask 不匹配。先按 Tauri 对主工具的相同方式清三字节，插件 API 探测通过；备份误留插件扫描目录又被当插件执行，现已移至 arm-tool-debug。最终采用可移除的精确 ARM AI2 binfmt 规则，不改发行 AppImage 标记。x64 多架构容器的 ldd 将 ARM ELF 误报为非动态链接，GTK 插件也选入 x64 目录；因此改用完整 ARM Ubuntu 22.04 用户空间收集依赖，复用已交叉编译程序。Cargo 缓存必须挂到镜像实际 /opt/cargo/registry，错误挂点和离线缺件的失败日志也保留。

## Linux 最终产物

六个产物与边车已汇总到 `build/dist/` / `build/release-artifacts/`。Node 24.21.0 / ABI 137；构建系统库为 Ubuntu 22.04、glibc 2.35、GTK 3.24.33、WebKitGTK 2.50.4。ARM 程序使用 aarch64-unknown-linux-gnu 与交叉 GCC 编译，AppImage 使用 QEMU 中的 ARM 用户空间打包，offline tar 与 AppImage 复用同一闭包。

| 文件后缀 | 字节数 | SHA-256 |
| --- | ---: | --- |
| linux-x86_64-bootstrap.tar.zst | 37,596,641 | `6b46945e7732abb448c2a2c647d8c462a4e3f01edbd7b7ac7a899b03ab4b5981` |
| linux-x86_64-offline.AppImage | 125,368,824 | `cc7aeffd10e8b5f6b1b85f6d39caf4449f9e72c64faf9f634f37c23427375dd1` |
| linux-x86_64-offline.tar.zst | 103,645,812 | `53cbae8051c3fd0a7a1b9e99759374a1102c050a510d688e010d4f4aec9778cc` |
| linux-aarch64-bootstrap.tar.zst | 37,485,660 | `180bb88b282bfcd7f40a494d85dea2342b4711e3abe73919a568b87c17561316` |
| linux-aarch64-offline.AppImage | 123,079,176 | `c5a2aa2861cded7591c160e821a2a06dc32ab4ae054bce9b373dff281971497d` |
| linux-aarch64-offline.tar.zst | 102,037,108 | `e699308e96695fa47d99604118e54f7b0270a7c65359540b7d138c0c5821744e` |

构建镜像：x64 build `ea9d4748286b7813a655f322f6b862556c4cdd9dc3525a16669c1bf5e21f1260`；cross `a657e9c08d5d0702ee856b720da787e1df1a4667effd89dc1fb9f92c48f51daf`；ARM packaging `964465bc2e1de865bf3bbcdaf790af87cf88279a9edccab9655ff7859b1d7eec`。Containerfile、工具版本、原始失败与成功日志均索引到任务目录。

Linux 全量测试实际命令为 `corepack yarn workspaces foreach -A --include '@xresconv/*' run test --maxWorkers=2`，普通用户容器加 `--init`、`LANG/LC_ALL=C.UTF-8`。Linux bootstrap 经标准 package:linux --cross 生成；offline 复用 Tauri 准备的 ARM AppDir，在 ARM 容器运行同版 linuxdeploy/GTK/plugin；再 `--appimage-extract`、`tar -cf`、`zstd -19 -T2 --long=27`、`zstd -t` 并生成边车。所有步骤 exit 0；只启动打包工具，未启动 ARM64 GUI/包内 Node。

## 文档与后续边界

当前 10 产物完整集合、源码输入表和本地日志索引在 `build/continue-20261003/README.md`。新工作流仅构建路径已经 actionlint 与 12 目标映射/只读权限/tag-only 写入检查；macOS 当前候选四 DMG 尚需原生 runner，临时远端构建分支授权尚未收到，不把基底 CI 当作本轮通过。

另从官方 npm 发布包核对 Koffi 3.3.1 的 macOS 双架构 .node：dist.integrity 通过，两文件确为对应薄 Mach-O 64，避免凭经验假设新增头检查能兼容。原始头、SHA 与来源在任务目录 darwin-addon-headers.json；未构建或执行 macOS 应用。

计划及分册精简后，17 个修改 Markdown 已检查固定 D1–D6/F/C/R/I 编号、298 个本地引用和原始来源保留；17 个仓库文件及本地交付索引 markdownlint 零告警，git diff --check 通过。AGENTS 更新 Windows 校验入口及交叉构建稳定约束，CLAUDE/Skills 无需复制这些实现细节；临时工具适配留在条件化发行文档与记录。已清理本轮工作副本/解包目录/停止容器、卸载 bind、移除临时 binfmt 规则；保留缓存、工具与证据有本地索引。
