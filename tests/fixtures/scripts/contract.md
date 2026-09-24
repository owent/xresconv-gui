# 旧版用户脚本契约（P0-03 提取）

来源：`src/main.js` @ 969b698（应用 2.6.0）、`src/setup.js`、`README.md`。本文件只记录**从源码核实**的行为；标注 `[待运行验证]` 的条目需在 P0-04 用旧应用实测确认，不得提前当作合同。

## 0. 解析层事实（影响所有脚本）

- 配置 XML 不是被 XML 解析器解析，而是被 jQuery 按 **HTML** 模式解析（`src/main.js:1198` `$(context)`）。后果：
  - 标签名/属性名大小写按 HTML 规则处理；未知元素保留。
  - `<![CDATA[...]]>` 在 HTML 解析下是 bogus comment，脚本文本语义 `[待运行验证]`。
  - 脚本通过 `$(dom).html()` 取文本（`src/main.js:1470` 等）。**已运行验证**（P0-04，probe + fault-log-storm + 官方 sample.xml 对照）：
  - `<script>` 是 HTML raw-text 元素：内容原样保留，`<`、`>`、`&` 均可用（官方 sample.xml 的 `delaycall` 含 `left_times > 0`，实测正常运行）。
  - `<set_name>`/`<on_before_convert>`/`<on_after_convert>`/`<on_append_log>` 是 HTML 未知元素：内容按标记解析，`.html()` 重新序列化时 `<`/`>`/`&` 分别变成 `&lt;`/`&gt;`/`&amp;` → 含这三类字符的事件脚本**编译必然失败**（`Unexpected token ';'`），该事件静默缺席、仅在日志报 `GUI脚本编译错误`。错误堆栈经 innerHTML 展示时实体被再次解码，显示内容具有误导性。
  - CDATA 在 HTML 解析下是 bogus comment，内容不可用（`[待运行验证]`，但同上机制可判定无支持）。
  - 新实现必须明确定义脚本文本语义（建议一律按 XML CDATA/转义后的真实文本），并把旧版"事件脚本不能含 `<>&`"列为行为差异（旧行为是缺陷，不作为兼容目标，但要能识别并给出可定位诊断）。
- 所有 `vm.Script` 的 `filename` 为定义该脚本的 XML 文件路径（`src/main.js:1471`、`1495`、`1527`、`1558`、`1594`）。
- `include` 加载存在已知竞态：`ret.then(load_sub_file)` 未回写 `ret`（`src/main.js:1834`），2 个及以上 include 的完成顺序无保证 `[待运行验证]`；循环/重复 include 由 `conv_data.file_map` 检测并 `alert()`（`src/main.js:1792-1795`），检测键是拼接后的路径字符串，未规范化。
- `set_name`、事件、按钮脚本编译失败（语法错误）只记录错误日志并弹窗，不中断配置加载（`src/main.js:1473-1480` 等）。

## 1. set_name

触发：每个 `<item>` 处理一次，时机在条目放入树之前（`src/main.js:1705-1757`）。配置含多个文件时，后处理文件的 `set_name` 覆盖前者（`conv_data.gui.set_name` 单槽，`src/main.js:1466-1470`）。

| 上下文键 | 类型/来源 | 备注 |
| --- | --- | --- |
| `work_dir` | string | 当前处理文件解析出的工作目录（相对路径拼到该文件目录，`src/main.js:1432-1439`） |
| `configure_file` | string | 当前处理文件路径，不一定是顶层 `--input` 文件 |
| `item_data` | object（活引用） | 修改 `name`/`desc` 直接影响树显示（树节点在其后创建，`src/main.js:1761-1770`）；结构见 §6 |
| `data` | object | **每个条目新建**（`src/main.js:1712`），跨条目不共享；README"保存全局状态"与此不符（差异记录 BD 候选） |
| `alert_warning` / `alert_error` | function | 见 §5 |
| `log_info`/`log_notice`/`log_warning`/`log_error` | function | 内容经 `shell_color_to_html`，模块名 `CONV EVENT` |
| `require` | **未注入** | 与 README 隐含的 Node 能力不符；vm 隔离全局下不可用 `[待运行验证]` |
| `resolve`/`reject` | **未注入** | 同步执行、无 Promise 包装 |

- `runInContext` **无 timeout**（`src/main.js:1748`）：同步死循环将冻结 GUI `[待运行验证]`。
- 单条目异常被 catch，记录后继续下一条目（`src/main.js:1749-1756`）。

## 2. on_before_convert / on_after_convert

触发：`conv_start` 内按数组顺序串行 `.then` 链接（`src/main.js:2301-2407`）。before 全成功后才开始 Java 转换；after 在转换 Promise 成功后执行。任一 reject → 整条链 reject → `catch` 记日志进入 finally（失败计数已增）。

| 上下文键 | 类型/来源 | 备注 |
| --- | --- | --- |
| `work_dir` | string | 运行时从 DOM 读取并解析 |
| `configure_file` | string | 顶层输入文件路径（`conv_data.input_file.path`） |
| `xresloader_path` | string | DOM 值，未做存在性校验 |
| `global_options` | object | `{"-p": 协议, "-a"?: 数据版本}`（`src/main.js:1911-1947`），**不是** `conv_data.global_options` 数组（与按钮脚本不同） |
| `selected_nodes` | Fancytree 节点数组（活对象） | 真实节点，方法全集 = Fancytree API `[D3 待样本]` |
| `selected_items` | item_data 数组（活对象，`ft_node` 指回真实节点） | 计划冻结在其前：修改 item 字段**不影响**本次已拼接命令（`src/main.js:2002-2048` 先于事件执行） |
| `run_seq` | number | 本次运行序号 |
| `data` | object | **每个事件每次运行新建**（`src/main.js:2350`）；同运行内 before 各事件互不共享，与 README"全局状态"不符 |
| `resolve(value)` / `reject(reason)` | function | 仅首次生效（`has_done` 守卫，`src/main.js:2329-2349`）；reject/超时使 `failed_count++` |
| `require` | 渲染进程原始 `require` | 可加载任意 Node 模块与项目依赖 |
| `alert_*`、`log_*` | function | 同 §1，模块名 `CONV EVENT` |

- timeout：XML `timeout` 属性（ms），默认 30000；`runInContext` 带 `timeout`（同步代码）+ 外部 `setTimeout`（异步）（`src/main.js:2355-2370`）。超时报 `Run event callback timeout`。
- `enabled`：XML `checked`/`mutable` 经复选框 DOM（`append_conv_list_event_group`，`src/main.js:1122-1190`）；无名事件恒启用且无 UI。禁用事件直接 resolve。
- 同名 base 上下文对象同时存入 `conv_data.gui.append_log_context`（`src/main.js:2299`），供 on_append_log 复用；运行结束（finally）置 null（`src/main.js:2424`）。

## 3. script（自定义按钮脚本）

触发：按钮 `action` 链中的 `script: <名字>`（名字可带匹配引号，`src/main.js:700-709`）。

| 上下文键 | 与事件入口差异 |
| --- | --- |
| `work_dir` | 配置解析期计算并冻结在脚本条目上（`src/main.js:1598`） |
| `global_options` | **`conv_data.global_options` 数组**（`[{name,desc,value}]`，`src/main.js:525`），与事件入口的对象形式不同 |
| `data` | **同一按钮跨调用共享**（`custom_selector.data`，`src/main.js:612`、`771`）；跨按钮不共享 |
| `resolve`/`reject`/`require`/`alert_*`/`log_*`/`selected_*`/`configure_file`/`xresloader_path` | 同 §2；无 `run_seq` |
| `enabled` | 恒 undefined → 必执行 |

- timeout 默认 30000，结构同 §2（同步 VM timeout + 外部 setTimeout）。
- 动作链：`reload`/`select_all`/`unselect_all`/`script:*` 按序 `.then` 链接；任一 reject 中断后续动作并记日志（`src/main.js:805-822`）。`select_all`/`unselect_all` 经 Fancytree `visit` + `setSelected`。
- 未知脚本名/未知 action：记错误日志或静默跳过（`src/main.js:653-660`、`714`）。

## 4. on_append_log

触发：每次 `logger_append_style_message`（即每条 GUI 日志），条件是 `conv_data.gui.on_append_log` 非空且 `append_log_context` 存在且递归守卫未置位（`src/main.js:175-215`）。`append_log_context` 仅在 `conv_start` 期间存在 → **加载期/空闲期日志不触发 hook**。

| 上下文键 | 备注 |
| --- | --- |
| `data` | `{message, module_name, style}`，**可改写**；全部 hook 执行完后按改写结果渲染 |
| 其余键 | 来自 §2 的 base 上下文（含 `require`） |
| `resolve`/`reject` | 未注入；同步执行 |

- 同一条日志的多个启用 hook **共享同一个 vm context**（懒创建一次，`src/main.js:189-204`）→ hook 间可见彼此全局变量；不同日志各自新 context。
- 递归守卫：hook 内再产生日志直接走原始渲染（`append_log_callback_guard`）。
- 异常：catch 后记录 `APPEND LOG EVENT EXCEPTION`，原始/部分改写结果仍渲染；不阻塞 Java 管道读取以外的路径（同步执行本身会阻塞渲染进程 `[BD-02]`）。
- 每个 hook 有独立 timeout（默认 30000）。

## 5. alert_warning / alert_error

- `alert_error(content, title)`：Bootstrap modal，innerHTML 直接注入（`src/main.js:861-877`）→ 脚本可注入任意 HTML/主动内容 `[安全差异 BD-04]`。
- `alert_warning(content, title, {yes, no, on_close})`（`src/main.js:879-923`）：点"是"→ hide → `yes()` → `on_close()`；点"否"→ hide → `no()` → `on_close()`。ESC/背景点击关闭**不触发任何回调**（无 `hidden.bs.modal` 监听）→ 调用方挂起直至 timeout `[待运行验证]`。
- 并发弹窗：复用同一 modal DOM，后调用覆盖先调用的按钮与回调（无排队）`[待运行验证]`。

## 6. item_data / 节点结构

`item_data`（`src/main.js:1614-1632`）：`{id:number(自增), file, scheme, name, cat, options:[{name,desc,value}], desc, scheme_data:{key:[values]}, ft_node, tags:[], classes:[]}`。

- `scheme_data` 值恒为数组；`DataSource` 键特殊：按 `|` 拆分后回填 `item_data.file`（`src/main.js:1671-1686`）。`default_scheme` 补充缺失键（`src/main.js:1689-1693`）。
- `desc` 会拼接数据源与 tag/class 文本（`src/main.js:1695-1702`）。
- `ft_node` 初始为占位 plain object，`show_conv_tree` 的 `createNode` 回调里替换为**真实 Fancytree 节点**（`rebind_ft_node_and_item`，`src/main.js:1854-1864`、`1882-1884`）。
- DOM/Electron/Fancytree 依赖登记（D3）：`selected_nodes` 暴露完整 Fancytree API（含 `setSelected/isSelected/visit/render/data`）；`alert_*` 依赖 Bootstrap modal DOM；`require` 可触达 Electron 模块。真实脚本样本尚未收集，兼容范围不能仅凭 README 判定。

**P2-05 NodeMirror 合同（新版实现，worker 侧 `script-host/src/node-mirror.ts` + 共享 `compat-service/src/tree-model.ts`，后端 `backend/src/service/tree-state.ts`）：**

- 线上形态：`context.tree = {version, nodes}`（TreeSnapshot）。节点 `{key, title, tooltip, folder, unselectable, selected, partsel, expanded, autoSelect, item?, children}`；item 节点 key=item.id（number），category 节点 key=`cat:<id|name>`，根节点 key=`root_<n>`。item 载荷为旧版 item_data 形状（snake_case `scheme_data`、含 `id`、**无 `ft_node`**——别名由镜像重建）。
- 别名恒等：`item.ft_node === node`、`node.data.item === item`、`node.key === item.id`；`selected_items`/`selected_nodes` 按选中状态从镜像推导（stopOnParents=false 的 DFS 序）。
- 支持面：setSelected/toggleSelected/isSelected/setExpanded/isExpanded/isPartsel/getParent/getChildren/getRootNode/isRootNode/isFolder/visit/树级 visit 与 getSelectedNodes、`data.option.auto_select` 读写、item 字段直写（退出期 diff → `set_fields`）。`render()` 为 no-op（BD-S15）。
- 排除面（D3）：结构/懒加载/动画等方法调用抛错并记一次 `D3_EXCLUDED` 诊断 op（去重）；`li/span` 等 DOM 属性读 undefined + 诊断；`node.selected` 等核心字段直写被忽略 + `D3_DIRECT_NODE_WRITE`；on_append_log 为只读镜像（BD-S16：修改 no-op + `D3_READ_ONLY`，树快照在 run 开始固化）。
- ops 回流：`set_node_states{changes}`（selectMode:3 级联已计算好的盖章集）/`set_node_expanded`/`set_fields{target:"item_data",item_id,fields}`（排除 ft_node/id）/`set_node_option`/`diagnostic`；每条 op 带 `v`=快照版本，版本失配后端整批拒绝（`tree-state.ts:applyScriptOps`）。所有 outcome（含 rejected/error）的 ops 都应用（BD-S3 部分修改语义）。
- 逐 op JSON 消毒（BD-S17）：单条不可序列化的 op 降级为 `OP_SERIALIZE_FAILED` 诊断，不再拖垮整个 result。

## 7. 数值与杂项契约

- `convert_to_boolean`（`src/main.js:18-52`）：字符串 `no/false/0/disable/disabled`/空 → false（大小写不敏感）；数组 → 非空；数字 → 非 0；HTMLElement → checked/value。
- 匹配规则（`src/main.js:131-164`）：前缀 `regex:`/`glob:`（前缀匹配大小写不敏感）→ JS RegExp / minimatch；否则精确 `==`；规则非法 → 记错误并回退为对**原规则串**精确匹配；空规则只匹配空输入。
- 并发：默认 `min(2, floor((cpus-1)/2)+1)`，上限 16，>6 弹确认（`src/main.js:2574-2640`）。
- 任务派发：`pending_script.pop()` LIFO——任务按选中顺序的**逆序**执行；每收到一次 stdout/stderr data 事件派发下一条（BD-03 的调度耦合点）。
- 重置按钮 = 整个窗口 reload；旧 Java 子进程在 renderer 销毁后的归属 `[待运行验证]`（疑孤儿，R07 用例）。
- 退出码归并：`exit`/`error`/`close` 三事件去重；`code>0` 时 `failed_count += code`（xresloader 以退出码汇报失败数）。
