# 08 发行后续验收

[执行索引](README.md) · [发行约定](05-packaging-release.md) · [测试约定](06-testing-acceptance.md)

更新日期：2026-10-04。活动状态唯一维护本册；已完成 P0–P7、R1–R9 的过程见 [records](records/README.md)，最新候选/发布核对见 [收尾记录](records/ACCEPTANCE-2026-10-04.md)。本轮不创建或修改 Release；Linux 使用 WSL/Debian；ARM64 交叉包运行免验。额外实机/受控证书不阻塞本轮代码收尾，也不计作通过。

## 当前证据与待收尾项

`5909542` 的 ci、Portable 8 产物及 release 12 产物验证均成功，macOS 双架构原生构建完成。公开 dev.1 标签指向该提交，但现存 14 产物包含旧 macOS offline；下载的 Windows/macOS x64 bootstrap 清单为 `651ea5e`。公开资产验收必须使用各包实际身份，不能仅按标签归属。

| 任务 | 状态 | 完成判据与边界 |
| --- | --- | --- |
| R11 macOS 自动交互 | blocked（远端推送需明确授权） | 实现、6 单元及 Windows 嵌入驱动 13 项通过；准备 macOS x64/arm64 CI 执行同 13 项。自动审批拒绝上传验证分支；批准后继续。生产依赖树排除插件、release + e2e 编译拒绝已实测；原生对话框和公开 DMG 另验 |
| R5 额外实机矩阵 | deferred（环境后续项） | 干净 VM、最低系统、GNOME/KDE、X11/Wayland及下表完整运行/性能证据；当前没有对应实机，不能据构建或浏览器测试关闭 G5/G6 |
| R6 签名渠道 | deferred（受控证书后续项） | 当前未签名开发预发布；维护者提供证书环境后执行签名、公证/stapling、断网 Gatekeeper，并重新计算最终 digest |

R7–R9 的远端构建/去重配置/桌面与缓存已有 `5909542` 证据；R10 发布身份防护的 API/下载证据、5 回归和门禁完成，均移出活动表。macOS 可自动化范围因官方新增嵌入驱动调整至 R11，完整实机范围仍为 R5；现有公开资产不修改。

## 后续实机验收口径

| 环境 | 必须保留的检查 | 用例 |
| --- | --- | --- |
| Windows 最低支持版本/10/11、x64/ARM64 | 解压工具、中文/空格/只读目录；合格/过旧/无 Evergreen；bootstrap 联网/断网；offline 无缓存断网；Fixed ACL、语言回退、后台控制台及进程清理 | PK02/PK03/PK07/PK09、SC08/SC11、I01–I10/I13/I14 |
| macOS 13.5 与当前受支持系统、x64/arm64 | Finder/终端/Applications 自定位；低于最低系统拒绝；WKWebView/原生文件对话框/CLI/脚本；公开 DMG 与测试构建分开；未签名行为记录，签名渠道另执行 R6 | PK04/PK07/PK09、UI01–UI08、I09/I10/I13/I14 |
| Linux D2 发行版、双架构、GNOME/KDE、X11/Wayland | bootstrap 缺库预检；offline 最小桌面/无缓存断网；GPU/字体/IME/portal；POSIX 强杀/后台子树；原生文件对话框 | PK05/PK06/PK07/PK09、SC08/SC11、I02–I10/I12–I14 |
| 各目标稳定性/性能 | 同负载真实 JAR；冷/热启动；原生 DPI/触控；100 次循环与整个进程树资源；对照 P0/P6 口径 | C15、EX05、UI03/UI08、P6-03/P6-05 |

Windows/Linux 已取消安装器；升级/修复/卸载按新目录解压、替换/重解压、删除应用目录执行，保留用户配置及共享运行时。ARM64 运行本轮免验是用户决定；构建、静态核验和运行通过分别记录。

## 进度更新规则

每项完成后从活动表迁入 records，保留提交/介质 digest、实际命令/数量/退出码、首轮失败与未验边界。变更接口或平台时同步模块分册、测试和 [来源索引](../ai/source-index.md)；稳定 Agent 约束改变时才更新 AGENTS/Skills。历史记录保留当时语境，不把过去的失败改成当前成功。
