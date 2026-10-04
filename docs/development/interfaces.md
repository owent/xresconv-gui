# 接口

## Schema 与类型

[packages/contracts/schema](../../packages/contracts/schema) 是协议结构的唯一维护位置，包含 envelope、握手、脚本调用/结果、健康、错误和业务 RPC。修改 Schema 后执行：

```sh
corepack yarn workspace @xresconv/contracts generate:types
corepack yarn test:contracts
```

生成文件位于 `packages/contracts/src/generated`，类型与注释均由生成命令维护，批量整理文字时排除该目录。Schema 样例和冻结测试用于验证协议字段、必填项、未知属性及错误处理。

## 消息与帧

Envelope 使用 `protocol_version`、`kind`、`id`、`role`、`payload`，可携带 `in_reply_to`、`session_id`、`revision`、`run_id`、`invocation_id`、`generation`。字段使用 Schema 中的实际命名，接收方继续按消息类型验证 payload。

私有字节通道使用 4 字节大端长度和 UTF-8 JSON。默认帧上限 64 MiB；guardian 输出队列累计预算为 128 MiB。桌面写入队列最多 16 帧且累计不超过 128 MiB。过大业务响应明确返回 `RESPONSE_TOO_LARGE`，不能无限缓存或静默截断。

## 业务 RPC

请求为 `type: request`、`method`、可选 `params`；结果为 `type: result`、`ok` 和 `result` 或 `error`。参数由后端验证，入口见 [rpc-app.ts](../../packages/backend/src/service/rpc-app.ts)。

| 方法 | 作用与参数 |
| --- | --- |
| `loadConfig` / `reload` | 加载 `{path}` / 重载已加载配置，运行中拒绝 |
| `getSnapshot` | 读取会话快照 |
| `applyOps` | 提交 `{ops}`，验证树版本与合法操作 |
| `updateSettings` | 提交 `{fields}`，并行度为会话字段，范围 1–16 |
| `preview` / `run` | 构建预览 / 开始转换 |
| `cancel` / `reset` | 取消 / 后端会话重置 |
| `getLogs` | `{limit, beforeSeq}`，每页 1–1000，缺省最新 1000 条 |
| `respondDialog` | `{token, choice}`，验证会话与调用有效性 |
| `setHookEnabled` | `{group, index, enabled}`，group 为 before/after/append_log |
| `setCustomSelectors` | `{files}`，重建选择器及按钮代际 |
| `invokeCustomButton` | `{name}`，执行按钮动作链 |
| `checkJava` | 执行 Java 环境探测 |

`getLogs` 返回 seq 升序窗口，`beforeSeq` 读取更早条目。前端按 seq 合并快照、分页和事件，内存淘汰后的日志不可恢复。

## 错误与监督

参数和业务错误返回稳定错误码与消息，包括 `INVALID_PARAMS`、`UNKNOWN_METHOD`、`INVALID_STATE`、`CONFIG_ERROR`、`XRESLOADER_NOT_FOUND`。guardian 失联和截止分别返回 `BACKEND_NOT_READY`、`BACKEND_DIED`、`BACKEND_TIMEOUT`。

未知方法或参数属于 RPC 错误，不能导致通道故障。错误对象仅序列化明确字段，避免任意 Error 或循环引用。脚本操作、弹窗和事件按关联标识拒绝重复、过期及跨会话响应。

脚本 API 见[用户脚本文档](../user/scripts.md)，角色与监督规则见[架构](architecture.md)。
