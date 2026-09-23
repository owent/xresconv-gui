# cli-tooling 触发评估记录

## 标注查询集

### 应触发（正例）

1. “这个仓库里搜一下所有用到 fancytree 的地方”（搜索选型）
2. “系统里没有 fd，帮我装一下”
3. “把脚本里的 grep 都换成现代工具”
4. “Windows 上用什么替代 du 看目录大小”
5. “帮我装 jq 和 yq”
6. “这个 JSON 输出怎么用命令行解析”
7. “找一个大文件hex查看的工具”
8. “批量替换文本用什么命令最快”
9. “winget 装不上 ripgrep，怎么处理”
10. “给我列一下现代命令行工具清单”

### 不应触发（负例 / near-miss）

1. “执行 yarn run package-test 打包”（项目构建命令）
2. “PowerShell 双引号里怎么转义”（shell 语法，属 AGENTS.md 常驻规则）
3. “帮我写个 .ps1 部署脚本”（脚本编写，不是工具选型）
4. “CI 里 npm install 失败了”（CI 排错）
5. “git 提交冲突怎么解决”
6. “markdownlint 报 MD029 怎么修”
7. “Electron 打包体积太大怎么优化”
8. “命令超时了要不要重试”（超时纪律在 AGENTS.md）
9. “node 脚本里怎么读 JSON”（代码问题）
10. “帮我装一下 electron”（项目依赖，走 yarn）

## 评估记录

- 首次创建：未在 harness 中实测触发率；待后续维护时按 `ai-agent-maintenance/references/trigger-evaluation.md` 的流程补测。
