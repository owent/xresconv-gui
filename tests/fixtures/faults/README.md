# faults/ 故障注入 Fixtures

全部为 `authored` 状态。预期行为分两列记录：旧版实际表现（`[待运行验证]`，P0-04 采集）与新版契约目标（主计划 §6、§11.3）。**禁止在开发者日常环境无限运行资源耗尽型样本**；在隔离目录执行并设外部截止时间。

| 文件 | 注入 | 旧版预期（源码推断） | 新版契约目标 |
| --- | --- | --- | --- |
| `fault-sync-throw.xml` | before 事件同步 throw | Promise 链 reject，转换不启动，记 `CONV EVENT EXCEPTION` | 相同终态，明确错误上报 |
| `fault-async-throw.xml` | before 事件 setTimeout 回调 throw | 未捕获异常 → 渲染进程级崩溃/白屏（README 已知问题） | 隔离进程失败，GUI 存活 |
| `fault-never-resolve.xml` | 事件永不 resolve | 外部 setTimeout 到点 reject（默认 30s，样本改 2s） | 相同，加进程回收证据 |
| `fault-infinite-loop.xml` | set_name 同步死循环 | 无 VM timeout → GUI 冻结 | 外部硬截止时间终止 worker，加载收尾 |
| `fault-process-exit.xml` | 按钮脚本 `process.exit(1)` | 渲染进程退出 → 白屏 | 仅脚本 worker 终止，会话标记失效 |
| `fault-log-recursion.xml` | on_append_log 内调 log_info | 递归守卫拦截，第二条走原始渲染 | 相同语义，hook 故障隔离 |
| `fault-log-storm.xml` | 事件内 1e5 次 log_info | DOM 追加 1e5 条，GUI 卡死风险 | 有界队列 + 落盘完整日志 |

执行方法：旧版 `--input <file>`（按钮类配合 `../selectors/actions-chain.json`），观察后回填 `../legacy/manifest.json`。
