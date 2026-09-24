# 02 接口、用户脚本与进程监督

[执行索引](README.md) · [上一册](01-baseline-toolchain.md) · [下一册](03-domain-conversion.md)

对应 P2，同时定义 P1/P3/P4 共用接口。D6 的 Node/TypeScript 业务和监督层已有 Windows 实测，协议 v1 冻结规则见 [P2-12](records/P2-12.md)；跨平台范围仍以实际记录为准。

增量审查明确的完成边界：重复启动/关闭须等待同一结果；终止后的 scope 禁止再登记进程；RPC deadline 包含管道写入等待。Rust 壳写队列最多 16 帧、待决请求最多 128；guardian 出站积压最多 8 MiB，单帧仍为 1 MiB。过大 RPC 回复返回关联的 `RESPONSE_TOO_LARGE`，超时/通道失效不自动重放。实现与回归见 [增量审查](records/REVIEW-P2-P5-2026-09-24.md)。

## 进程职责与最小原生边界

| 隔离域 | 实现 | 允许职责 | 禁止职责 |
| --- | --- | --- | --- |
| Tauri 薄壳 | 官方插件 + 必要 Rust 入口/胶水 | 窗口/对话框、受控消息转发、Node 引导和失联提示、最低限度生命周期适配 | XML、业务状态机、Java 调度规则、执行用户脚本 |
| Node guardian | TypeScript 编译后的 JS，独立进程 | 启动业务/脚本/Java 作用域、消息路由、外部截止、退出与清理 | 用户脚本、regex、XML、同步大日志/业务计算 |
| Node backend | TypeScript 编译后的 JS，独立进程 | 配置会话、选择/计划/状态机、请求校验、转换编排 | vm/eval 用户 JS、自定义 log appender、在同事件循环执行无限制匹配 |
| Node script/helper | 按职责独立 Node 进程 | 五类用户脚本、解析/复杂匹配、自定义日志扩展 | 未授权业务命令、任意 Tauri 能力 |

guardian 管理各进程作用域，backend 发起已校验的执行请求；每个子通道角色由启动记录绑定，不能相信消息内自称的 sender。独立进程共享一份包内 Node 二进制，无需为 backend/guardian/worker 各带一份运行时。

## 领域标识与数据所有权

| 对象 | 权威所有者 | 最少字段/规则 |
| --- | --- | --- |
| ConfigSnapshot | Node backend 配置模块 | revision、entryFile、sourceFiles、globals、items、tree、hooks、buttons；提交后不可原地改写 |
| WorkspaceSession | Node backend 会话模块 | sessionId、revision、selectionVersion、selectedItemIds、editableOverrides |
| ConversionPlan | Node backend 计划模块 | planId、revision、selectionVersion、jobs、matrix、workingDirectory；执行前冻结 |
| RunContext | Node backend 调度模块 | runId、legacyRunSeq、planId、phase、counts、startedAt、cancelReason |
| ScriptInvocation | Node guardian | invocationId、sessionId、generation、entryKind、deadline、state；业务结果回送 backend |
| ButtonState / require cache | Node 会话 worker | 任意 JS 值保留在进程内；不强制转换成 JSON |
| NodeMirror | Node 兼容层 | 稳定节点 ID、旧 key/id 类型、父子关系、item 别名及已支持方法 |
| LogRecord | Node 日志管线 | logId、runId、sequence、stream、raw、rendered、hookOutcome |

协议 ID 使用不透明字符串，旧脚本可见的 `id`/`key`/`run_seq` 类型另作映射。时间截止使用监督进程的单调时钟；IPC 不把宿主和子进程各自的单调时间值直接相减。JSON 中不传超出 JS 安全整数范围的数字。

## UI 经 Tauri 转发到 Node backend 的命令表

命令不是泛用文件系统或 shell API。Tauri 只验证调用窗口/桥接白名单/envelope 上限；Node backend 用共享 Ajv 校验器验证业务参数、会话、revision 和状态。guardian 按通道角色限制执行能力；业务校验不能只留在前端。

| 拟定命令 | 输入 | 返回与效果 |
| --- | --- | --- |
| `session_snapshot` | sessionId、可选 lastEventSeq | 当前完整快照，或可证明连续的增量 |
| `configuration_open` | 选文件得到的路径/CLI 路径、expectedRevision | 候选加载任务 ID；成功后原子提交新 revision |
| `configuration_reload` | sessionId、expectedRevision | 重读原入口，失败保留已提交快照 |
| `selection_apply` | revision、selectionVersion、operation、目标 ID | 新选择版本和差量；不接受 DOM 节点 |
| `settings_apply` | revision、允许编辑的业务字段 | 校验后更新运行参数，不修改原 XML 文件 |
| `conversion_preview` | revision、selectionVersion | 冻结候选 plan、参数摘要和可执行/阻塞原因 |
| `conversion_start` | planId、客户端请求 ID | runId；同请求重复投递不得启动两次 |
| `conversion_cancel` | runId、reason | 进入 Cancelling；终态事件在实际清理后发送 |
| `custom_action_start` | revision、buttonId、requestId | 动作链 ID；不接收任意 JS 源码字符串 |
| `dialog_respond` | callbackToken、generation、选择 | 恰好一次回调；过期 token 返回明确错误 |
| `logs_read` | runId、cursor、limit | 有界分页及下一游标；原始/展示日志可区分 |

事件至少包括配置提交/失败、选择变化、运行阶段/终态、日志批次、弹框请求、worker 失效和环境诊断。UI 断连后先拿快照再订阅/补齐事件，使用水位序号消除订阅竞态；有缺口则重同步，不能盲目重复应用差量。

## Tauri/Node 与 Node/Node 的私有协议

### 传输和握手

Tauri→guardian 优先使用 sidecar 私有 stdin/stdout 字节管道：guardian 的 stdout 专用于控制，内部日志走 stderr；脚本/Java stdout/stderr 从独立子管道读取，不能透传成 guardian 控制帧。若 Tauri 插件不能提供所需字节语义，P2-01 冻结最小流适配，不为此引入 HTTP 服务。

字节通道拟定帧为 4 字节大端长度 + UTF-8 JSON，初始上限 1 MiB；分块大快照，接收前验证长度和预算。guardian→可信 backend 使用 `child_process.fork` 的 IPC，明确 `execPath`/serialization 并处理 send 背压。Node 内置 IPC 已在 message 回调前解析，不能声称 Ajv 提供预分配长度防护；脚本/不受控扩展使用 spawn + 专用有界字节通道，独立于日志，P2-01 验证三平台实现。

Node IPC 的发送回调仅确认发送情况，不表示业务已完成；必须有应用层 ACK/Complete。禁止用 NODE_ 前缀的保留 cmd，也不把 advanced serialization 当跨 Tauri 协议。按钮 data/闭包仍留在 worker 内。[Node child_process](https://nodejs.org/api/child_process.html)

握手顺序：监督层启动 worker → worker 报 Node 版本、宿主版本、协议主/次版本、支持能力 → 父端校验 manifest → 初始化 session/revision → Ready。未 Ready 不派发业务请求；握手超时关闭进程树，报告启动失败。

消息 envelope：`protocolVersion`、`kind`、`requestId`、`sessionId`、`revision`、`runId?`、`invocationId?`、`generation`、`payload`。JSON Schema 在 packages/contracts/schema 唯一维护，生成 TS 类型；不再由 Rust struct 导出业务 schema。已有样例字段命名/版本迁移要显式记录，不因换语言静默改协议。错误包含稳定 code、用户消息和关联 ID；不直接序列化任意 Error 循环对象。

| 消息类别 | 要求 |
| --- | --- |
| Invoke / Complete / Fail | 只对活动 invocation 生效，重复完成忽略并记录诊断 |
| MirrorSnapshot / MirrorDelta | 先验证版本与允许操作，再按 sequence 应用；不可修改任意对象原型 |
| DialogRequest / DialogResult | 回调保存在 worker，IPC 仅传 ID 和可序列化参数 |
| Log / HookResult | 独立流控，日志内容不能伪造控制帧 |
| Cancel / Shutdown | 幂等；超时后由监督层强制终止，不等 worker 自己配合 |
| Health / Fault | 心跳仅作诊断；不能靠 worker 心跳来实现唯一截止时间 |

大数据初始化分块完成前不暴露半份 mirror。操作确认按 invocation 和序号去重；节点操作冲突返回 `REVISION_CONFLICT`，不能把旧脚本操作套到同名的新节点。

### 资源与环境

Node 路径由已校验的发行 manifest 和应用资源目录确定；绝不从 PATH 临时选择。启动命令使用 argv 数组。规范化 `cwd`、工作/配置/资源路径，记录实际模块解析锚点。

清理可能注入加载行为的 `NODE_OPTIONS`、`NODE_PATH` 等变量，并建立显式环境转发契约；Java/工具依赖的 PATH、JAVA_HOME 和用户脚本所需业务变量分别测试。禁止悄悄删除用户确实依赖的变量，也不得把开发机全部密钥环境复制到日志。此环境契约属于 P0/P2 兼容核验项。

## 五类脚本的精确合同

| 入口 | 当前已核实行为 | 新宿主必须验证 |
| --- | --- | --- |
| set_name | 每 item 新 VM、新 `data={}`；含 item_data、日志和弹框；**未注入 require、resolve/reject**；无 VM timeout | 不擅自增加 Node 权限；正常 item 修改提交；异常前部分修改与超时无法取回修改的处理分别记录 |
| before / after | 每次事件新 data；注入 require、resolve/reject、选择对象和 run_seq；顺序 Promise 链 | before 失败不转换；after 失败有后处理终态；保留计划在 before 之前构造的时点 |
| button script | data 来自按钮对象，同按钮多个 action/多次调用共享；按钮上下文 global_options 与运行事件来源不同 | 同按钮引用一致、不同按钮不串状态；字段类型不能按 README 擅自统一 |
| on_append_log | 转换建立 append_log_context 后才执行；同条日志的多个 hook 共用 VM 和 log_object；带递归 guard | 调用范围、顺序、修改可见性、错误后剩余 hook 的行为和原始日志可追踪 |

`require` 指向旧宿主的加载环境，不天然相对 XML 文件。必须对 `./relative-module`、内置模块、包 exports、动态包名、require.cache、原生模块分别建例。可在 Node 用显式加载锚点建立兼容层，但是否完全匹配旧发行目录，要以安装产物中的测试为准。

同步返回与异步完成分开：`set_name` 和日志 hook 的同步执行返回表示该次计算结束；before/after/button 仍由 resolve/reject 完成，不能把“脚本返回了 Promise”自动当旧协议成功。多次 resolve/reject 只改变状态一次；非法返回值不拖垮控制通道。

### worker 分组与状态

拟定配置加载 worker、会话脚本 worker、日志 hook worker、可信匹配/日志服务相互分离；随包只分发一份 Node 二进制。会话 worker 承载按钮及 before/after，共享该会话 require cache，按钮 data 由 buttonId 索引。每次调用仍创建独立 VM 上下文。

不同调用的异步回调可以交错；不得未经基线验证把所有按钮强制串行化。相同 worker 的同步死循环会使该隔离域失效，受影响的全部调用明确失败，但 GUI、Java 监督和其他会话必须继续可收尾。

**跨角色 module singleton 是兼容风险**：旧日志 hook 与按钮可能通过 require.cache 分享模块状态，分进程后无法自动保留。P2-04 必须检测真实样本；需要时设计显式共享状态服务或经验证的分组替代方案。未解决就阻止 G2，不能称为透明兼容，也不能将任意 JS 闭包复制过 IPC。

调用完成不等于立即销毁上下文。定时器、弹框回调和用户创建的后台子进程可能仍被旧脚本使用；需追踪为会话资源，直至明确结束、重置、重新加载或关闭。截止时间到达且 invocation 未结束时杀对应 worker；已经完成的合法后台行为仍受会话资源限额和会话关闭清理约束。

### 节点镜像与回调

兼容表先依据 D3 区分公开字段/操作与 Fancytree 内部。旧记录中的 key/title/data、节点方法和 ft_node 关系作为迁移取证，不自动把完整 Fancytree API 重新列入承诺；公开适配方法的参数/返回值必须写进新 API 合同并测试，不支持的内部调用返回明确诊断。

在 worker 内重建 `selected_items[i].ft_node` 与 node.data.item 的对象别名；同步读写先作用于镜像，批量回传明确的领域操作。旧代码还把缺省 scheme 数组直接赋给多个 item，不能用逐 item 深拷贝悄悄打断这些共享引用。P0 记录实际引用关系，传输采用数据表与引用 ID，在 worker 内复原；跨 hook 的 selected_items/global_options 身份和修改可见性也要测试。修改任意未知字段可能只能保存在 worker，能否影响后续转换必须由兼容样例决定，不可静默丢弃。

弹框 yes/no 后 on_close 的顺序要保留。旧回调的 `this` 与 DOM 事件 arguments 无法直接跨进程；按 D3 决策这些属于未公开实现，不模拟，检测到使用时给出诊断与迁移指引。ESC、关闭按钮、窗口销毁和重复点击分别测试。脚本失效后移除其弹框，迟到点击不再执行回调。

## 监督进程与清理

```mermaid
sequenceDiagram
    participant UI as Tauri 薄桌面壳
    participant Guard as Node guardian
    participant Backend as Node backend
    participant JS as Node worker
    UI->>Guard: 转发用户请求
    Guard->>Backend: 校验通道后交付业务命令
    Backend->>Guard: 创建脚本作用域与截止时间
    Guard->>JS: 启动并完成握手
    Guard->>JS: Invoke
    alt 正常完成
        JS-->>Guard: Complete 与操作
        Guard-->>Backend: 校验后的执行结果
        Backend-->>UI: 经 guardian 转发状态事件
    else 超时或壳/业务服务失联
        Guard->>JS: 终止所属进程树
        Guard-->>UI: 终态或关闭清理记录
    end
```

监督责任由独立 Node guardian 承担，不编写 Rust guardian。它只处理短时有界消息与异步进程 IO，不导入业务解析或脚本模块；业务服务卡住时，其 watchdog 仍可终止相关作用域。Tauri 壳独立检测 guardian 失联并显示错误，不能把故障弹框也依赖失联服务。

backend 异常退出/失联：guardian 停止派发、终止所属脚本/Java 并通知壳；只允许显式新建会话恢复，不自动重放旧任务。guardian 自身退出/被杀：壳调用已验证的生命周期适配回收其作用域，若无法证明完整清理就报告失败且阻塞该平台验收。纯 Node 的跨平台进程树/资源能力不是先验保证。

监督进程仅从继承的控制句柄/受控私有通道接受启动描述，业务脚本不能提交任意系统 PID 作为 kill 目标。登记原生进程句柄或包含启动标识的所有权信息，避免 PID 重用误杀无关进程。父端死亡以句柄/管道关闭及必要的系统机制检测，不只轮询 PID 存在。

| 平台 | 原型要求 | 证明边界 |
| --- | --- | --- |
| Windows | 优先现成且经验证的系统/原生生命周期适配；P2-02 已落地：koffi（MIT，Node-API 预编译 FFI）调用 Job Object + KILL_ON_JOB_CLOSE，OpenProcess 常驻句柄防 PID 重用，taskkill /T /F 仅降级回退 | Node core 无通用 Job Object API；不能只以 taskkill 或 child.kill 返回成功证明完整性。2026-09-24 win32 实测：terminate 杀树、宿主 SIGKILL 后内核回收整树均通过，未自研原生补丁 |
| Linux | Node guardian + 所属进程组，必要时现成系统资源机制；适配父端失联 | 不承诺普通进程组拦截 setsid/double-fork；资源能力、cgroup 可用性按实际环境报告 |
| macOS | Node guardian + 进程组/现成生命周期适配，父端失联清理 | 不照搬 Linux cgroup；不为单个平台恢复整套 Rust 监督框架 |

取消流程：停止新派发 → 撤销回调/操作权限 → 请求正常退出 → 宽限截止后强制终止 → 核验退出、管道关闭与所属子树 → 发布终态。Node 的 killed 标记/kill 返回和 AbortSignal 不能替代退出证据；区分 spawn error、exit、close、disconnect，避免重复收尾。[Node 子进程语义](https://nodejs.org/api/child_process.html)、[Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)

脚本有文件/外部命令副作用时不自动重试。worker 崩溃不能恢复任意闭包和模块状态；展示受影响会话及运行结果需核验的信息。D4 已定：脚本可信，允许文件系统与外部进程能力；验收边界是故障隔离（不得白屏/杀主进程/卡死任务）与 IPC 授权，受限能力模式降级为可选增强；Node VM/Permission Model 不提供所需的完整恶意代码边界。[Node VM](https://nodejs.org/api/vm.html)、[Node 权限模型](https://nodejs.org/api/permissions.html)

## P2 任务清单

| 任务 | 前置 | 拟实现位置/动作 | 验收与回退 |
| --- | --- | --- | --- |
| P2-01 | G1 | contracts、薄壳桥、Node 角色 IPC：握手、分块、背压与受控帧 | SC01/SC11；worker 不能伪装 backend 或越权调用 |
| P2-02 | P2-01 | packages/guardian：Node 监督与三平台生命周期适配原型 | SC07/SC08/SC11；业务/壳/guardian 分别被杀时清理达到合同 |
| P2-03 | P2-01 | script-host：五入口、字段类型、data、回调 | SC02/SC03；逐字段与旧行为比对 |
| P2-04 | P2-03 | require 锚点、cache、worker 分组、环境策略 | SC04；跨 hook 缓存样例不兼容即 G2 阻塞 |
| P2-05 | P2-03 | NodeMirror、别名、同步方法、有序操作 | SC05；不使用 React/DOM/jQuery 实现镜像 |
| P2-06 | P2-03、P2-05 | 弹框回调注册表与失效逻辑 | SC06；回调次数/顺序正确，无过期调用 |
| P2-07 | P2-02 至 P2-06 | watchdog、资源限制、异步异常和强制退出 | SC07/SC08；按平台报告可保证范围 |
| P2-08 | P2-04 | 独立日志 hook 与可信 log4js/matcher 服务 | SC09/EX04；复杂 regex 不阻塞日志服务，必要时再分隔离域 |
| P2-09 | P2-07 | 取消/重置/关闭/各角色崩溃的统一收尾及无重放 | SC10/SC11/EX03；实际回收后才报清理成功 |
| P2-10 | P2-04 | 发布目录动态模块与原生扩展验证 | SC04/PK07；无 npm 网络、无全局 Node 仍运行 |
| P2-11 | P2-05 至 P2-10 | 真实脚本差分与 BD 差异清单 | 不用自造简单脚本替代真实样例；不兼容有具体定位 |
| P2-12 | P2-11 | G2 报告与接口冻结 | SC 全部必需案例通过，或明确阻塞，旧架构仍可回退 |

Tauri 前端只启用所需窗口/命令能力，不授予任意 shell spawn；自定义命令仍必须自行校验状态和对象权限。测试能力使用显式名单，避免自动合并进发行能力。[Tauri Capabilities](https://v2.tauri.app/security/capabilities/)
