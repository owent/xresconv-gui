# xresconv-gui

[![CI](https://github.com/xresloader/xresconv-gui/actions/workflows/ci.yml/badge.svg)](https://github.com/xresloader/xresconv-gui/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/xresloader/xresconv-gui?logo=github)](https://github.com/xresloader/xresconv-gui/releases)
[![Downloads](https://img.shields.io/github/downloads/xresloader/xresconv-gui/total?logo=github)](https://github.com/xresloader/xresconv-gui/releases)
[![License](https://img.shields.io/github/license/xresloader/xresconv-gui)](https://github.com/xresloader/xresconv-gui/blob/main/LICENSE)

[![Spec](https://img.shields.io/badge/Spec-xresconv--conf-informational?logo=github)](https://github.com/xresloader/xresconv-conf)
[![Backend](https://img.shields.io/badge/Backend-xresloader-important?logo=github)](https://github.com/xresloader/xresloader)
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Yarn](https://img.shields.io/badge/Yarn-4-2C8EBB?logo=yarn)](https://yarnpkg.com/)
[![Windows](https://img.shields.io/badge/Windows-0078D6?logo=windows&logoColor=white)]
[![Linux](https://img.shields.io/badge/Linux-FCC624?logo=linux&logoColor=black)]
[![macOS](https://img.shields.io/badge/macOS-000000?logo=apple&logoColor=white)]

[![Stars](https://img.shields.io/github/stars/xresloader/xresconv-gui?logo=github)](https://github.com/xresloader/xresconv-gui/stargazers)
[![Forks](https://img.shields.io/github/forks/xresloader/xresconv-gui?logo=github)](https://github.com/xresloader/xresconv-gui/forks)
[![Issues](https://img.shields.io/github/issues/xresloader/xresconv-gui?logo=github)](https://github.com/xresloader/xresconv-gui/issues)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?logo=github)](https://github.com/xresloader/xresconv-gui/pulls)
[![Contributors](https://img.shields.io/github/contributors/xresloader/xresconv-gui?logo=github)](https://github.com/xresloader/xresconv-gui/graphs/contributors)
[![Last Commit](https://img.shields.io/github/last-commit/xresloader/xresconv-gui?logo=git&color=orange)](https://github.com/xresloader/xresconv-gui/commits/main)

这是一个符合 [xresconv-conf](https://github.com/xresloader/xresconv-conf) 规范的GUI转表工具，并且使用 [xresloader](https://github.com/xresloader/xresloader) 作为数据导出工具后端。

3.0 起基于 **Tauri 2 桌面层 + 系统 WebView + 独立 Node.js 业务进程**（Tauri 负责窗口、系统接口、进程启动与消息转发；业务与脚本宿主由 Node.js/TypeScript 进程处理）。目标平台为 Windows 10+/主流 Linux 桌面（Ubuntu 22.04/24.04、Debian 12/13、Fedora 最近两个正式版）和 macOS 13.5+，仅 64 位。当前工作流覆盖各平台 x64/ARM64；已发布 dev.0 的 Windows/Linux 仍仅 x64，当前候选产物与运行验收见[执行进度](docs/plan/08-release-follow-up.md)。

## 下载和使用

在[发行页](https://github.com/xresloader/xresconv-gui/releases)选择与系统、架构匹配的包。当前自动化构建和本机测试不等于所有平台已完成实机验收；具体边界见[验收记录](docs/plan/records/P6-06.md)。

已发布的 [v3.0.0-dev.0](https://github.com/owent/xresconv-gui/releases/tag/v3.0.0-dev.0)
Windows 包实际为 bootstrap `.zip` / offline `.tar.zst`；下文的双 `.7z` 是当前源码的下一轮发行格式。
下载和解压时以对应 Release 的文件名为准；最新发布与验证范围见[发布核对记录](docs/plan/records/RELEASE-2026-10-03.md)。

Windows/Linux 发行目标区分 **bootstrap** 和 **offline** 两种变体，文件名中以
`-bootstrap` / `-offline` 区分（如 `xresconv-gui-<版本>-windows-x64-bootstrap.7z`、
`xresconv-gui-<版本>-windows-x64-offline.7z`）。两者应用功能完全相同，
区别仅在于对系统 WebView 运行时的准备方式：

| 变体 | 体积 | WebView 运行时 | 适用场景 |
| --- | --- | --- | --- |
| **bootstrap** | 较小 | 复用系统运行时；缺失时 Windows 提示手动运行包内 WebView2 安装器，Linux 预检提示安装 WebKitGTK | 有网络、系统已具备或可安装运行时 |
| **offline** | 较大 | Windows 包内含 WebView2 Fixed Version，Linux 包内含 WebKitGTK 闭包 | 无法联网或缺少 Windows/Linux 运行时的机器 |

macOS 使用系统 WKWebView，当前发行工作流仅提供每架构一个 **bootstrap DMG**，可离线运行；最低要求为 macOS 13.5，系统不足时须升级 OS。旧发行的 offline DMG 使用相同系统运行时，后续不重复发布。

> 归档格式：Windows 两种变体均为 `.7z`，用 7-Zip 等兼容工具解压后运行；
> Linux 提供 `.tar.zst`（用支持 zstd 的 tar 或 7-Zip 解压）和 offline AppImage；
> macOS 发行工作流提供 `.dmg`。Windows 归档需兼容 7z 的解压工具；Linux `.tar.zst` 需支持 zstd 的解压工具。

使用建议：

+ **大多数用户优先选 bootstrap**：体积小，现代 Windows 10/11 通常已预装
  WebView2、主流 Linux 桌面自带 WebKitGTK、macOS 使用系统 WKWebView，一般可直接运行。
+ Windows/Linux 目标机器 **无法联网**、位于隔离内网，或明确缺少对应运行时时选 **offline**，
  避免首次启动因缺少运行时而卡在联网引导步骤。
+ **macOS** 两种变体都只使用系统自带的 WKWebView（无独立可安装的 WebView 运行时）：
  bootstrap 在系统过旧时引导升级 macOS，offline 可在受支持系统（macOS 13.5+）上
  完全离线运行；低于最低版本的系统无法通过安装包补齐运行时，需先升级 macOS。

### 界面速览

3.0 新界面按 顶部配置工具栏 / 左侧转换列表 / 底部运行控制与日志 分区，支持：

+ 转换条目**搜索过滤**（保留已勾选状态）、分类展开/收起、全选/全不选；
+ **运行中取消**、重载配置、转换前**预览**计划与输出冲突提示；
+ 日志按级别/文本筛选、虚拟滚动大日志窗口、复制筛选结果与导出全部日志；
+ 明暗主题与跟随系统、字号调整（显示设置）；Java 环境与后端状态进入运行日志
  （不再是常驻状态条）。

### 启动参数

+ `--input <文件名>` : 指定初始的转表清单文件。
+ `--debug-mode` : 开启debug模式并启动开发人员工具。
+ `--custom-selector/--custom-button <json文件名>` : 增加自定义选择器,允许多个
+ `--log-configure <log设置文件 json文件名>` : 设置额外的log配置。设置文件结构请参见: <https://www.npmjs.com/package/log4js>

### 自定义选择器规则

文件必须是UTF-8编码

```json
{
    "name": "选择器按钮名称",                           // [必须] 按钮显示名称
    "by_schemes": [{                                    // [必须] item里配置file和scheme属性的选取规则（by_schemes和by_sheets里至少要配置一个）
        "file": "文件名, 比如: 资源转换示例.xlsx",      // [必须]
        "scheme": "转表规则名, 比如: scheme_upgrade"    // [可选] 此项可以为空，如果为空会命中所有file匹配的条目
    }],
    "by_sheets": [{                                     // [必须] item里的DataSource子节点配置DataSource的选取规则（by_schemes和by_sheets里至少要配置一个）
        "file": "文件名, 比如: 资源转换示例.xlsx",      // [必须]
        "sheet": "文件名, 比如: arr_in_arr"             // [可选] 此项可以为空，如果为空会命中所有DataSource中第一个选项和file匹配的条目
    }],
    "default_selected": false,                          // [可选] 默认选中
    "style": "outline-secondary",                       // [可选] 按钮Style。默认: outline-secondary
    // "action": ["unselect_all", "reload"]             // [可选] 特殊行为，具体内容请参考下面的文档。
}
```

以上 `file` 、 `scheme` 、 `sheet` 字段都支持 `完全匹配的名称` 、 `glob: 通配符` 和 `regex: 正则表达式` 三种形式。
按钮风格默认是 `outline-secondary` 。可选项为(详见: <https://getbootstrap.com/docs/5.0/components/buttons/>):

+ outline-primary
+ outline-secondary
+ outline-success
+ outline-danger
+ outline-warning
+ outline-info
+ outline-light
+ outline-dark
+ primary
+ secondary
+ success
+ danger
+ warning
+ info
+ light
+ dark

> Sample: 使用 [docs/custom-selector.json](docs/custom-selector.json) 和 <https://github.com/xresloader/xresconv-conf/blob/master/sample.xml> 里的配置，可以使用 `--custom-selector docs/custom-selector.json` 来启动。

特殊行为 **action** 字段的特殊功能:

+ `reload` : 重新加载自定义按钮
+ `select_all` : 全部选中
+ `unselect_all` : 全部反选
+ `script: <脚本名字>` : 执行脚本，**脚本名字** 为 `//root/gui/script` 节点的 `name` 属性。

## 示例

以下截图与动图均来自 3.0 新界面（真实发行包实拍：演示配置走真实 xresloader 转换，工程示例为真实项目配置加载）。

### 转换流程（勾选 → 转换前确认 → 真实转表 → 结果）

![转换流程](docs/media/workflow.gif)

![转换完成](docs/media/main-light.png)

### 界面与主题（显示设置、明暗主题、搜索过滤）

![界面与主题](docs/media/theme-ui.gif)

![真实工程-亮色](docs/media/real-project-light.png)

![真实工程-暗色](docs/media/real-project-dark.png)

### 详细配置与输出矩阵

![详细配置](docs/media/details.png)

![输出矩阵](docs/media/output-matrix.png)

### 脚本确认弹窗（on_before_convert 中的 alert_warning）

![脚本确认弹窗](docs/media/script-dialog.png)

自定义按钮启动示例: `./xresconv-gui.exe --custom-selector ./docs/custom-selector.json`

> 界面素材索引与更新方法见 [docs/media/README.md](docs/media/README.md)。

## 注意事项

1. 文件名最好全英文，因为GUI工具中的编码统一使用UTF-8，而Windows默认编码是GBK。如果转表工具也使用UTF-8的话Windows下会找不到中文文件名。

## 事件支持

2.1.0 版本开始增加了事件支持。事件格式如下：

```xml
<gui>
    <set_name description="设置转表项的名字字段，每个转表项会调用一次">
        // 事件代码脚本
    </set_name>
    <on_before_convert 
        name="事件名称(可选,如果设置了名称，可以在执行时选择是否关闭)" 
        checked="true/false(可选,默认是否选中/启用)" 
        mutable="true/false(可选,是否可修改选中/启用状态)" 
        type="text/javascript" timeout="超时时间（毫秒,默认: 30000）" description="开始转表前的事件回调函数，事件执行结束必须调用resolve()函数，以触发进行下一步">
        
    </on_before_convert>
    <on_after_convert 
        name="事件名称(可选,如果设置了名称，可以在执行时选择是否关闭)" 
        checked="true/false(可选,默认是否选中/启用)" 
        mutable="true/false(可选,是否可修改选中/启用状态)"
        type="text/javascript" timeout="超时时间（毫秒,默认: 30000）" description="转表结束后的事件回调函数，事件执行结束必须调用resolve()函数，以触发进行下一步">
        // 事件代码脚本
    </on_after_convert>
    <script name="自定义脚本" type="text/javascript" timeout="超时时间（毫秒,默认: 30000）">
        // 同上
        alert_warning("自定义脚本，可用于自定义按钮");
        resolve();
    </script>
</gui>
```

> 注: 事件的 `name` 、 `checked` 、 `mutable` 和自定义脚本的 `<script></script>` 标签需要版本 **>=2.3.0** 。

### **set_name** 事件

**set_name** 事件用户自定义修改转表结构树的显示，可用的接口如下:

```javascript
{
    work_dir: "当前配置下的执行xresloader的工作目录",
    configure_file: "当前配置XML路径",
    item_data: {
        id: id,
        file: "数据源文件",
        scheme: "数据源scheme表名",
        name: "描述名称",
        cat: "分类名称",
        options: ["额外选项"],
        desc: "描述信息",
        scheme_data: {"元数据Key": "元数据Value"},
        tags: ["tag列表"],     // 版本 >= 2.2.3
        classes: ["class列表"] // 版本 >= 2.2.3
    },
    data: {}， // 绑定在事件上的私有数据,可用于保存全局状态, 版本 >= 2.3.0
    alert_warning: function(content, title, options) {}, // 警告弹框， options 结构是 {yes: 点击是按钮回调, no: 点击否按钮回调, on_close: 关闭后回调}
    alert_error: function(content, title) {}, // 错误弹框
    log_info: function (content) {}, // 打印info日志
    log_notice: function (content) {}, // 打印notice日志, 版本 >= 2.3.0
    log_warning: function (content) {}, // 打印warning日志, 版本 >= 2.3.0
    log_error: function (content) {}, // 打印error日志
}
```

### **on_before_convert/on_after_convert** 事件

**on_before_convert/on_after_convert** 事件用于控制转表前操作和转表后操作，会按顺序执行。可用的接口如下:

```javascript
{
    work_dir: "执行xresloader的工作目录",
    xresloader_path: "xresloader目录",
    global_options: {"全局选项": "VALUE"},
    selected_nodes: ["选中要执行转表的节点集合"],
    selected_items: ["选中要执行转表的item对象集合,数据结构同上面的 item_data"], // 版本 >= 2.2.3
    run_seq: "执行序号",
    data: {}， // 绑定在事件上的私有数据,可用于保存全局状态, 版本 >= 2.3.0
    alert_warning: function(content, title, options) {}, // 警告弹框， options 结构是 {yes: 点击是按钮回调, no: 点击否按钮回调, on_close: 关闭后回调}
    alert_error: function(content, title) {}, // 错误弹框
    log_info: function (content) {}, // 打印info日志
    log_notice: function (content) {}, // 打印notice日志, 版本 >= 2.3.0
    log_warning: function (content) {}, // 打印warning日志, 版本 >= 2.3.0
    log_error: function (content) {}, // 打印error日志
    resolve: function (value) {}, // 通知上层执行结束,相当于Promise的resolve
    reject: function(reason) {}, // 通知上层执行失败,相当于Promise的reject
    require: function (name) {} // 相当于 nodejs的 require(name) 用于导入nodejs 模块
}
```

### 自定义脚本 **script**

在自定义脚本 **script** 中，可用的接口如下:

```javascript
{
    work_dir: "执行xresloader的工作目录",
    xresloader_path: "xresloader目录",
    global_options: {"全局选项": "VALUE"},
    selected_nodes: ["选中要执行转表的节点集合"],
    selected_items: ["选中要执行转表的item对象集合,数据结构同上面的 item_data"],
    data: {}， // 绑定在按钮上的私有数据,可用于保存全局状态
    alert_warning: function(content, title, options) {}, // 警告弹框， options 结构是 {yes: 点击是按钮回调, no: 点击否按钮回调, on_close: 关闭后回调}
    alert_error: function(content, title) {}, // 错误弹框
    log_info: function (content) {}, // 打印info日志
    log_notice: function (content) {}, // 打印notice日志
    log_warning: function (content) {}, // 打印warning日志
    log_error: function (content) {}, // 打印error日志
    resolve: function (value) {}, // 通知上层执行结束,相当于Promise的resolve
    reject: function(reason) {}, // 通知上层执行失败,相当于Promise的reject
    require: function (name) {} // 相当于 nodejs的 require(name) 用于导入nodejs 模块
}
```

### **on_append_log** 事件

日志Hook回调 **on_append_log** 事件（2.5.0 版本开始）用于抓取和控制日志输出。可用的接口如下：

```javascript
{
    work_dir: "执行xresloader的工作目录",
    xresloader_path: "xresloader目录",
    global_options: {"全局选项": "VALUE"},
    selected_nodes: ["选中要执行转表的节点集合"],
    selected_items: ["选中要执行转表的item对象集合,数据结构同上面的 item_data"],
    data: {
        message: "原始日志正文",
        module_name: "模块名，可能为空",
        style: "输出格式", // alert-primary, alert-secondary, alert-warning, alert-danger, alert-compact
    }， // 绑定在按钮上的私有数据,可用于保存全局状态
    alert_warning: function(content, title, options) {}, // 警告弹框， options 结构是 {yes: 点击是按钮回调, no: 点击否按钮回调, on_close: 关闭后回调}
    alert_error: function(content, title) {}, // 错误弹框
    log_info: function (content) {}, // 打印info日志
    log_notice: function (content) {}, // 打印notice日志
    log_warning: function (content) {}, // 打印warning日志
    log_error: function (content) {}, // 打印error日志
    require: function (name) {} // 相当于 nodejs的 require(name) 用于导入nodejs 模块
}
```

此接口可以通过修改 `data` 内的数据修改输出的日志内容和样式。但是此接口不会排队执行。

## 已知问题

### 用户脚本崩溃隔离（3.0 已修复）

3.0 起用户脚本运行在独立的受监督 Node 进程中：脚本抛未捕获异常、死循环、
`process.exit` 或内存耗尽只会终止该脚本会话，GUI 与当前任务可正常收尾并给出
可行动诊断（外部硬截止由独立 guardian 进程保证），不再导致 GUI 白屏或主进程退出。
2.x 及更早版本中，脚本回调未捕获异常会传递到 GUI 层导致白屏；旧版用户请确保
这类调用用 try 包裹并调用 `reject("错误消息")` 接口。

## 开发使用说明

以下内容仅是对这个工具的开发和维护进行说明，直接使用的话[下载发布包](https://github.com/xresloader/xresconv-gui/releases)即可。

### 环境准备

1. 安装 Node.js LTS（>=24）与 Rust stable（构建 Tauri 桌面层）；Windows 另需
   WebView2 运行时（一般系统自带），Linux 需 WebKitGTK 4.1 开发包
   （`libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`）。
1. 包管理器为 **Yarn 4**（Corepack 提供，仓库 `packageManager` 字段锁定版本）：

```bash
corepack yarn install      # 安装依赖（唯一 JS 锁文件 yarn.lock）
```

### 直接启动（开发模式）

```bash
corepack yarn dev:desktop   # tauri dev：前端热更新 + 调试桌面程序
```

### 调试

+ 前端/业务内核（TypeScript）：`dev:desktop` 下使用浏览器开发者工具
  （`--debug-mode` 启动参数自动打开）；Node 内核为独立进程，可在
  VSCode 以 Attach 方式调试。
+ Tauri 桌面层（Rust）：`RUST_LOG=trace corepack yarn dev:desktop`。

### 质量门禁与测试

```bash
corepack yarn lint          # Biome + markdownlint
corepack yarn typecheck     # 全 workspace TypeScript
corepack yarn test:unit     # Node/前端单元（backend/guardian/contracts/ipc/packaging/script-host/desktop）
corepack yarn test:contracts
corepack yarn test:browser  # Playwright 三引擎（chromium/firefox/webkit）
corepack yarn test:desktop  # Windows/Linux：tauri-driver；Windows 另设 MSEDGEDRIVER_PATH，
                            # 与 WebView2 版本匹配；macOS：debug e2e feature 嵌入 WKWebView 驱动
corepack yarn test:conversion  # 真实 JAR 八格式 stdin vs argv 差分（相邻 ../xresloader/target
                               # 有多个匹配 JAR 时须显式 XRESCONV_TEST_JAR，缺件 exit 2）
corepack yarn check:shell   # Tauri 桌面层 clippy（-D warnings）
corepack yarn test:shell    # Tauri 桌面层单元测试
```

## 打包和发布

```bash
corepack yarn package:windows   # Windows x64：bootstrap/offline 均为 7z（Windows 运行，构建需 7-Zip）
corepack yarn package:linux     # Linux tar.zst 双变体（bootstrap/offline + offline AppImage；Linux 运行）
corepack yarn package:macos     # macOS 双变体 DMG（须在 mac 主机运行）
corepack yarn package:windows --cross --arch=arm64 --variant=all
corepack yarn package:linux --cross --arch=aarch64 --variant=all --distro=ubuntu-22.04
```

交叉打包须配置对应 Rust 目标与平台 C/C++ 库；Linux ARM AppImage 还需要 ARM 主机或模拟器中的完整 ARM 用户空间完成打包，x64 容器仅装 ARM 开发库不足以收集离线依赖。目标 Node 来自与宿主同版本的官方归档，经 SHA-256 校验；原生模块按目标架构筛选。配置与本轮实际流程见[发行约定](docs/plan/05-packaging-release.md)。

`corepack yarn verify:portable --os=windows --arch=x64 --variant=bootstrap` 可核验 Windows 7z；macOS/Linux 使用对应 OS/架构参数。Windows 交叉包可加 `--static-only`，不执行目标程序。手动或 `build/validate-*` 分支构建只上传 Actions 产物；只有 v3 tag push 才创建 draft Release。

Windows offline 默认保留完整运行时；两种 Windows 包均使用 7z 最高压缩级别。Linux tar.zst 使用 zstd L19 + 128 MiB 长窗口压缩。
可选 `corepack yarn package:windows --variant=offline --webview-locales=mainstream`
保留英、简中、繁中、日、韩、德、法、西、巴葡、俄十种运行时语言；不支持的语言
由 WebView2 回退到可用语言，保留英文兜底。`--webview-locales=all` 恢复完整资源。
裁剪为本项目验证的可选方案，微软没有提供支持承诺；不影响应用本身的中文界面。
同负载实测与适用边界见 [发行尺寸审查](docs/plan/records/REVIEW-2026-09-29.md)。

产物按 `packaging/targets.json` 矩阵命名并附带 SHA-256 边车；签名可经环境变量
注入（`XRESCONV_SIGN_CERT_THUMBPRINT` 等，见 `docs/plan/records/P5-07.md`），
密钥不进仓库。

## 迁移与回滚

+ 3.0 起为全新架构；Windows ia32 与 Linux armv7l 不再提供（2.6.0 为终点版本，
  见 [v2.6.0 Release](https://github.com/owent/xresconv-gui/releases/tag/v2.6.0)）。
+ 配置文件格式（xresconv-conf XML）、启动参数、自定义选择器/按钮与五类用户脚本
  接口保持兼容；仅依赖 DOM/jQuery/Fancytree 内部对象的脚本不受支持（会给出
  迁移诊断）。
+ 如需回滚，直接安装旧版发布包即可；两代版本无共享系统状态。

## 关于NPM下载加速

1. 关闭npm的https

> `npm config set strict-ssl false`

1. 设置npm的软件源

> `npm config set registry http://registry.npmjs.org/`
> `npm config set registry https://mirrors.tencent.com/npm/`
> `npm config set registry https://registry.npmmirror.com/`

1. 代理

> + 设置代理： `npm config set proxy=http://代理服务器ip:代理服务器端口`
> + 取消代理： `npm config delete http-proxy`
> + 取消代理： `npm config delete https-proxy`

1. 信任通用HTTP缓存服务（比如Squid）的CA证书

```powershell
$env:NODE_EXTRA_CA_CERTS = "D:/workspace/root-ca.crt"
```
