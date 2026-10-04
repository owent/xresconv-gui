# 开发文档

## 阅读入口

| 文档 | 内容 |
| --- | --- |
| [架构](architecture.md) | 进程职责、通信、生命周期与安全边界 |
| [接口](interfaces.md) | Schema、RPC、关联标识与错误处理 |
| [配置与转换](configuration-and-conversion.md) | 加载、选择、参数、Java 与日志 |
| [前端](frontend.md) | 状态、事件、组件、显示设置与原生接口 |
| [多语言](localization.md) | 系统语言、英文回退、翻译目录与语言偏好 |
| [打包与发布](packaging.md) | 目标矩阵、布局、运行时、归档与工作流 |
| [测试](testing.md) | 质量命令、浏览器、桌面、真实转换与数据 |

## 开发环境

使用 Node.js 24+、Corepack 和仓库固定的 Yarn 4。Rust 工具链由 [rust-toolchain.toml](../../rust-toolchain.toml) 固定，原生依赖按 [Tauri 构建前提](https://v2.tauri.app/start/prerequisites/)准备。

Windows 使用 PowerShell 7+、Visual Studio C++ 构建工具和 WebView2。Linux 需要 WebKitGTK 4.1、GTK 3 及平台构建工具，发行构建基线为 Ubuntu 22.04 / glibc 2.35。macOS 使用 Xcode 命令行工具，DMG 与应用构建在 macOS 主机完成。

```sh
corepack yarn install --immutable
corepack yarn check:toolchain
corepack yarn dev:desktop
```

前端热更新由 Tauri 开发命令启动，业务 workspaces 随构建入口准备。构建桌面应用使用 `corepack yarn build:desktop`，发行归档使用平台 `package:*` 命令。

## 仓库结构

| 路径 | 职责 |
| --- | --- |
| `apps/desktop` | React 界面、适配器、状态与 UI 测试 |
| `src-tauri` | 窗口、系统接口、启动与消息转发 |
| `packages/backend` | XML、选择、转换会话、Java、日志和 RPC |
| `packages/guardian` | 后端与 worker 监督、健康和进程回收 |
| `packages/script-host` | 用户脚本上下文、树镜像与回调 |
| `packages/contracts` | JSON Schema、类型生成与协议样例 |
| `packages/ipc` | 有界字节帧与通信工具 |
| `packages/compat-service` | 三态选择、模式匹配及兼容数据语义 |
| `packages/packaging` / `packaging` | 清单、闭包、平台预检、打包与验证 |
| `tests` | 浏览器、桌面、转换和共享 fixtures |
| `.github/workflows` | CI、发行与 portable 构建 |

JS 依赖仅维护 `yarn.lock`；Rust 依赖维护 `Cargo.lock`。克隆后执行 `git lfs pull`，确认图标和媒体为真实文件。临时脚本与报告放入 `build/<task-name>/`，任务结束清理，密钥放入忽略提交的 `development/secret/`。

项目协议属于 xresconv-conf / xresloader，修改外部转换规范需在相应仓库处理。贡献时读取 [AGENTS.md](../../AGENTS.md)，设计与验证流程见[变更工作流](../ai/spec-driven-workflow.md)。
