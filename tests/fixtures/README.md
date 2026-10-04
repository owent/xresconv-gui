# 测试数据

输入用于配置、选择器、脚本、转换和故障回归测试。期望行为由当前实现合同与测试断言定义，外部样本来源和摘要用于保证输入可重复。

| 目录 | 用途 |
| --- | --- |
| [config](config/README.md) | XML 加载、包含、全局设置与非法输入 |
| [selectors](selectors/README.md) | 匹配规则、空规则与动作链 |
| [scripts](scripts/README.md) | 事件、命名、按钮、弹窗和日志钩子 |
| [conversion](conversion/README.md) | JAR 发现、样本、golden 与真实输出差分 |
| [faults](faults/README.md) | 超时、异常、退出、递归与日志过载 |

测试必须隔离输出、设置截止并回收自身进程。禁止提交开发机绝对路径、凭据和私人表格。外部 JAR 与大样本通过环境变量提供，缺件明确报告，使用方法见[测试文档](../../docs/development/testing.md)。
