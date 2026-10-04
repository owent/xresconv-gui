# 07 切换、回退与交接

[执行索引](README.md) · [上一册](06-testing-acceptance.md) · [当前任务](08-release-follow-up.md)

**P7 旧架构切换和文档交接已执行**，删除/替代验证见 [P7 记录](records/P7.md)。dev.0 首轮验证和 dev.1 发布均已完成；dev.1 标签、构建与公开资产身份见 [收尾记录](records/ACCEPTANCE-2026-10-04.md)。最终实机范围只维护于 08 册；证书验收已按用户要求撤除。

## 当前交接范围

| 已交付 | 权威入口 |
| --- | --- |
| 新 UI / Node 业务、脚本、监督与桌面层 | apps/desktop、packages、src-tauri；[02](02-contracts-script-host.md)/[03](03-domain-conversion.md)/[04](04-ui.md) |
| CLI/日志配置、公开五入口、对象/回调/data/cache | [README](../../README.md)、[脚本约定](../../tests/fixtures/scripts/contract.md)、P2/P7 records |
| 便携归档/运行时/manifest/许可/SBOM/hash 管线 | [05 册](05-packaging-release.md)；最终介质绑定结果单独验收 |
| 用户/开发/迁移/AI 指引 | README、CHANGELOG、AGENTS/CLAUDE、Skills 与 [来源索引](../ai/source-index.md) |
| 旧入口/依赖移除 | P7 删除清单；旧源码只在版本历史，不保留第二套正式入口 |

继续保留用户脚本 require 所需的模块、许可证、真实测试数据与未验事项；不能通过删除能力或记录让扫描变绿。正式包不开放开发服务器、Node inspector、测试 WebDriver 或任意 Tauri 执行入口。

## 用户数据与回退

XML、选择器 JSON、Java/JAR 和转换输出由用户控制；新版加载不自动改写。显示偏好/缓存与业务文件分开，应用便携目录删除不删除用户配置或共享 WebView/系统包。

- 稳定旧版回退：[v2.6.0](https://github.com/owent/xresconv-gui/releases/tag/v2.6.0)，也为 32 位用户终点版本。
- 第一轮开发版对照：[v3.0.0-dev.0](https://github.com/owent/xresconv-gui/releases/tag/v3.0.0-dev.0)；其旧归档格式和验证范围不能覆盖 dev.1。
- 开发回退按对应提交/diff，保留用户既有改动。脚本/Java 的文件副作用不会随代码或应用回退自动撤销，须列出待用户核验的输出。
- 若后续确需写配置迁移，先形成字段约定、备份/完整性校验、幂等迁移和旧版可读性说明；当前不包含未授权的协议升级。

## 下一轮候选交接

冻结源码/锁文件/运行时 → 构建最终介质 → 精确集合与逐文件 hash → 适用平台运行/清理/性能 → 记录范围及差异 → 聚合 draft → 按发行流程复核发布。

P7 实施及已完成后续任务进入 records，当前三平台自动化交接见 [CI 验收](records/MACOS-E2E-2026-10-04.md)。后续报告绑定包内提交与介质 digest，核对现有资产后才进入发行写入步骤；不覆盖既有 release，也不沿用测试 feature 构建代替生产介质。

交接须能说明：保留的功能与脚本样本；实际已验证的系统/架构/变体；运行时缺失/断网的恢复方法；故障定位与回退入口。当前计划按用户确认的 Windows/WSL 本机范围全部完成，见 [本机验收](records/LOCAL-ACCEPTANCE-2026-10-04.md)；其他环境实机与证书验收登记为范围撤除，远端 CI 与新本地工作树介质分别记录。
