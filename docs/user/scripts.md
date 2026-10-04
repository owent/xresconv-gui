# 自定义脚本

脚本在独立 Node.js worker 中执行，可访问本地模块与进程。配置和脚本应来自可信来源：进程提供故障隔离，不能限制恶意脚本的系统访问。定义方式见 [xresconv-conf sample.xml](https://github.com/xresloader/xresconv-conf/blob/main/sample.xml)。

## 执行入口

| 入口 | 完成方式 | 数据生命周期 |
| --- | --- | --- |
| `set_name` | 同步修改 `item_data.name` | 每个条目使用新上下文 |
| `on_before_convert` | `resolve()` / `reject()` | 每次事件初始化 `data` |
| `on_after_convert` | `resolve()` / `reject()` | 每次事件初始化 `data` |
| 命名按钮脚本 | `resolve()` / `reject()` | 同按钮连续调用共享 `data` |
| `on_append_log` | 同步修改日志 `data` | 同条日志的钩子顺序共享上下文 |

事件和按钮必须显式完成，返回 Promise 不代表调用完成。超时、异常或 worker 退出产生诊断。超时缺省 30 秒，合法范围 1–2147481647 毫秒。

```js
data.calls = (data.calls || 0) + 1;
log_info("按钮调用次数: " + data.calls);
resolve();
```

`set_name` 提供当前 `item_data`、`data`、日志和弹窗函数，不提供 `require`、`resolve` 或 `reject`。

```js
item_data.name = item_data.file + " / " + item_data.scheme;
```

运行开始时固定本次已选条目集合，转换前事件执行完再构造命令。事件中的条目字段修改会影响当前命令；勾选变化供后续事件和下次运行读取。

## 上下文和模块

运行事件与按钮提供 `selected_items`、`selected_nodes`、`global_options`、`data`、日志、弹窗、计时器和 `require`，具体字段见[调用 Schema](../../packages/contracts/schema/script-invoke.json)。

`require` 以配置目录解析相对模块，优先使用配置附近的 `node_modules`，再查发行包模块目录。可以使用 Node 内置模块。应用不提供 DOM、jQuery、Electron 或默认 `console`，使用 `log_*` 输出日志。

```js
const path = require("node:path");
log_info(path.join("output", "result.json"));
setTimeout(() => resolve(), 100);
```

额外模块安装在项目目录，本仓库开发统一使用 Yarn。镜像使用 HTTPS registry，自建证书通过受信 CA 配置处理。

已完成调用的后台上下文可继续持有计时器，直到会话重载、关闭或 worker 回收。会话和调用标识约束回调，过期响应会被拒绝。

## 日志

提供 `log_info`、`log_notice`、`log_warning`、`log_error`。日志钩子读取和修改 `data.message`、`data.module_name`、`data.style`，原始消息保留用于诊断。

```js
data.message = "[project] " + data.message;
data.module_name = "project";
data.style = "text-success";
```

钩子链串行处理日志，递归日志跳过钩子，过载时绕过钩子并记录跳过数量。日志入口的树镜像只允许读取和导航，修改产生诊断。

## 树节点

`selected_items[i].ft_node` 指向条目节点，`node.data.item` 指回同一对象。选择操作在 worker 镜像内同步生效，再以带版本的操作提交后端。

支持 `key`、`title`、`tooltip`、`data.item`、`data.option.auto_select`、`isFolder()`、`isSelected()`、`isPartsel()`、`isExpanded()`、`isRootNode()`、`setSelected()`、`toggleSelected()`、`setExpanded()`、`visit()`、`getSelectedNodes()`、`getTree()`、`getRootNode()`、`getParent()`、`getChildren()`、`toString()`。`render()` 可调用但不绘制界面，分组节点没有条目 `data`。

```js
for (const item of selected_items) {
  log_info(item.ft_node.title);
}
resolve();
```

依赖 DOM 或动态增删节点的成员产生诊断。直接写节点核心字段不能替代操作，会话版本不匹配时拒绝整批修改。

## 弹窗

提供 `alert_error(content, title)` 和 `alert_warning(content, title, options)`。alert_error 只显示错误提示，alert_warning 的第三个参数支持 yes、no、on_close 回调，选择回调执行后再执行关闭回调。回调不接收 DOM 事件。

```js
alert_warning("继续转换？", "确认转换", {
  yes: function () { resolve(); },
  no: function () { reject("用户取消转换"); }
});
```

回归输入见[脚本测试数据](../../tests/fixtures/scripts/README.md)。

[返回用户文档](README.md)
