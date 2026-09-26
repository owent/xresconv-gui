# 测试 Fixtures 索引

本目录保存重构基线与回归测试的输入/预期样本。规则：

- 每个子目录有 README 说明数据来源与执行方法。
- `legacy/manifest.json` 是 F01–F12 功能对照的唯一清单（P0-02 产物）。
- `authored` 状态的 fixture 由源码分析编制（来源锚点见 `scripts/contract.md`），**未经旧应用运行验证**，执行后必须回填观察结果并把状态改为 `verified`。
- 外部样本（xresconv-conf sample.xml、xresloader JAR、示例表格）体积/许可原因不进 Git；哈希与获取方式记录在 manifest 与 `docs/plan/records/`。
- 禁止提交绝对开发机路径、真实凭据或私人业务表格。

| 目录 | 内容 | 主要服务的测试类别 |
| --- | --- | --- |
| `config/` | XML 配置样本（最小/完整/include/边界/非法） | C01–C03、C06、F01/F02 |
| `selectors/` | 自定义选择器 JSON | C05、C08、F04/F05 |
| `scripts/` | 脚本契约与脚本行为 fixture | C09–C13、F09/F10、SC 系列 |
| `conversion/` | 转换输入/输出对照（JAR、参数、输出） | C07、C15、R06 |
| `faults/` | 故障注入配置 | R01–R12 |
| `legacy/` | 旧版基线清单与观察记录 | 全部 |
