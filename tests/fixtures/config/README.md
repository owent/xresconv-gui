# XML 配置数据

| 文件 | 覆盖行为 |
| --- | --- |
| `minimal.xml` | 最小加载 |
| `global-options.xml` | 全局字段、别名、重复和参数顺序 |
| `tree-items.xml` | 分组、条目与选择状态 |
| `include-parent.xml` / `include-child-a.xml` / `include-child-b.xml` | 相对包含与合并 |
| `include-cycle.xml` | 包含循环拒绝 |
| `script-text-edge.xml` | 脚本文本与严格 XML 错误处理 |
| `invalid.xml` | 非法配置拒绝 |

单元测试断言解析结果、诊断、加载失败保留会话和资源预算。可用 `xresconv-gui --input <file>` 检查桌面表现。契约见[配置与转换](../../../docs/development/configuration-and-conversion.md)。
