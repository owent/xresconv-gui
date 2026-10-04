# xresconv-conf 脚本样本

来源：[xresconv-conf sample.xml](https://github.com/xresloader/xresconv-conf/blob/main/sample.xml)。本目录保存测试所需 XML 与提取脚本，以固定输入检验执行语义。

| 文件 | 入口 |
| --- | --- |
| `sample.xml` | 完整输入 |
| `set_name.js` | 条目命名 |
| `on_before_convert.js` | 转换前事件 |
| `on_after_convert.js` | 转换后事件 |
| `button_delaycall.js` | 延迟完成按钮 |
| `button_custom_script.js` | 自定义按钮 |

测试按[脚本接口](../../../../../docs/user/scripts.md)校验上下文、回调和完成方式。更新输入时核对上游来源、摘要及实际断言，不能直接用新的下载文件覆盖测试期望。
