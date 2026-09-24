# scripts/ 脚本行为 Fixtures

- `contract.md`：P0-03 从源码提取的完整脚本上下文契约（权威，含锚点与 `[待运行验证]` 标记）。
- 脚本通常内嵌在 XML 配置中，因此多数脚本 fixture 位于 `../config/` 与 `../faults/`；本目录只放需要独立文件的场景。

| 文件 | 覆盖点 |
| --- | --- |
| `events-order.xml` | 命名/匿名事件、checked/mutable、before→convert→after 顺序、事件内 data 生命周期 |
| `append-log.xml` | on_append_log 双 hook 共享 context、改写 message/module_name/style、递归保护 |
| `legacy-samples/set_name_item_name.js` | 独立 set_name 样本：按 file basename+scheme 改写 item_data.name（P2-03 worker 测试 b） |

执行方法：配合 `../selectors/actions-chain.json` 使用 `--custom-selector` 验证按钮脚本共享 data 与动作链中断。
