# 更新记录

## 3.1.0

- 将应用业务代码、生产依赖和 Schema 收入单一 `app-resources.zip`，发行目录不再复制散落的应用文件。
- 启动时显示校验、旧缓存清理和解压进度，按版本与资源包摘要复用唯一缓存；更新时完整删除旧资源缓存后再解压。
- 缓存损坏或不完整时重建；旧实例占用、删除或解压失败时阻止业务启动并提供重试入口。

## 3.0.0

### 架构与运行环境

- 桌面架构由 Electron 改为 Tauri 2 + 系统 WebView + 独立 Node.js 业务进程，界面使用 React 19 和 TypeScript。
- 支持 Windows、Linux、macOS 的 x64/ARM64。Windows 最低为 Windows 10 1809，macOS 最低为 13.5；Linux 基线与依赖见[安装说明](docs/user/getting-started.md#平台和包选择)。3.0.0 不再提供 32 位构建。
- 发行包内置 Node.js 24，用户只需另外准备与项目匹配的 Java 和 xresloader JAR。
- 增加 guardian 进程监督和带校验的 IPC，将配置解析、自定义脚本及 log4js 扩展放入独立进程，处理超时、异常、失联与取消，并回收所属子进程。
- Windows 桌面程序及后台业务进程使用无控制台启动方式，避免运行和转换时弹出命令窗口。

### 界面与操作

- 增加统一多语言机制，提供英文、简体中文、繁体中文、日语、德语、法语和西班牙语；自动匹配系统语言，未匹配时回退英文，支持即时切换与偏好持久化，同步翻译无障碍名称和原生文件对话框标题。
- 重写转换界面，提供三态树勾选、分组展开与收起、搜索、键盘操作和条目详情。搜索过滤可见内容时保留已选状态，不可选条目不参与全选。
- 支持打开、重载配置和取消运行；配置加载失败保留已加载会话，取消后等待脚本与转换进程收尾，再进行下一次操作。
- 提供工具与路径设置、输出矩阵编辑、转换命令与输出路径预览，以及输出冲突提示。每种输出格式可独立设置重命名规则和 `output_dir`。
- 支持并行转换，并行度默认为 4，可在 1–16 范围调整；界面显示运行阶段、批次结果与已提交任务数。
- 增加亮色、暗色、跟随系统、字号和字体设置，并保存显示偏好。Windows 通过原生 WebView2 接口允许当前应用来源读取本机字体，打开字体设置无需重复确认；枚举失败时保留预设字体和手动输入。
- 日志支持级别与文本筛选、虚拟滚动、复制及按当前筛选条件导出；显示 Java 诊断、脚本错误、后台故障和日志过载提示。

### 配置、转换与自定义脚本

- 保留 xresconv-conf XML、默认 scheme、多协议文件、多数据源目录、输出矩阵及 tag/class 选择条件，继续支持 `--input`、`--custom-selector` / `--custom-button`、`--log-configure` 和 `--debug-mode`。
- 严格校验 UTF-8 与 XML，按包含文件的声明位置解析相对路径，通过实际路径识别重复和循环包含，并限制输入大小、嵌套深度和解析时间。
- 使用参数数组启动 Java，支持 xresloader stdin 批量协议和 argv 回退；处理输出背压、分块 UTF-8 日志及进程退出收尾。
- 保留 `set_name`、转换前后事件、命名按钮脚本和日志处理钩子，以及 `resolve()` / `reject()`、日志与弹窗回调约定；同按钮连续调用共享 `data`。
- 运行开始时固定本次选择集合，转换前事件结束后构造命令，脚本对条目字段的修改作用于当前转换；勾选变化影响后续事件及下次运行。
- 为脚本提供树节点镜像及受支持的查询、选择和展开接口，校验会话和树版本，拒绝失效修改及过期弹窗回调。
- 脚本模块以配置目录解析，支持 Node 内置模块、项目依赖和发行包模块。迁移已有脚本时需调整 DOM、jQuery、Electron 和动态增删树节点的用法，接口边界见[脚本说明](docs/user/scripts.md)。
- 自定义选择器支持 scheme / DataSource 匹配、glob、正则及顺序动作链；按钮可执行选择、重载选择器和命名脚本，失败或拒绝时中止动作链。
- log4js 文件日志与自定义 appender 在独立进程执行，增加写入队列和关闭期限，报告持久化失败及丢弃数量。

### 打包与发布

- Windows bootstrap/offline 均使用 `.7z`。bootstrap 附 WebView2 引导安装器，offline 内置 Fixed Version 运行时；应用优先使用满足要求的系统 WebView2。
- Windows offline 默认保留全部运行时语言资源，可显式使用 `--webview-locales=mainstream` 裁剪为十种主流语言。
- Linux 提供 bootstrap/offline `.tar.zst` 和 offline `.AppImage`；bootstrap 使用系统 WebKitGTK 4.1 并提供依赖预检，offline 携带运行时依赖，不再提供 deb/rpm。
- macOS 正式发行使用 `.dmg` 和系统 WKWebView；portable 测试构建提供未签名 `.app.zip`。
- 统一目标矩阵、归档命名和 SHA-256 校验，发行布局记录版本、源码提交、目标架构、Node ABI 与文件摘要，并按实际依赖生成 SBOM 和第三方许可。
- 增加目标架构的 Node 与原生模块校验、portable 介质验证和发布资产核对；同系统跨架构打包需显式指定 `--cross --arch`。

### 开发与文档

- 代码整理为桌面应用、业务后端、guardian、契约、IPC、脚本执行、兼容服务和打包 workspaces；JSON Schema 统一维护接口并生成类型。
- 开发环境统一使用 Node.js >=24、Corepack 和 Yarn 4，以 `yarn.lock` 管理 JS 依赖；Rust 工具链由仓库配置固定。
- 完善单元与契约测试、Rust 检查、三引擎浏览器测试、桌面 E2E、真实 JAR 的 argv/stdin 八格式差分和发行介质验证，CI 使用锁定依赖安装。
- 重写[用户文档](docs/user/README.md)和[开发文档](docs/development/README.md)，按操作、配置、脚本、架构、接口、打包和测试组织，并增加 Markdown 格式与本地链接检查。

## 3.0.0-dev.1

1. 架构重写：以 Tauri 2 壳 + 系统 WebView + 独立 Node.js 业务内核替代旧 Electron 架构，支持 Windows / Linux / macOS（64 位）。
2. 发行包全部为解压即用形态：Windows bootstrap/offline 均为 7z（bootstrap 依赖系统 WebView2 并附引导安装器；offline 内嵌 WebView2 Fixed Version 运行时，可选十种主流语言）；Linux 为 zstd L19 压缩的 tar.zst 双变体（bootstrap 依赖系统 WebKitGTK、offline 自含）+ offline AppImage 并存，不再提供 deb/rpm；macOS 为 DMG。
3. 首个 3.0 开发预发布版本，仅供测试。

## 2.6.0

1. 更新依赖库。
2. 输出矩阵支持设置 `output_dir` 。

## 2.5.5

1. 更新依赖库。
2. 修复一处颜色代码转义错误的问题。

## 2.5.4

1. 更新依赖库。
2. 增加一处关于异常隔离的文档说明。
3. 更新和修复新版本 `@electron/packager` 的接口变化。

## 2.5.3

1. 修复文档。
2. 移除无效的签名。
3. 更新依赖库。

## 2.5.2

1. 修复 `alert_error` 和 `alert_warning` 接口的模态对话框。
2. 支持解析xresloader的warning日志。
3. 修复log文件的输出被转义的问题。

## 2.5.1

1. 调试选项 `--debug` 改为 `--debug-mode` 以适配冲突。
2. 修复 `--input` 失效的问题。

## 2.5.0

1. 修订多行输出
2. 更新依赖库

> - adm-zip      ^0.5.10  →  ^0.5.16
> - compressing  ^1.10.0  →  ^1.10.1
> - electron     ^29.1.0  →  ^32.0.2
> - gulp          ^4.0.2  →   ^5.0.0
> - minimatch     ^9.0.3  →  ^10.0.1

## 2.4.2

1. 更新依赖包
2. 修正转表清单中只有一个规则切有限定Tag/Class时，默认仍然能选中不满足条件的转表项的问题
3. 候选项不满足自定义转表规则里的任何输出矩阵条目，不再允许选中

## 2.4.1

1. 支持多个 `data_src_dir` 配置
2. 修复多输出的hint提示
3. 修复多次点击重置按钮不会消除老窗口的BUG

## 2.4.0

1. 支持多个 `proto_file` 配置
2. 更新依赖库

  > - @popperjs/core     ^2.11.6  →  ^2.11.8
  > - bootstrap           ^5.2.1  →   ^5.3.0
  > - electron           ^20.1.4  →  ^25.2.0
  > - electron-packager  ^16.0.0  →  ^17.1.1
  > - jquery              ^3.6.1  →   ^3.7.0
  > - jquery.fancytree   ^2.38.2  →  ^2.38.3
  > - log4js              ^6.6.1  →   ^6.9.1
  > - minimatch           ^5.1.0  →   ^9.0.3

## 2.3.0-rc5

1. 修复一些日志输出布局异常
2. 优化高分辨率下的响应式布局
3. 更新依赖库

  > - @popperjs/core -> 2.11.5
  > - jquery.fancytree -> 2.38.1
  > - log4js -> 6.5.2
  > - electron -> 19.0.6
  > - minimatch -> 5.1.0
  > - electron-packer -> 15.5.1

## 2.3.0-rc4

1. 启动日志输出GUI工具的版本号
2. 调整样式，现在更紧凑一些
3. 更新依赖库

  > - electron -> 16.0.7
  > - bootstrap -> 5.1.3
  > - popperjs -> 2.38.0
  > - electron-packer -> 2.11.2

## 2.3.0-rc3

1. 修复 [\#12](https://github.com/xresloader/xresconv-gui/issues/12)

## 2.3.0-rc2

1. 增加 `--log-configure` 选项，用于指定log4js日志配置。增加默认的本地文件日志。
2. 修复配置文件过大被拆分的BUG
3. 更新依赖库

  > - electron -> 14.0.0
  > - bootstrap -> 5.1.0
  > - jquery.fancytree -> 2.38.0
  > - electron-packer -> 15.3.0

## 2.3.0-rc1

1. 更新依赖库

   > - electron -> 11.1.1
   > - bootstrap -> 5.0.0-beta1
   > - jquery.fancytree -> 2.37.0
   > - electron-packer -> 15.2.0
   > - popper.js 替换为 @popperjs/core

2. 增加命令行选项 ```--custom-selector/--custom-button <json文件名>``` 用于增加自定义选择器
3. 允许事件可勾选是否执行
4. 转表前事件和转表后事件增加允许在面板中设置开启货关闭，新属性如下:

   > - ```name``` : 显示名称
   > - ```checked``` : 默认选中/启用
   > - ```mutable``` : 是否可以修改选中/启用状态

## 2.2.4

1. Fix icon loading error for darwin platform.

## 2.2.3

1. 优化错误提示
2. 修复子进程事件错误导致可能捕获不到子进程退出的BUG
3. 换一种reload的实现，原先的 ```BrowserWindow.reload()``` 未知原因会导致子进程退出事件丢失
4. 增加 ```on_before_convert``` 和 ```on_after_convert``` 事件的```selected_items```传入数据，包含 ```{id, file, scheme, name, cat, options: [], desc, scheme_data: {}}``` 用于指示选中的节点信息
5. 修复自定义事件 ```reject``` 之后没有显示成错误的BUG。

## 2.2.2

1. 修复一处自定义option传参错误
2. 修复重置按钮某些情况下会失效的BUG
3. 更新依赖库

  > electron -> 9.0.0
  > jquery -> 3.5.1
  > bootstrap -> 4.5.0

## 2.2.1

1. 更新依赖库
2. 切换到```Github Action```
3. 更换图标
4. 构建工具切换为```yarn```

## 2.2.0

1. 支持多个 ```<output_type></output_type>``` 参数，支持给每个 output_type 单独设置 rename 规则
2. set_name 事件增加 alert_warning(text)/alert_error(text)/log_info(text)/log_error(text) 函数
3. set_name 事件增加 work_dir 变量和 configure_file 变量
4. on_before_convert/on_after_convert 事件增加 configure_file 变量
5. 采用Promise重构建立节点树的的流程
6. 更新依赖库

  > electron -> 6.0.7
  > electron-packager -> 14.0.5
  > gulp -> 4.0.2

## 2.1.1

1. 修复重命名模板的转义问题

## 2.1.0

1. 更新依赖库到当前最新版本release（2019-04-18）
2. 支持xresloader 2.0.0的输出类型
3. 修复未知的输出目标会导致加载失败的问题
4. 增加事件支持 ```<on_before_convert>NODEJS CODE...</on_before_convert>``` 和 ```<on_after_convert>NODEJS CODE...</on_after_convert>```
5. 采用Promise模型重构执行任务链
6. 增加CI的自动发布流程
7. ```<set_name></set_name>``` 事件改为直接运行，不再需要返回一个function并且在沙箱环境中运行
8. 增加启动参数 ```--input <文件名>``` 用以支持设置初始加载的转表清单配置

## 1.4.2

1. 增加java环境检测脚本
2. 升级electron到2.0.4
3. 更新依赖库到当前最新版本release（2018-07-04）

## 1.4.1

1. 更新依赖库到当前最新版本release（2018-03-08）
2. 移除jQuery UI
3. 移除electron-prebuilt，使用electron来执行打包盒开发环境启动
4. 升级jQuery到3.3.1
5. 升级bootstrap到4.0.0
6. 升级electron到1.8.3
7. 升级jquery.fancytree到2.28.0
8. 升级popper.js到1.13.0
9. 升级electron-packager到11.1.0
10. 界面同步优化成bootstrap4
11. 优化打包方式

    - 使用标准的node_modules路径并排除开发工具依赖（解决electron会重置模块搜索目录的问题）
    - 使用asar打包资源文件

## 1.4.0

1. 更新依赖库到当前最新版本release（2017-11-02）
2. 支持设置数据版本号(需要xresloader版本1.4.0或以上)

## 1.3.1

1. 修复使用boostrap 4之后漏打包tether的问题
2. 修复插件脚本崩溃会导致功能不正常，并且没有报错的问题

## 1.3.0

1. 支持预置scheme参数
2. 更新electron到1.4.12
3. 更新npm维护的库-20161211

## 1.2.2

1. 支持设置java选项
2. 更新electron到1.4.10
3. jquery/bootstrap/jquery.fancytree 采用npm维护版本
4. jquery-ui升级到1.12.0
5. 完全使用gulp复制依赖项

## 1.2.1

1. 支持新版本xresloader对web工具输出shell颜色代码
2. 更新[Electron](http://electron.atom.io)到1.2.5
3. 更新[Electron-Packager](https://github.com/electron-userland/electron-packager)到7.1.0

## 1.2.0

1. 使用[Electron](http://electron.atom.io)重新构建，不再使用[nw.js](http://nwjs.io/)。后者的官方打包脚本问题比较多。
2. 循环加载的xml文件判定改为使用绝对路径而不是之前的文件名判定
3. 版本号规则使用node.js的package的三段式

## 1.1.4.0

1. 增加javascript的导出支持
2. 更新nwjs到0.13.3

## 1.1.3.0

1. 接入新的返回码定义
2. 更新bootstrap到3.3.6
3. 更新jquery到2.2.0
4. 更新fancytree到2.15.0
5. 修正转表完成后日志滚动条没有自动滚到最下方的问题
6. 增加控制台提示性边框

## 1.1.2.1

1. 修复Windows下的一些乱码问题

## 1.1.2.0

1. 跟进支持xresloader的多表转换功能，拥有更快的转换速度并消耗更低的资源
2. 修复加载不同转表文件时载入错误的问题
3. 增加重置按钮（刷新页面）

## 1.1.1.1

1. 修复转表结束提示错误

## 1.1.1.0

1. 增加并行转表的功能
