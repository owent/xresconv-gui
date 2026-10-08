# 安装与开始使用

## 平台和包选择

从[发行页](https://github.com/xresloader/xresconv-gui/releases)下载对应系统与架构的包。x64 用于 Intel/AMD 64 位桌面，ARM64 用于相应 ARM 设备。

| 平台 | 最低要求 | 可用包 |
| --- | --- | --- |
| Windows | Windows 10 1809，x64/ARM64 | bootstrap `.7z`、offline `.7z` |
| Linux | Ubuntu 22.04/24.04、Debian 12/13、Fedora 最近两个正式版本，x64/ARM64 | bootstrap `.tar.zst`、offline `.tar.zst` / `.AppImage` |
| macOS | macOS 13.5，x64/ARM64 | bootstrap `.dmg` |

Windows/Linux 系统已具备 WebView 时可使用体积较小的 bootstrap 包，需要随包提供运行时时使用 offline 包。offline 指桌面运行时随包提供，项目脚本或转换任务是否需要网络由项目本身决定。包内包含 Node.js，用户无需另装；Java 与 xresloader JAR 需要单独准备。

## 安装和启动

首次启动时，窗口显示应用资源的校验和解压进度。资源解压到系统应用缓存目录，完成后进入转换工作台；后续启动复用已校验的缓存。版本更新或资源包变化时，应用先完整删除旧资源缓存，再解压新资源，用户配置和显示设置不受影响。

若提示缓存正在被使用，请关闭旧版本的应用窗口后点击“重试”。清理或解压失败时，界面显示原因并提供重试入口，资源准备完成前不会启动转换业务。

### Windows

用支持 7z 的工具解压整个归档，保持目录结构，运行 `xresconv-gui.exe`。应用优先使用符合要求的系统 WebView2；offline 包可回退到内置 Fixed Version 运行时。

bootstrap 包若提示缺少 WebView2，运行包内提供的 bootstrapper，安装后重新启动应用。安装器下载运行时需要网络。应用要求 WebView2 120 或更高版本。

### Linux

解压 `.tar.zst` 后通过包内启动入口运行，保持 Node.js、资源目录和预检脚本的相对位置。bootstrap 需要系统 WebKitGTK 4.1、GTK 3 与 libsoup 3；预检输出适合当前发行版的安装指引，只有显式安装选项或交互确认后才调用系统包管理器。

offline 包携带 WebKitGTK 依赖闭包，仍要求受支持的 Linux 系统基础环境。AppImage 需具有执行权限，并要求系统具备相应挂载支持；无法挂载时可使用 offline `.tar.zst`。

### macOS

打开 DMG，将应用复制到 Applications 后启动。应用使用系统 WKWebView，低于 macOS 13.5 时需升级系统。系统对下载应用的检查和允许方式取决于文件签名与本机策略，遇到启动提示时查看系统给出的具体原因。

## 准备转换环境

安装与所用 xresloader JAR 兼容的 Java，确认在启动应用的环境中执行 `java -version` 能找到它。JDK 版本要求由 xresloader 决定。

项目应包含 UTF-8 编码的 xresconv-conf XML、引用的表格与协议文件、包含文件与脚本模块、xresloader JAR，以及可写的输出目录。在 XML 或界面中设置工作目录、JAR 路径、协议和输出目录，加载后先检查预览。

GUI、XML 和脚本文件统一使用 UTF-8。Windows 默认代码页可能为 GBK，建议使用便于跨平台处理的文件名。

## 第一次转换

打开配置，检查条目和输出矩阵，勾选所需条目。预览显示转换参数与输出冲突提示。开始转换后观察状态和日志，结束后检查输出文件。需要中止时使用“取消”，等待进程与脚本收尾后再开始下一次运行。

详细操作见[界面说明](interface.md)，配置结构见[配置说明](configuration.md)。
