# 本机验收与计划完成记录（2026-10-04）

[记录索引](README.md) · [主计划](../../../Plan.md) · [验收范围](../08-release-follow-up.md)

## 用户确认的范围

本轮实机验收仅使用 Windows 本机和本机 WSL/Debian；所需 Debian 包可通过 `sudo apt install -y` 安装。其他系统版本、macOS 实机、ARM64 硬件、干净 VM、GNOME/KDE、完整 X11/Wayland 与原生触控环境的验收从计划移除，记录为用户撤除范围。平台支持声明、构建矩阵和已有自动化仍保留。

此前证书签名、公证/stapling、Gatekeeper 验收撤除与 ARM64 交叉包运行免验的决定继续有效。未创建、上传或修改 Release。macOS 双架构自动交互及正式 12 产物构建的既有结果分别见 [CI 记录](MACOS-E2E-2026-10-04.md)和[完整构建](COMPLETION-2026-10-04.md)。

## 本轮发现与修复

| 问题 | 实际表现与定位 | 修复及回归 |
| --- | --- | --- |
| 手动选择配置遇到后端启动竞态 | WSL 原生文件框已返回中文文件名；界面路径仍为空，显示 `BACKEND_NOT_READY: backend not ready (state: starting)`。`loadConfig` 手动路径立即失败，自动加载另有等待逻辑 | 配置加载仅对明确未执行的 BACKEND_NOT_READY 每 600ms 重试、30s 截止；配置错误、超时、断连不重放；会话代际变化停止旧请求。新增 5 项检查，修复前 2 项失败，修复后通过 |
| 工具链检查沿用旧 Yarn 版本 | 根 packageManager 为 yarn@4.18.1，检查脚本要求 4.18.0，WSL 构建前检查失败 | 检查从根 packageManager 读取精确版本，经 corepack 查询实际版本；清理 Node 展示标签中的历史候选。CLI 匹配/不匹配 2 项回归，修复前匹配用例失败，修复后通过 |
| 浏览器同源检查绑定固定端口 | Windows 本机 4173 被拒绝监听；换到可用端口后三引擎 UI08-3 将本地资源误认作外部资源 | 使用当前页面 URL 的实际 origin 比较，保留禁止外部资源的断言；三引擎 24 项通过 |
| AppRun 测试偏好隔离路径错误 | offline 启动器在 AppDir 根目录，实际 GUI 与偏好位于 usr/bin；脚本清理了启动器旁文件，上轮 CLI 偏好自动加载干扰原生选择 | runner 按实际 AppDir GUI 位置备份/重置/恢复偏好；新增目录定位和原字节保留回归，修复前 AppDir 用例失败；WSL offline 重新执行桌面与原生检查通过 |

原生检查使用可见生产窗口：Windows 前端由 UI Automation 操作，文件框通过所属窗口的原生文件名/按钮控件操作；WSL 在独占 D-Bus/Xvfb 内使用 X11 键盘和 UTF-8 剪贴板。断言包含真实路径入树、取消保留状态、日志文件内容和所属子树退出。

## 候选与介质身份

本轮起点为 `95d024624f0888e7aa30827f396c820f2c00e7e0`。最初六个产品源码文件与 d61d639 的运行 JS 相同；后续发现启动竞态，使用本轮修复后的工作树重打 Windows x64 两变体及 Linux x86_64 三介质。新包 manifest 明确 `sourceCommit=95d0246…`、`repositorySnapshot.dirty=true`；源码差异与摘要另行保存，不能把工作树修复称为已提交或已通过远端 CI。

Windows 构建使用本机工具链；Linux 构建复用 Ubuntu 22.04 镜像及目标/依赖缓存，再在 WSL/Debian 13 中运行。WSL 运行不改变 Linux 构建基线。公开 dev.1 的标签/旧资产继续按 [发布核对](ACCEPTANCE-2026-10-04.md)分别识别，本轮新包仅保留本地。

## 验证结果

| 项目 | 实际结果 |
| --- | --- |
| Windows 生产 bootstrap/offline | 各 13 项桌面交互通过；可见原生打开/选择/取消、导出/取消、正常关闭与所属子树清理通过。两包在合格本机 Evergreen 154.0.4258.53 上运行；offline 优先复用系统运行时符合既定策略 |
| Windows 介质完整性 | 两包 SHA-256、各 1241 业务负载文件、Node 24.21.0、目标 PE 及变体附件校验通过 |
| Linux 生产介质 | Ubuntu 22.04 构建完成 bootstrap tar.zst、offline AppImage/tar.zst；各 1240 负载文件与 Node 24.21.0 校验通过。WSL 两变体各 13 项桌面交互及各 5 项原生打开/保存/取消与子树清理通过 |
| 单元测试 | 显式指定 xresloader-2.23.7.jar 与 sample；根 workspaces 771 项通过、2 项仅 Linux 的 preflight 用例在 Windows 条件跳过；WSL 单独补跑 preflight/工具链 4 项通过 |
| 浏览器 | Chromium/Firefox/WebKit 合计 24 项通过，生产 preview 使用本机可用共享端口 |
| 其他检查 | typecheck、Biome、根 lint、全部变更 Markdown 的 markdownlint、git diff --check 通过；工具链检查 Windows/Ubuntu 22.04 通过 |
| 既有真实转换/稳定性 | Windows/WSL 八格式、30 文件全 MATCH；各 9 项配置隔离/100 轮检查见完整构建记录。100 轮使用 fake Java runner，不冒充真实 GUI/JAR 100 轮 |

## 工具故障与验收边界

辅助脚本曾错误等待 GTK 窗口销毁（实际取消时可隐藏窗口）、错误假定 Windows 打开/保存框的文件名控件 ID 相同，以及过早发送输入。修正为等待可见窗口/实际控件、检查配置加载结果，并保持 X11 剪贴板进程存活直到读取完成。Windows offline 在合格 Evergreen 环境优先使用系统运行时；本轮按实际进程路径和策略记录，不把包内 Fixed 附件存在写成已运行 Fixed。

探针曾误要求 offline 必须使用 Fixed，核对 05 册和 webview_preflight.rs 后修正，实际进程路径已保存。WSL 补跑单测时默认配置加载器向只读 node_modules 写 `.vite-temp` 失败；按 [Vite 配置加载说明](https://vite.dev/config/#config-loading)使用 `--configLoader native --no-cache` 后 4 项通过。包内 manifest 的 verificationReport 保留构建时占位结果，实际本地通过记录在本册及原始报告中；这些 dirty 包未转成公开发行验收或远端 CI 通过。

构建保留既有 Vite chunk/dynamic-import、Node MODULE_TYPELESS 和 Debian portal/PipeWire 提示。Debian offline 原始日志还包含宿主 GIO 的 libproxy/dconf 模块因符号缺失加载失败；本轮打开、保存和转换列表交互仍全部通过，未验证这些模块对应的系统代理和偏好后端功能。当前没有干净 VM 中缺失 Evergreen、全机断网、最低系统、原生触控或 macOS 原生文件框的通过记录，这些已经按用户指令撤出本轮验收。

## 原始记录与回退

R5 已完成，当前活动任务为零。日志、源码差异/摘要、manifest、介质摘要、原生结果与失败诊断保留在 `build/local-acceptance-20261004/`，由该目录 README 和摘要索引路由。临时工作副本、下载分片、解包树已清理；确认没有遗留依赖 bind、所属应用/驱动或构建容器，结果记录在 cleanup.json。首次失败诊断和最终结果分别保留。

回退可仅撤销本轮配置加载等待、工具链检查及浏览器测试断言的改动；无需回退既有 CI/macOS 打包策略。回退配置加载等待会恢复已复现的手动选择启动竞态。

来源：[Tauri 原生对话框](https://v2.tauri.app/plugin/dialog/)、[Microsoft UI Automation](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/obtaining-ui-automation-elements)、[Win32 BM_CLICK](https://learn.microsoft.com/en-us/windows/win32/controls/bm-click)、[Debian xdotool 手册](https://manpages.debian.org/trixie/xdotool/xdotool.1.en.html)、[Corepack packageManager](https://github.com/nodejs/corepack#usage)、[URL origin 标准](https://url.spec.whatwg.org/#dom-url-origin)。实现和实际失败日志共同约束本轮结论。
