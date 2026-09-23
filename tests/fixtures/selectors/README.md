# selectors/ 自定义选择器样本

来源：`docs/custom-selector.json`（仓库既有示例）为权威样本；本目录补充边界用例。匹配语义见 `../scripts/contract.md` §7。

执行方法：旧版 `xresconv-gui --custom-selector <file> --input <config>`；可叠加多个 `--custom-selector`。

| 文件 | 覆盖点 |
| --- | --- |
| `docs/custom-selector.json`（仓库内引用，不复制） | 官方示例：by_schemes glob、by_sheets regex、default_selected、action 链 |
| `exact-match.json` | 完全匹配；无 glob/regex 前缀 |
| `invalid-rule.json` | 非法 regex → 回退精确匹配并记错误日志 |
| `actions-chain.json` | `unselect_all` + `script:` 链、共享 data、错误中断 |
| `empty-invalid.json` | 缺 name / 无规则 / 字符串错误项（setup.js 读取失败注入） |
