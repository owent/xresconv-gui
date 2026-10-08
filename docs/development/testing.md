# 测试

## 质量入口

从仓库根目录使用 Corepack/Yarn，依赖安装须遵守锁文件。按改动涉及的边界选择检查：

| 命令 | 覆盖范围 |
| --- | --- |
| `corepack yarn lint` | JS/TS 静态规则和文档格式、链接 |
| `corepack yarn test:docs` | 文档链接检查器回归 |
| `corepack yarn typecheck` | 所有应用 workspaces 的类型 |
| `corepack yarn test:unit` | workspaces 单元与集成测试 |
| `corepack yarn test:contracts` | Schema、类型和协议样例 |
| `corepack yarn check:shell` | Rust clippy，告警视为失败 |
| `corepack yarn test:shell` | Tauri 桌面层 Cargo 测试 |
| `corepack yarn test:browser` | 生产前端的 Chromium / Firefox / WebKit 测试 |
| `corepack yarn test:desktop` | 真实桌面 WebView、原生接口与业务链路 |
| `corepack yarn test:conversion` | 真实 JAR 的 argv / stdin 差分 |
| `corepack yarn verify:portable ...` | 目标发行介质的静态与运行验证 |

功能增加单元测试，缺陷增加回归测试。环境或外部文件缺失要明确区分失败与未执行，不能将测试构建通过推导为公开介质或全部平台通过。

资源包验证同时检查 ZIP 摘要、包内文件集合和逐文件摘要；Node 全链测试从解压后的资源目录启动，安装目录保持只读。Rust 缓存测试覆盖版本与摘要更新、完整删除、只读与占用文件、损坏与不完整缓存、使用锁和字节进度；前端测试覆盖准备完成前禁止挂载业务界面、进度显示、错误重试和 StrictMode 去重。合同见[应用资源缓存](resource-cache.md)。

## 异步测试同步

单元测试以握手、请求进入、完成回调、流关闭和清理完成等事件推进。并发测试使用可控 Promise 屏障，所有预期任务进入后再放行；计时器状态机使用 Vitest 虚拟时钟，显式覆盖截止前、截止后和迟到事件。

不要用固定 sleep、短时间窗口、累计 tick 次数或墙钟耗时断言推断执行顺序与响应性。响应性测试先等待隔离进程确认请求已进入，再等待主进程日志 drain 等完成事件，最后主动取消或终止隔离进程。可能拒绝的 Promise 创建后立即挂接处理，避免等待其他事件时产生未处理拒绝。

真实进程集成测试保留宽裕的防挂起截止。业务超时用例断言错误类型、状态与实际回收结果；性能耗时可记录，但不作为单元正确性的阈值。只有 OS 存活状态、外部驱动就绪等无事件接口的边界使用有截止的条件轮询，不能把轮询间隔或等待结束当作成功证据。

## 浏览器测试

[Playwright 配置](../../apps/desktop/playwright.config.ts) 先构建前端，再在 `127.0.0.1:4173` 使用 Vite preview，严格端口且不复用已有服务器。三个引擎覆盖布局、主题、字号、树交互、筛选、弹窗与可访问性，原生接口由浏览器适配器替代。

安装浏览器：

```sh
corepack yarn workspace @xresconv/desktop exec playwright install chromium webkit firefox
```

需要镜像时设 `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/`。启动失败先检查端口占用、系统端口保留和权限，浏览器结果不能证明桌面 WebView 的本机权限或系统对话框行为。

## 桌面测试

[runner](../../tests/desktop/run.mjs) 管理驱动及应用所属进程树，覆盖空会话、CLI 加载、树操作、输出设置、运行控制、日志、弹窗和显示设置，并恢复测试前的显示配置。失败与截止也必须回收所启动的进程。

Windows/Linux 默认使用 tauri-driver。Windows 需要与 WebView2 版本匹配的 msedgedriver，使用 Windows 风格绝对路径设置 `MSEDGEDRIVER_PATH`，必要时设置 `TAURI_DRIVER_PATH`。Linux 需要相应 WebKit 驱动和可用桌面/Xvfb 环境。

macOS 使用仅 debug `e2e` feature 的嵌入 WebDriver；release + `e2e` 编译拒绝。`XRESCONV_E2E_APP` 可指定待测程序，runner 的驱动选择与构建选项见 [options.mjs](../../tests/desktop/options.mjs)。原生操作与公开介质验证按需要单独执行。

嵌入驱动 1.4.0 的 option 点击只执行 DOM `click()`，不更新 select 值或触发 change。选择控件统一经 [interactions.mjs](../../tests/desktop/interactions.mjs) 操作：嵌入模式设置选项并派发冒泡 input/change，外部驱动保留原生选择。此适配验证渲染器回调；macOS 原生选项输入仍需单独验收。升级驱动时复核适配是否仍有必要。

Windows 字体测试读取真实本机字体、多次打开设置，并验证枚举结果。权限持久化验证需要显式复用同一 WebView2 profile，驱动默认临时 profile 不能证明跨进程恢复。

## 真实转换

设置 `XRESCONV_TEST_JAR` 为 xresloader JAR，`XRESCONV_TEST_SAMPLE` 为上游样本目录。未设置时查找相邻 `../xresloader/target` 的唯一匹配 JAR 和 `../xresloader/sample`；多个 JAR 时拒绝猜测。

```sh
corepack yarn test:conversion
node tests/conversion/project-smoke.mjs <trusted-project.xml>
```

差分测试比较 bin、lua、msgpack、json、xml、javascript、ue-json、ue-csv 的 argv 与 stdin 输出，按格式归一化非稳定内容并比较字节。缺少 JAR/样本时独立入口 exit 2，单元集成用例显式 skip，不能计作已验证。

project smoke 加载无转换前/后和日志 hook 的可信配置，覆盖工具和输出目录，仅向 `build/project-smoke` 写产物。真实转换测试设置外部硬截止和进程树回收：差分入口最多 10 分钟，project smoke 最多 4 分钟；软取消不能替代硬截止。

## 故障与资源边界

测试数据见 [fixtures 索引](../../tests/fixtures/README.md)。重点验证配置读取与解析预算、超时取消、无穷循环、异步异常、worker 退出、子树清理、毒帧/超大响应、日志过载及 sink 故障。资源耗尽输入只在隔离目录和有截止的测试中运行。

Windows GUI 控制台检查应观察窗口与启动选项，不能只数 conhost。Rust 测试模块避免引入 tauri/wry 运行时类型，见[架构约束](architecture.md#原生约束)。

## 文档与报告

Markdown 必须通过仓库 markdownlint，文档链接检查验证相对目标与锚点。报告放入 `build/<task-name>`，描述实际执行环境、结果和未执行原因。禁止跳过失败用例后宣称通过，平台适用性跳过应由用例条件表达。
