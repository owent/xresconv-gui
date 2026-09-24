# xresconv-conf 真实样例脚本（P2-11 差分夹具）

来源：<https://github.com/xresloader/xresconv-conf/blob/main/sample.xml>
固定提交：`dab714ae4ca6a0dc8af5410087ce90e2dfbe687c`（2026-03-30，
"多格式输出矩阵支持修改输出目录"）。`sample.xml` 为该提交的逐字原文。

## 提取映射

| 文件 | sample.xml 元素 | 入口类型 | timeout 属性 |
| --- | --- | --- | --- |
| `set_name.js` | `<gui><set_name>` | set_name | 无（同步入口） |
| `on_before_convert.js` | `<gui><on_before_convert name="转表开始前事件">` | on_before_convert | 15000 |
| `on_after_convert.js` | `<gui><on_after_convert name="转表完成后事件">` | on_after_convert | 60000 |
| `button_delaycall.js` | `<gui><script name="delaycall">` | button | 无（用调用方默认） |
| `button_custom_script.js` | `<gui><script name="自定义脚本">` | button | 无（用调用方默认） |

提取规则：去掉 XML 公共缩进（每级 4 空格），脚本语句逐字保留；XML 文本
缩进对 JS 语义无影响。这些脚本是 xresconv 生态公开的真实样例，覆盖：
裸名 require（`os`/`child_process`/`timers`）、子进程 spawn、模板字符串、
按钮 data 持久化与重入保护、alert_warning 弹框、多级日志。

差分基线：`docs/plan/records/P0-08.md`（旧实现行为合同）与
`tests/fixtures/scripts/contract.md`；差异记录为 BD-S 条目（P2-11 记录）。
