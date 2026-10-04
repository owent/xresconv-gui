# 最终验收范围调整与构建核对

[记录索引](README.md) · [当前任务](../08-release-follow-up.md) · [三平台交互记录](MACOS-E2E-2026-10-04.md)

## 用户决定与执行边界

用户于 2026-10-04 明确要求不验证证书签名，并从执行计划移除。R6 签名渠道以及依赖证书的签名、公证/stapling、断网 Gatekeeper 验收撤除，不记作测试通过。I11 历史编号不复用；PK08 保留 SBOM、许可证、最终摘要、二进制依赖和生产能力隔离检查。未签名介质属性继续如实记录。

此前“不发布”、Linux 可用 WSL/Debian、ARM64 交叉包运行免验的边界继续有效。实机矩阵 R5 与签名 R6 是不同要求；本轮先继续已有环境验证，并确认其余实机范围。

## 当前候选完整构建

候选源码为 `d61d6398e80e9badb71863ff7189dad203d9d8bc`；本轮只调整文档及 workflow 注释，产品代码未变。已执行 `gh workflow run release.yml --repo owent/xresconv-gui --ref dev`（exit 0），产生 [手动构建 37185211013](https://github.com/owent/xresconv-gui/actions/runs/37185211013)。API 核对 head SHA 与 `workflow_dispatch` 事件，最终 conclusion=success：8 个构建任务全部成功，[聚合校验](https://github.com/owent/xresconv-gui/actions/runs/37185211013/job/111387617367)明确输出 `Verified 12 release artifacts and SHA-256 sidecars`，Release 聚合 skipped。R12 完成并从活动表移出。

| 系统 | 实际正式介质 |
| --- | --- |
| Windows x64/arm64 | 每架构 bootstrap/offline 7z，共 4 个 |
| Linux x86_64/aarch64 | 每架构 bootstrap tar.zst、offline AppImage/tar.zst，共 6 个 |
| macOS x64/arm64 | 每架构 bootstrap DMG，共 2 个，无重复 offline DMG |

现有工作流的 `aggregate-release` 仅在 v3 tag push 执行；此次手动入口只构建、上传 Actions 产物和校验集合。调度不上传本地未提交源码，不创建或修改 tag/Release。依据：[GitHub 手动工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)及实际 workflow 条件。

## 当前环境复验

Windows 实测为 Windows 11 专业版 x64、build 26300、PowerShell 7.6.6；Linux 为 Debian 13 x86_64/WSL2（kernel 6.18.40.1）。这组实际环境版本不替代最低系统验收。

| 环境与对象 | 命令/结果 | 覆盖边界 |
| --- | --- | --- |
| Windows x64、真实 xresloader 2.23.7 JAR | 显式设置 JAR/sample 后运行 `node tests/conversion/run-e2e.mjs`，exit 0；8 格式、30 文件全部 MATCH，stdin 与逐项 argv 均无失败 | 验证了真实 JAR 差分；桌面 100 次转换需另行测试 |
| Debian/WSL x86_64、同一真实 JAR | Linux Node 24.21.0 执行相同入口，exit 0；8 格式、30 文件全部 MATCH | 实际 WSLg 环境，不外推为 GNOME/KDE 或干净离线 VM |
| Debian/WSL 配置隔离及循环 | `vitest run test/config-isolation.test.ts test/service/run-loop-stress.test.ts`，2 文件、9 项通过；100 次循环/110 次运行，全部所属 worker 回收 | 循环使用测试 Java runner；真实 JAR 验证结果见上两行 |
| Windows 配置隔离及循环 | 相同两文件入口，exit 0，9 项通过；总耗时 9.81 秒 | 相同循环口径，不外推为真实 JAR 的 GUI 性能 |
| 当前 Windows x64 bootstrap 正式 7z | 从中文/空格目录解包，manifest sourceCommit=d61d639、Node=24.21.0、1241 文件；`XRESCONV_E2E_SKIP_BUILD=1 node tests/desktop/run.mjs` exit 0，3+6+4=13 项通过 | 实际 release 模式 GUI，使用宿主 Evergreen 154.0.4258.53；驱动 153.0.4234.48 有版本警告，实际所有断言通过 |
| Windows 当前包负载与 ARM64 offline | x64 bootstrap 的 manifest 身份/1241 文件 SHA/包内 Node/附件核验通过；ARM64 offline `verifyPortableArtifacts(..., staticOnly:true)`，1242 文件及目标 PE 核验通过 | ARM64 Node 未执行；跨包与摘要分别核验 |
| Linux ARM64 bootstrap | Debian 解包后核验 manifest 身份/1240 文件 SHA，以及 GUI、Node、Koffi 的 ARM64 ELF 头，exit 0 | 未执行任何 ARM64 程序；当前 Node 元数据 24.21.0 |

## 摘要核对记录与本地下载边界

聚合 job 下载完整矩阵并重新计算 12 产物的 SHA-256，通过精确集合/边车检查。8 个构建 job 的原始日志及全部摘要另外收录于 `build/final-completion-20261004/artifact-evidence.json`，这些 CI 摘要明确区别于本机重算。

本机独立下载并重算 5 个产物：Windows x64 bootstrap、Windows ARM64 offline、Linux ARM64 的 3 种介质，全部与 CI/边车一致。Linux x64 artifact 下载因 `error writing zip archive: unexpected EOF` 失败；全量重复下载在约 30 分钟后终止所属下载进程。未下载部分不记作本机包复验，不影响已经取证的 CI 完整构建结果。

## 原生对话框探针与未完成边界

UI Automation 探针未找到目标窗口，45 秒截止失败；随后 Win32 按本次应用 PID 定位到标题“选择转换配置”、类 `#32770` 的窗口，实测 `Visible=false`。对所属窗口发送关闭消息后，前端配置路径保持为空（exit 0），仅证明取消回调；选择文件后的路径回写探针 30 秒截止失败，不记作 UI08 通过。另以 `Start-Process -WindowStyle Normal` 直接启动 GUI，经 UI Automation 找到并调用“转换列表文件”按钮后，30 秒内仍未定位到目标文件窗口，exit 1；同样不记作原生交互通过。消息/调用送达不能证明业务回写或可见原生交互完成，所属驱动/应用进程树均收尾。I09 的目录/资源定位与原生对话框检查分别记录。

首轮临时工具另有固定端口无法监听、猜测 PowerShell 路径不存在、Store 版 PowerShell 子进程无法加入测试 Job 的失败；后续使用动态端口、实际 `Get-Command pwsh.exe` 结果及当前 PowerShell host。用户未确认缩减其余实机矩阵，故 R5 继续由 08 册维护；不因签名移除或 CI 成功将其标为完成。

探针依据：[UI Automation 元素获取](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/obtaining-ui-automation-elements)、[EnumWindows](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumwindows)、[窗口进程识别](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowthreadprocessid)、[SendMessageW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagew)、[BM_CLICK](https://learn.microsoft.com/en-us/windows/win32/controls/bm-click)（非活动对话框可能失败）、[WM_COMMAND](https://learn.microsoft.com/en-us/windows/win32/menurc/wm-command)。未据此推断产品缺陷根因。

原始 API/日志/报告及已核对的 5 个介质集中于 `build/final-completion-20261004/`，有记录索引与摘要；临时脚本、Linux 源码副本和解包树清理。完整 12 介质保留在上述 Actions 运行中，未创建或修改 Release。
