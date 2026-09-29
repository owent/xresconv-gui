# Windows 发行包控制台窗口回归（2026-09-29）

[返回阶段记录索引](README.md)

## 症状与复现

用户下载的 `v3.0.0-dev.0` Windows x64 bootstrap ZIP（SHA-256 `eee632257b7e69d6117c4d20b88aca13b8f9b428da0ef4baf9e7ef12d9e18a17`）解压启动后出现额外控制台窗口。关闭该窗口后，GUI 报 `后端进程已退出：guardian stdout closed: failed to fill whole buffer`。

以实际下载包隔离启动，Win32 `AttachConsole(pid)` / `GetConsoleWindow()` / `IsWindowVisible()` 检测到 guardian、backend 和两个 worker 共用一个**可见**控制台。壳使用 Windows GUI subsystem；它启动的 Node 是 console subsystem，原 `Command` 没有禁止创建控制台的标志。Rust 的 `spawn_reader` 在 guardian stdout 管道断开后按协议报告 EOF，因此该错误是进程退出后的结果，而非 JSON 帧解析问题。没有为复现主动关闭控制台以免终止用户任务；错误与进程生命周期的因果关系由源码和操作系统行为解释。

## 决策与修复

- Rust 壳仅在 Windows 启动 guardian 的 `Command` 上设置 `CREATE_NO_WINDOW`（`0x08000000`）。该标志针对 console 程序禁止创建控制台，同时保留独立 stdin/stdout 管道。相比仅用 `SW_HIDE` 隐藏窗口，避免创建可被用户关闭的控制台。Linux/macOS 分支不改进程属性。
- guardian 的 `ProcessScope.decorateSpawnOptions` 在 Windows 对受监督进程统一写入 `windowsHide: true`，覆盖调用方的 `false`；包括 backend、worker 和通过该作用域启动的 Java 子进程。POSIX 进程组行为不变。即使日后某个受管进程独立创建控制台，也遵守后台进程无窗口约束。
- Windows CI 增加两项平台回归：GUI-subsystem Rust 测试父进程实际启动 Node 并检查 `GetConsoleWindow` 为空；Node 测试确认作用域强制 `windowsHide`。原实现两项测试均 RED，修复后 GREEN。

依据：[Microsoft 进程创建标志](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags)、[Rust `CommandExt::creation_flags`](https://doc.rust-lang.org/std/os/windows/process/trait.CommandExt.html)、[Node `child_process` 的 `windowsHide`](https://nodejs.org/api/child_process.html)。三项均为官方文档；本仓 API 调用和测试以锁定依赖为准。

## 本机验证与边界

修复后的本机 bootstrap ZIP SHA-256 为 `b252c59b5aa155773916aecc10c6743fd2df1dc6f601fd9b647a5df121d5bf47`，offline tar.zst 为 `bb46b836d0860c3b89f911c406a2790597c0dff48e4d6d3b818d7eed3fc45112`；两者的侧车 SHA-256 均复核通过。各自解压版运行 10 秒后，壳、guardian、backend 和两个 worker 均仍存活。对两种包各自的四个 Node 进程使用相同 Win32 探针，`GetConsoleWindow()` 全部为空，`IsWindowVisible()` 全部为 false。进程列表仍可能显示 `conhost.exe`，故不能以其存在断言有可见窗口；判定依据是控制台窗口句柄及可见性。

以两种实际打包 exe 分别运行 WebView2 桌面 E2E：每种均为空配置 9/9、CLI 加载配置 3/3；包含壳 → guardian → backend 握手、UI、树交互，未出现管道 EOF。此处是 Windows x64 本机验证；Windows ARM64 与其他主机待 CI/用户实机验证。回滚是撤销 Rust 创建标志和 Node 作用域选项，但会恢复已复现的可见控制台缺陷。
