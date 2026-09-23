---
name: cli-tooling
description: "Use this skill when selecting, probing, or installing command-line tools for terminal work in this repository (rg, fd, bat, sd, jq, yq and other modern CLI replacements), when a needed tool is missing and must be installed, or when replacing legacy grep/find/sed/du/df/curl commands with modern equivalents. Not for project build/test commands covered by AGENTS.md."
license: MIT
metadata:
  owner: project-ai-maintainers
---

# 现代 CLI 工具选用与安装

## Outcome

终端命令始终使用当前机器上可用的最高效工具，输出干净、结构化、非交互、有限流；缺失工具按平台正确渠道安装，不在本地编译。

## Use when

- 需要搜索/查找/替换/结构化处理/磁盘与进程查看等终端操作，先确认用哪个工具。
- 探测发现需要的工具缺失，需要安装。
- 要把存量脚本里的传统工具（grep/find/sed/awk/curl）替换为现代等价物。
- 不适用：项目构建、测试、打包命令（见 `AGENTS.md`“技术栈与命令”）；shell 引用/编码/错误处理纪律（常驻规则见 `AGENTS.md`“终端与工具约定”）。

## Workflow

1. 探测：`Get-Command <tool> -ErrorAction SilentlyContinue`（或 `tool --version`）。常驻纪律（pwsh 7+、干净输出、限流、退出码语义）见 `AGENTS.md`，本 Skill 不重复。
2. 选型：查 [references/modern-cli-tools.md](references/modern-cli-tools.md) 对照表，确定现代工具与回退项；注意平台命令名差异（`fdfind`/`batcat`）。
3. 缺失时安装：按对照表“渠道”列选择发行版仓库直装或官方静态二进制；Windows 用 `winget`（装不上先 `winget search` 核对 ID）或 Scoop；兜底用 `cargo binstall`/`mise`/`aqua`，不本地编译。环境受限时按最小套装优先级：`rg`、`fd`、`sd`、`jq`（+`yq`）、`bat`。
4. 安装后重新探测验证版本可用，再执行任务。
5. 把存量脚本迁移到现代工具时，保持参数语义一致（如 ugrep 平替 grep），并运行原有验证命令。

## Resources

- [references/modern-cli-tools.md](references/modern-cli-tools.md)：传统→现代工具完整对照表、安装渠道、平台要点、Agent 使用守则。选型或安装前必读。
- [references/trigger-evaluation.md](references/trigger-evaluation.md)：本 Skill 的标注查询集与评估记录。

## Validation

- 选用的命令在目标平台实际探测通过（版本输出或 `--help` 成功）。
- 安装命令非交互、可追溯；不引入需要编译的安装路径。
- 触发评估结果记录于 references/trigger-evaluation.md（或标注“未在 harness 中实测”）。
