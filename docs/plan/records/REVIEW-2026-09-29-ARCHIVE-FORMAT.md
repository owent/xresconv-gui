# 2026-09-29 发行归档格式与压缩级别

[返回记录索引](README.md) · [当前发行规范](../05-packaging-release.md) · [来源索引](../../ai/source-index.md)

## 决策与边界

Windows bootstrap 和 offline 统一发布 `.7z`，采用 `7z a -t7z -mx=9 -mmt=2 -ms=on`；构建检查 7z 文件头并执行 `7z t` 后才替换旧归档。目标机需具备支持 7z 的解压工具。回滚时恢复矩阵命名、归档实现和 release 上传规则，不能仅改扩展名。macOS DMG 与 portable `.app.zip` 不属于 zstd 路径，保持原格式。

Linux bootstrap 和 offline 的 `tar.zst` 先生成 tar 文件，再以 `zstd -19 -T2 --long=27` 压缩，检查文件头和 `zstd -t` 后发布。提高级别会增加构建 CPU 时间和内存；`--long=27` 对应 128 MiB 窗口，解压端使用正常 zstd 帧解析。offline AppImage 不经过此步骤。回滚时恢复旧压缩命令，归档扩展名与内容合同不变。

GitHub 工作流中的七个 Action 仓库引用已更新为当日 GitHub release API 核验的最新 `v` 数字标签。浮动标签可以被维护者移动，因此仍需复查运行时和 CI 结果；正式发行未经本地检查替代。

## 同负载验证

下表使用本机既有 `3.0.0-dev.0` 负载，由当前归档函数重新打包，不代表当前 HEAD 的正式发行产物。两种 Windows 归档解压后逐文件路径与 SHA-256 完全一致，包含 bootstrapper 或 Fixed Version 运行时。

| 负载 | 旧归档 | 新 7z | 节省 | 文件校验 |
| --- | ---: | ---: | ---: | --- |
| Windows bootstrap | ZIP 44,436,715 B | 27,331,635 B | 38.49% | 1,243/1,243 相同 |
| Windows offline | tar.zst 264,526,631 B | 218,329,538 B | 17.46% | 1,500/1,500 相同 |

Linux 压缩使用同一份 114,165,248 B 的代表性 tar（上述 Windows bootstrap 应用文件加 Linux preflight；不是 Linux 原生构建）：`zstd -3 -T2` 为 38,315,009 B，`zstd -19 -T2 --long=27` 为 30,103,881 B，降低 21.43%。新归档经解压与 1,242 个来源文件 SHA-256 校验；两种压缩级别均通过 `zstd -t`。Linux 原生 AppImage 和 tar.zst 仍需 CI 构建验收。

本轮工作树的 Windows 完整打包命令也已本机通过：`3.0.0-dev.1` bootstrap 为 27,335,054 B，offline 为 218,340,044 B。两份 `.7z` 都通过 `7z t` 与边车 SHA-256 核验；offline 的 `webview2-runtime/msedgewebview2.exe`、策略文件和共用 Node 均在归档内。真实 `verify-release.ts` 按两个 Windows 目标核验了这两份产物及边车。这是本地构建验收，不代表 GitHub Release 已重新发布。

包装模块测试覆盖目标矩阵、命名、Windows 7z 真实往返、Linux 参数、归档损坏与失败保留旧产物；四个工作流已通过 YAML 解析和 Action `v` 标签扫描。后续检查以本次任务的质量门禁输出为准。

依据：[7z 格式](https://7-zip.org/7z.html)、[zstd 1.5.7 命令参数](https://github.com/facebook/zstd/blob/v1.5.7/programs/zstd.1.md)、[GitHub Action 标签管理](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/manage-custom-actions)。
