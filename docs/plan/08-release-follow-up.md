# 08 发行后续环境验收

[执行索引](README.md) · [发行约定](05-packaging-release.md) · [测试约定](06-testing-acceptance.md)

更新日期：2026-10-04。实现与三平台自动交互已完成；本册维护最终验收任务。用户已移除证书签名验收，依据见 [范围调整记录](records/COMPLETION-2026-10-04.md)。本轮不创建或修改 Release；Linux 使用 WSL/Debian；ARM64 交叉包运行免验。

## 当前验证结果与环境项

`d61d639` 的 ci/Portable 均成功，Windows/Linux/macOS x64/macOS arm64 桌面各 13 项通过；R11 已验收并移入 [CI 记录](records/MACOS-E2E-2026-10-04.md)。同提交的正式完整构建 R12 已完成：8 个构建任务及 12 产物/边车校验通过，Release 聚合跳过，见 [最终核对](records/COMPLETION-2026-10-04.md)。公开 dev.1 的标签/旧资产身份见 [发布核对](records/ACCEPTANCE-2026-10-04.md)，不能由当前测试构建覆盖。

| 任务 | 状态 | 完成判据与边界 |
| --- | --- | --- |
| R5 实机范围收尾 | doing（额外环境/范围待确认） | 现有 Windows/WSL 真实 JAR、两平台各 9 项隔离/100 次循环、当前 Windows bootstrap 13 项及两类 ARM64 静态核验已归档。原生文件选择完整交互未通过；干净 VM、最低系统、GNOME/KDE、X11/Wayland完整环境未提供，不能自行记作通过或移除 |

各项绑定最终介质和实际结果。macOS 的 13 项 WKWebView 自动化不覆盖原生对话框、公开 DMG、最低系统或完整性能/泄漏矩阵；这些仍按下表验收。证书相关验收已撤除。

## 后续实机验收口径

| 环境 | 必须保留的检查 | 用例 |
| --- | --- | --- |
| Windows 最低支持版本/10/11、x64/ARM64 | 解压工具、中文/空格/只读目录；合格/过旧/无 Evergreen；bootstrap 联网/断网；offline 无缓存断网；Fixed ACL、语言回退、后台控制台/进程清理、原生文件对话框 | PK02/PK03/PK07/PK09、SC08/SC11、UI08、I01–I10/I13/I14 |
| macOS 13.5 与当前受支持系统、x64/arm64 | Finder/终端/Applications 自定位；低于最低系统拒绝；WKWebView/原生文件对话框/CLI/脚本；公开 DMG 与测试构建分开；未签名属性如实记录 | PK04/PK07/PK09、UI01–UI08、I09/I10/I13/I14 |
| Linux D2 发行版、双架构、GNOME/KDE、X11/Wayland | bootstrap 缺库预检；offline 最小桌面/无缓存断网；GPU/字体/IME/portal；POSIX 强杀/后台子树；原生文件对话框 | PK05/PK06/PK07/PK09、SC08/SC11、I02–I10/I12–I14 |
| 各目标稳定性/性能 | 同负载真实 JAR；冷/热启动；原生 DPI/触控；100 次循环与整个进程树资源；对照 P0/P6 口径 | C15、EX05、UI03/UI08、P6-03/P6-05 |

Windows/Linux 已取消安装器；升级/修复/卸载按新目录解压、替换/重解压、删除应用目录执行，保留用户配置及共享运行时。ARM64 运行本轮免验是用户决定；构建、静态核验和运行通过分别记录。

## 进度更新规则

每项完成后从活动表迁入 records，保留提交/介质 digest、实际命令/数量/退出码、首轮失败与未验边界。变更接口或平台时同步模块分册、测试和 [来源索引](../ai/source-index.md)；稳定 Agent 约束改变时才更新 AGENTS/Skills。历史记录保留当时语境，不把过去的失败改成当前成功。
