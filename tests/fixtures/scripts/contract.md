# 脚本测试契约

API、上下文和代码示例统一维护在[用户脚本文档](../../../docs/user/scripts.md)，协议结构在[script-invoke Schema](../../../packages/contracts/schema/script-invoke.json)和[script-result Schema](../../../packages/contracts/schema/script-result.json)。本页说明测试需要验证的边界。

- set_name 同步修改 item_data，各条目上下文独立。
- 转换事件和按钮显式 resolve/reject，返回 Promise 不代表完成。
- 同按钮调用共享 data，不同按钮隔离，重建按钮后重新初始化。
- 节点与条目别名一致，本地操作可立即读取，回传操作验证版本。
- 日志钩子顺序共享上下文，保留原始消息、限制递归，日志树镜像只读。
- 弹窗先选择回调后关闭回调，不传 DOM 事件，过期 token 拒绝。
- require 从配置目录解析，配置模块优先，发行闭包提供所需动态依赖。
- 计时器和后台上下文随会话清理，超时与退出有明确结果。
- 不可序列化修改形成诊断，不阻止 worker 发送调用结果。

实现入口位于 packages/script-host/src，测试位于 packages/script-host/test 及 backend/guardian 对应测试目录。故障输入见[故障数据](../faults/README.md)。
