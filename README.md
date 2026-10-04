# xresconv-gui

[![CI](https://github.com/xresloader/xresconv-gui/actions/workflows/ci.yml/badge.svg)](https://github.com/xresloader/xresconv-gui/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/xresloader/xresconv-gui)](https://github.com/xresloader/xresconv-gui/releases)
[![License](https://img.shields.io/github/license/xresloader/xresconv-gui)](LICENSE)

xresconv-gui 是符合 [xresconv-conf](https://github.com/xresloader/xresconv-conf) 规范的 GUI 批量转表工具，以 [xresloader](https://github.com/xresloader/xresloader) 为转换后端。支持 Windows、Linux、macOS 的 x64 和 ARM64 桌面环境。

应用使用 Tauri 2、系统 WebView 和独立 Node.js 业务进程，提供条目搜索、三态选择、多格式输出矩阵、命令预览、运行取消、日志筛选与导出、自定义脚本和显示设置。

界面支持英文、简体中文、繁体中文、日语、德语、法语和西班牙语，默认匹配系统语言，无匹配时使用英文；可在显示设置中切换并保存语言偏好。

## 下载与开始使用

在[发行页](https://github.com/xresloader/xresconv-gui/releases)选择与系统、架构匹配的包。

| 平台 | 系统要求 | 包格式与运行时 |
| --- | --- | --- |
| Windows | Windows 10 1809 或更高版本，64 位 | bootstrap / offline `.7z`；WebView2 |
| Linux | Ubuntu 22.04/24.04、Debian 12/13、Fedora 最近两个正式版本，64 位 | bootstrap / offline `.tar.zst`，offline `.AppImage`；WebKitGTK |
| macOS | macOS 13.5 或更高版本 | bootstrap `.dmg`；系统 WKWebView |

Windows/Linux 的 bootstrap 包复用系统 WebView，offline 包携带相应运行时。macOS 使用系统 WKWebView。包内已提供 Node.js，转换所需的 Java 与 xresloader JAR 由用户准备。

1. 解压归档或安装 DMG 中的应用，按[安装说明](docs/user/getting-started.md)检查环境。
2. 准备 xresconv-conf XML、表格和 xresloader JAR。
3. 打开 XML，检查工具路径、工作目录、协议和输出矩阵。
4. 勾选条目，预览命令后开始转换，在日志中查看结果。

![主界面](docs/media/main-light.png)

![转换流程](docs/media/workflow.gif)

## 文档

- [用户文档](docs/user/README.md)：安装、界面操作、配置、启动参数、选择器、脚本和故障排查。
- [开发文档](docs/development/README.md)：环境、架构、接口、配置与转换、前端、打包发布和测试。
- [完整文档索引](docs/README.md)：技术来源、Agent 规则、界面素材与图标资源。

## 开发

需要 Node.js 24+、Corepack、Rust 及平台原生构建依赖，详见[开发环境](docs/development/README.md)。JS 依赖统一使用 Yarn 4，版本由 `package.json` 的 `packageManager` 固定。

```sh
corepack yarn install --immutable
corepack yarn dev:desktop
```

构建应用使用 `corepack yarn build:desktop`；生成发行归档使用 `corepack yarn package:windows`、`package:linux` 或 `package:macos`。质量检查见[测试文档](docs/development/testing.md)。

## 相关项目

- [xresconv-conf](https://github.com/xresloader/xresconv-conf)：XML 配置规范与示例。
- [xresloader](https://github.com/xresloader/xresloader)：表格转换程序、协议和输出格式。
- [问题反馈](https://github.com/xresloader/xresconv-gui/issues)：请提供系统、应用版本、配置片段及相关日志，并去除敏感内容。

代码遵循 [MIT License](LICENSE)。
