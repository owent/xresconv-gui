# 脚本数据

当前 API 见[用户脚本文档](../../../docs/user/scripts.md)，测试关注点见[测试契约](contract.md)。脚本可内嵌在 XML，异常与资源样本位于相邻 faults 目录。

| 输入 | 覆盖行为 |
| --- | --- |
| `events-order.xml` | 事件顺序、开关与 data 生命周期 |
| `append-log.xml` | 日志钩子链、字段改写与递归保护 |
| `alert-warning.xml` | 弹窗选择和完成回调 |
| `legacy-samples/set_name_item_name.js` | 条目命名 |
| [xresconv-conf 样本](legacy-samples/xresconv-conf/README.md) | 上游配置中的实际脚本 |

配合 selectors/actions-chain.json 验证同按钮共享 data、按钮重建与动作链中断。运行输入应来自可信来源，并设置外部截止。
