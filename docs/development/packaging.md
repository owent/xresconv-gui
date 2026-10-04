# 打包与发布

## 目标矩阵

[packaging/targets.json](../../packaging/targets.json) 定义系统、架构、变体、Rust target、Node 与 WebView 策略，[targets.schema.json](../../packaging/schema/targets.schema.json) 校验其结构。架构命名统一为 x64 / arm64，Linux 文件名使用 x86_64 / aarch64。

| 系统 | 基线 | 变体 | 正式发行 |
| --- | --- | --- | --- |
| Windows | Windows 10 1809，Node 24，WebView2 120+ | bootstrap / offline | 每架构两种 `.7z` |
| Linux | Ubuntu 22.04 / glibc 2.35，Node 24，WebKitGTK 4.1 | bootstrap / offline | 每架构 bootstrap `.tar.zst`、offline `.tar.zst` / `.AppImage` |
| macOS | macOS 13.5，Node 24，系统 WKWebView | 构建接口接受 bootstrap / offline | 每架构 bootstrap `.dmg` |

矩阵包含 12 个可构建目标。正式发行去除功能相同的 macOS offline 目标，共 10 个目标、12 个应用文件，另附校验和与发行清单。构建支持与运行验证分别判断，静态架构检查不能证明目标程序已经运行。

## 构建命令

```sh
corepack yarn package:windows --variant=bootstrap --arch=x64
corepack yarn package:windows --variant=offline --arch=arm64 --cross
corepack yarn package:linux --variant=offline --arch=x86_64
corepack yarn package:macos --variant=bootstrap --arch=arm64
```

默认架构为宿主，指定其他架构必须显式 `--cross`。打包入口、参数和复用校验见 [package-cli.ts](../../packages/packaging/src/package-cli.ts)。产物位于 `build/dist`，临时组装目录位于 `build`。

`--portable` 生成可解压测试介质：Windows 仍为 `.7z`，Linux 为 `.tar.zst` / `.AppImage`，macOS 为未签名 `.app.zip`。macOS portable workflow 使用 offline 目标，运行时同样来自系统 WKWebView。

`--skip-assemble` 要求显式变体，复用前验证目标身份、版本、sourceCommit 与文件摘要，不能把编辑后的布局当作有效缓存。

## 发行布局与闭包

每个布局包含目标 Node、应用 workspaces、生产模块、原生模块、平台资源和 `runtime-manifest.json`。清单记录应用版本、sourceCommit、目标身份、Node ABI、运行时策略及文件 SHA-256。

目标 Node 来自官方发行归档，校验 SHA-256，并从目标 headers 获取 ABI。不能用宿主 Node 或宿主原生模块代替目标文件；跨架构静态验证检查 PE、ELF 或 Mach-O 头。模块闭包保留脚本 `require` 使用的动态依赖，按目标筛选 optional 原生包。SBOM 与第三方许可由实际闭包生成。

Windows 组装保留 GUI 程序、Node、WebView2Loader 与完整资源布局。bootstrap 附 Evergreen bootstrapper，offline 含 Fixed Version；运行时优先使用满足要求的系统 Evergreen。

Linux offline AppDir 将 payload 放入 `usr/share/xresconv-gui`，同时组织 WebKitGTK 依赖、启动器和 `xdg-open`。bootstrap 先运行纯 shell 预检再启动动态链接程序。构建基线必须保持 glibc 兼容，不能由新宿主系统链接后宣称兼容旧基线。

macOS 布局位于 `.app` 内，正式包为 DMG。签名与 notarization 配置由打包环境提供，密钥和证书不进入源码或日志，最终介质按实际签名状态分发。

## 压缩与语言资源

Windows 使用 7-Zip 生成 `.7z`，构建需安装工具，用户需兼容解压工具。Linux 使用 tar 文件再调用外部 zstd 的两步流程，显式压缩级别、线程和窗口设置，完成后校验并发布。大包压缩必须用真实负载验证解压和摘要。

Windows offline 默认保留全部 WebView2 语言资源。只有显式 `--webview-locales=mainstream` 才裁剪语言，保留 en-US、zh-CN、zh-TW、ja、ko、de、fr、es、pt-BR、ru；运行时版本或资源布局变化时重新验证，ICU 基础数据保持完整。

## 产物验证

```sh
corepack yarn verify:portable --os=windows --arch=x64 --variant=bootstrap
corepack yarn verify:portable --os=linux --arch=x86_64 --variant=offline
corepack yarn verify:portable --os=macos --arch=arm64 --variant=offline
```

验证覆盖归档结构、目标身份、摘要、二进制头及允许环境中的启动和转换。Windows 交叉包可用 `--static-only`，结果仅代表静态检查。其他平台验证需要相应系统，macOS 包不能由 Windows 上的静态读取代替运行验收。

## 工作流和发布

[ci.yml](../../.github/workflows/ci.yml) 执行质量与交互测试，[portable-build.yml](../../.github/workflows/portable-build.yml) 构建 portable 介质，[release.yml](../../.github/workflows/release.yml) 构建并聚合正式目标。JS 安装统一使用 [setup-yarn action](../../.github/actions/setup-yarn/README.md)，始终执行 immutable 安装。

手动 workflow 和 `build/validate-*` 仅构建，写 GitHub Release 只接受 `v3` tag。聚合验证目标与产物的精确集合，不能只数文件。已存在的同名资产需要下载核对摘要，不匹配时失败，不能以“跳过上传”证明资产属于当前源码。

发布前分别核对 tag 指向、下载包 sourceCommit、摘要和候选源码。构建、安装、运行与发布是独立事实，验证输出应准确说明执行范围。
