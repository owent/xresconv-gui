# config/ 配置样本

来源：依据 `src/main.js` 解析逻辑（锚点见 `../scripts/contract.md` §0）与 xresconv-conf 规范编制；`sample.xml` 外部样本见 `../legacy/manifest.json`。

执行方法：旧版 `xresconv-gui --input <file>` 加载，观察树结构、日志、事件开关与报错；新版对照解析结果。全部为 `authored` 状态，运行观察记录回填到 `../legacy/manifest.json`。

| 文件 | 覆盖点 |
| --- | --- |
| `minimal.xml` | 最小可加载配置：单个 file+scheme 条目 |
| `global-options.xml` | 全部 global 子节点、多 proto_file/data_src_dir、java_option、default_scheme、option、输出矩阵（rename/tag/class） |
| `tree-items.xml` | category 嵌套、cat 绑定、item options、scheme 子节点、DataSource 回填 file、tags/classes、default_scheme 补全 |
| `include-parent.xml` / `include-child-a.xml` / `include-child-b.xml` | include 合并/覆盖、相对路径基准、多 include 顺序（含已知竞态 `[待运行验证]`） |
| `include-cycle.xml` | 自引用 include 检测（`alert` + file_map） |
| `script-text-edge.xml` | **故意不是良构 XML**：探测 HTML 解析 + `.html()` 取文本路径下 `&lt;` 实体、裸 `<tag>`、引号的实际行为 |
| `invalid.xml` | 非法 XML（未闭合标签），观察 jQuery HTML 模式解析的容错行为 |
