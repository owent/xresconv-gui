# 选择器数据

| 文件 | 覆盖行为 |
| --- | --- |
| `exact-match.json` | 完全匹配与默认选择 |
| `invalid-rule.json` | 非法模式诊断与回退 |
| `empty-invalid.json` | 无有效规则不改变选择 |
| `actions-chain.json` | 全选、取消选择、重读按钮与命名脚本链 |

使用 `xresconv-gui --custom-selector <file> --input <config>`，可叠加多个选择器文件。按钮格式及动作语义见[配置说明](../../../docs/user/configuration.md#自定义选择器)。
