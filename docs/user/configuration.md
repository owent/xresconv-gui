# 配置与启动参数

## XML 配置

配置遵循 [xresconv-conf](https://github.com/xresloader/xresconv-conf)，完整示例见[上游 sample.xml](https://github.com/xresloader/xresconv-conf/blob/main/sample.xml)。协议和输出格式由 [xresloader](https://github.com/xresloader/xresloader) 定义。

| 区域 | 内容 |
| --- | --- |
| `global` | 工作目录、JAR、协议及协议文件、数据版本、数据源目录、输出与重命名、Java 和转换参数 |
| `tree` / `list` | 分组、条目、表格与 scheme / DataSource、条目参数、选中和可选状态 |
| `default_scheme` | 条目缺省转换规则 |
| `output_type` | 输出矩阵、各格式目录和重命名、tag/class 资格条件 |
| `gui` | 事件、命名脚本、按钮脚本、日志处理和显示行为 |
| `include` | 相对声明文件解析的其他配置 |

文件必须为严格 UTF-8 和有效 XML。包含文件通过实际路径检查重复与循环，输入、嵌套深度和脚本有大小上限。加载失败时查看错误文件与原因，限额见[实现约定](../development/configuration-and-conversion.md)。

输出任务由“已选条目 × 符合条件的输出类型”构成，各输出类型可独立配置目录和重命名，缺省时回退到全局值。修改后重新预览，核对最终参数与路径。

## 启动参数

```sh
xresconv-gui --input project.xml --custom-selector selectors.json
```

| 参数 | 用途 |
| --- | --- |
| `--input <path>` | 启动后加载 XML |
| `--custom-selector <path>` | 加载选择器 JSON，可传多个文件 |
| `--custom-button <path>` | 选择器参数的别名 |
| `--log-configure <path>` | 加载额外 log4js 配置 |
| `--debug-mode` | 声明调试标志；开发调试入口见开发文档 |

相对路径取决于启动工作目录。参数由桌面层解析，配置与选择器由业务进程读取。

## 自定义选择器

使用 UTF-8 JSON，可包含单个按钮对象或按钮数组，见[示例](../custom-selector.json)。

```json
[
  {
    "name": "选择角色表",
    "by_schemes": [{ "file": "role.xlsx", "scheme": "glob: *" }],
    "default_selected": false,
    "style": "outline-primary"
  },
  { "name": "重新加载按钮", "action": ["unselect_all", "reload"] }
]
```

| 字段 | 说明 |
| --- | --- |
| `name` | 显示名称 |
| `by_schemes` | 按 `file` 与可选 `scheme` 匹配 |
| `by_sheets` | 按 DataSource 的 `file` 与可选 `sheet` 匹配 |
| `default_selected` | 按钮初始选中状态 |
| `style` | 样式名，如 `outline-primary`、`outline-secondary`、`outline-success`、`outline-danger` |
| `action` | 顺序动作列表 |

匹配支持完全匹配、`glob: <pattern>` 和 `regex: <pattern>`。无效正则记录诊断并回退到文本匹配，没有有效规则的普通选择器不改变选择。

动作支持 `select_all`、`unselect_all`、`reload` 和 `script: <name>`。`reload` 重读选择器文件并重建按钮，不重载 XML。同按钮连续脚本共享 `data`，重建后重新初始化。失败或脚本拒绝中止动作链。按钮名称应唯一。

## 文件日志

`--log-configure` 接收 [log4js 配置](https://log4js-node.github.io/log4js-node/configuration.html)：

```json
{
  "appenders": { "file": { "type": "file", "filename": "conversion.log" } },
  "categories": { "default": { "appenders": ["file"], "level": "info" } }
}
```

日志扩展在独立进程执行，写入与关闭有时间和队列上限，失败会明确报告。需要归档时等待应用正常关闭。自定义 appender 是可执行代码，应来自可信来源。

[脚本接口](scripts.md) · [返回用户文档](README.md)
