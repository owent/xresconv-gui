# 现代高性能命令行工具清单

> 执行 shell 命令优先使用本地已安装的现代高性能工具（多为 Rust/Go 实现，大仓库场景比传统工具快一个数量级）；先探测是否存在，缺失时才回退传统工具或 shell 原生命令。本文档由 `AGENTS.md`“终端与工具约定”引用，仅在需要安装或选用工具时阅读。

## 对照表

左列探测可用时优先；渠道：仓库 = 发行版仓库/包管理器直装，二进制 = 官方 GitHub Releases 静态单文件。

| 场景（替代） | 现代工具 | 渠道 | 回退 / 备注 |
| --- | --- | --- | --- |
| 文本搜索（grep） | ripgrep `rg` | 仓库 | `grep`、`Select-String` |
| grep 兼容平替 | ugrep | 仓库 | 参数与 grep 一致，可直接平替存量脚本 |
| 文件查找（find） | fd | 仓库 | `find`、`Get-ChildItem -Recurse`；Debian/Ubuntu 命令为 `fdfind` |
| 文件阅读（cat） | bat | 仓库 | `cat`、`Get-Content`；Debian/Ubuntu 命令为 `batcat`；用 `--paging=never --style=plain` |
| 文本替换（sed） | sd | 二进制（Fedora/Arch 仓库） | `sed`、`-replace` |
| 目录列表与树（ls/tree） | eza | 二进制（部分仓库） | `ls`、`tree`、`Get-ChildItem` |
| 树 + 占用合体 | erdtree `erd` | 二进制 | `tree`；`--layout flat` 适合 Agent 阅读 |
| 磁盘占用（du） | dust | 仓库 | `du` |
| 磁盘空间（df） | duf | 仓库 | `df` |
| 基准测试（time） | hyperfine | 仓库 | `time`、`Measure-Command` |
| 代码行统计（cloc） | tokei | 仓库 | `cloc` |
| 十六进制查看（xxd） | hexyl | 仓库 | `xxd`、`Format-Hex` |
| JSON 处理 | jq | 仓库 | `ConvertFrom-Json`/`ConvertTo-Json` |
| JSON（更快的 jq） | jaq | 二进制 | 语法兼容 jq |
| YAML 处理 | yq（mikefarah） | 二进制 | apt 源的 `yq` 是另一个工具，勿装错 |
| CSV/TSV 结构化 | miller `mlr` | 仓库 | `awk`、`Import-Csv` |
| 超大 CSV | qsv | 二进制 | miller |
| git diff 美化 | git-delta | 仓库 | 配入 gitconfig 生效 |
| 结构化 diff | difftastic `difft` | 二进制 | `diff`、git diff |
| 日志分析（tail/less） | lnav | 仓库 | Unix 专属，Windows 走 WSL；`-n` 无头模式支持 SQL 查询 |
| 日志跟随高亮（tail -f） | tailspin `tspin` | 二进制 | `tail -f`、`Get-Content -Wait` |
| 索引文件搜索（locate） | plocate | 仓库 | 仅 Linux；Windows 用 Everything 的 `es.exe`，macOS 用系统自带 `mdfind` |
| 并行压缩（gzip） | pigz | 仓库 | `gzip`；参数完全兼容 |
| 现代压缩算法 | zstd | 仓库 | `gzip`/`bzip2` |
| 解压所有格式（tar/unzip） | ouch | 二进制（Arch 仓库） | `tar`、`Expand-Archive` |
| 多线程下载（wget） | aria2 | 仓库 | `wget`、`Invoke-WebRequest` |
| 模糊查找 | fzf | 仓库 | 必须加 `--filter` 无交互使用 |
| HTTP 调用（curl） | xh | 二进制（Fedora/Arch 仓库） | `curl.exe`、`Invoke-RestMethod` |
| DNS 查询（dig） | doggo | 二进制 | `--json` 输出对 Agent 友好；`Resolve-DnsName`、`nslookup` |
| 进程查看（ps） | procs | 二进制（Arch 仓库） | `ps`、`Get-Process`；`--no-header` 可脚本化 |
| 文件监视触发（entr） | watchexec | 二进制（Arch 仓库） | `entr`、inotifywait |

## 获取与平台要点

- 首选发行版仓库/包管理器直装：Linux 用 `apt`/`dnf`（RHEL 系先启用 EPEL + CRB）/`pacman`，macOS 用 `brew`，Windows 用 `winget`（逐包安装）或 `Scoop`（包名与命令同名）；仓库未收录或版本过旧时下载官方静态二进制（解压后加入 PATH；Linux 老系统选 `*-musl` 静态产物，Windows 选 `*-pc-windows-msvc.zip`）。
- 兜底免编译渠道：`cargo binstall`、`mise`、`aqua`、Linuxbrew——只下载预编译产物，不在本地编译。
- winget 装不上时先 `winget search <名称>` 核对包 ID。

## 环境受限最小套装

按此优先级安装：`rg`、`fd`、`sd`、`jq`（+`yq`）、`bat`。

## Agent 使用守则

- **干净输出**：输出被管道捕获时多数工具自动关闭颜色与分页；行为不一致时用命令级开关（`--color=never`、`--no-heading`、`--paging=never`、`git --no-pager`）或环境变量（`NO_COLOR=1`、`PAGER=cat`）强制干净输出。
- **结构化输出优先**：优先选用带 `--json` 等机器可读输出的工具，用 `jq -r` 精确取字段，不用正则解析人类排版。
- **保持非交互**：等待输入即死锁；使用无头模式（`fzf --filter`、`lnav -n`）和包管理 `-y` 类开关，必要时切断 stdin。
- **控制输出规模**：搜索与遍历命令必须主动限流（`rg --max-count`、`-g '!node_modules'`、`fd --max-results`、`eza --tree --level=2`、`Select-Object -First`），防止大输出淹没上下文。
- **注意退出码语义**：`rg`/`grep`/`ugrep` 退出码 1 表示无匹配而非错误；`jq -e` 结果为空或 false 时返回 1。耗时命令必须设置超时，见 `AGENTS.md`“命令超时与重试”。
