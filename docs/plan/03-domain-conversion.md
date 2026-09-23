# 03 配置、转换内核与日志

[执行索引](README.md) · [上一册](02-contracts-script-host.md) · [下一册](04-ui.md)

对应 P3。业务内核采用 TypeScript，运行在独立 Node.js backend 中，不依赖 WebView；另一个 Node.js guardian 负责进程生命周期与超时。所有接口均为拟定，输出差异由固定旧版和 JAR 样例裁定；P0 已批准的缺陷修复按差异台账验收。

## 配置加载事务

`ConfigLoader` 接受入口路径和读取适配器，产生候选 `ConfigSnapshot` 或带来源位置的错误。`SessionStore` 只在解析、include、规则校验和 set_name 阶段满足合同后提交候选；失败不替换活动 revision。

处理步骤：

1. 保存用户显示路径与实际访问路径；相对 include 以声明它的配置文件目录为基准。入口、工作目录和 JAR 路径分别处理。
2. 读取有长度预算的 UTF-8 XML，保留脚本 CDATA/实体/换行的实际文本；不额外 trim 脚本正文。
3. 建立 include 图和访问栈，分别诊断循环与重复引用。路径规范化、大小写、软链接别名按 OS 测试；兼容旧行为与补充保护分别记录。
4. 按已验证顺序合并 global、tree/list、default_scheme、output_type、gui；重复/未知字段不能无声丢弃。
5. 生成稳定业务 ID 和来源定位，执行隔离 set_name；保留同步异常前可获取的合法修改，超时/崩溃不能伪造未知修改。
6. 建立树、输出资格和选择器；提交 revision，重建节点镜像并发出配置提交事件。

加载期间用户再次打开文件，给每次加载独立 requestId。旧请求完成时不可覆盖最新请求；被取消的候选清理其 worker，但不破坏仍在展示的有效配置。运行中的换配置策略由状态机裁定，不依赖按钮是否偶然置灰。

### 字段和兼容样例

| 字段组 | 必须精确验证 |
| --- | --- |
| global | work_dir、xresloader_path、proto、proto_file 多值、output_dir、rename、data_version、data_src_dir/data_source_dir 别名 |
| 参数 | java_options、global_options、item options 的顺序、重复键、空字符串、布尔转换 |
| scheme | default_scheme 与 item scheme 的覆盖、同键数组、datasource 分隔和派生说明 |
| tree/item | 分类、无分类、重复分类、名称/描述、tag/class、旧数值 ID |
| output matrix | 多类型、各自 rename/output_dir、tag/class 资格、全局回退和未知格式 |
| gui | 五类入口、name/checked/mutable/timeout/type、脚本声明文件与实际工作目录 |

不把缺失字段、空元素、空属性、字符串 `0`/`false`/`no` 一概转成同一个值。采用 fast-xml-parser 候选实现，通过样例选定顺序保留、属性、实体、CDATA 和值转换选项；显式执行严格 XML 校验，不能把 parser 返回对象当作格式校验通过。按 BD-07 修复旧 jQuery HTML 解析造成的畸形 XML 容忍与脚本文本二次转义问题，分别验证预期新行为和旧版差异。

文件读取、include 数量、深度、节点总量和脚本文本分别设预算。超过主事件循环响应预算的解析放入可终止 helper 进程，返回候选快照；guardian 不解析 XML。不得用 `readFileSync`、`spawnSync` 或无界 CPU 循环阻塞取消、健康检查与消息处理。100k 节点压测须覆盖候选构建、序列化和快照传输，不只测 parser。

## 选择与转换计划

Node.js backend 中的 TypeScript `SelectionService` 维护选中叶子、分类派生的三态、禁止节点和版本；UI 焦点/展开状态不参与转换语义。`SelectionRuleService` 批量调用隔离 matcher，维持 JS RegExp 和 minimatch 语义；可能长时间运行的正则仍须在可终止进程中执行。

`PlanBuilder` 输入一个配置 revision、一份选择快照及表单 override，输出有序 Job 列表。每项包含 itemId、matrixId、来源、argv 片段、输出目标和工作目录。展开顺序、重复目标与旧 pending 栈的顺序由基线固定；并发时旧实现没有保证的全局完成顺序不伪装成保证。

before 中修改 item/node 的可见性拆成三项验收：当前已构造命令是否变化、后续 hook 是否可见、下次转换是否可见。当前命令保持旧冻结时点。backend 与 script worker 虽然都使用 Node.js，仍处于不同进程，必须通过带版本的快照和合法 mutation 回传，不能假设对象共享，也不能把所有修改丢弃。

已知输出路径碰撞应在预览中可见。具体采取旧行为兼容、显式拒绝或同目标串行，需根据 P0 实际输出与用户配置确定并登记差异；不能未经验证全面并行写同一个文件。

## Java 协议与执行器

拟定 `JavaProcessSpec { executable, args, cwd, env }`、`Batch { batchId, jobs, encodedLines }`、`ProcessOutcome { spawnError, exitCode, signal, ioError, submittedCount, evidence }`。Java 路径诊断与版本检查必须带超时；GUI 启动不要求机器已经安装 JDK。

固定上游协议参考：[xresloader Main.java](https://github.com/owent/xresloader/blob/1f34e9b80d2b8c199e62453cdb104e47b87530a3/src/org/xresloader/core/Main.java)。用户 JAR 与该提交的兼容关系仍需实测。

### 参数编码合同

- 启动 Java 用 argv 数组，JVM 参数先于 `-jar`，JAR 业务参数在其后；不经 shell。
- stdin 参数按 JAR 的 token parser 编码，行分隔与字符串内容分别处理；不借用 Bash/PowerShell/Windows 命令行转义器。
- 测试空参数、空格、制表符、单/双引号、两类引号同时出现、反斜杠、换行、非 BMP、前导短横线。
- parser 无法无损表示的输入在预览阶段明确阻塞，或使用已验证的逐任务 argv fallback。fallback 增加进程启动开销，必须计入性能报告。
- 调试展示字符串不重新作为执行参数；日志中显示的漂亮命令不构成协议证据。

### 调度算法

1. 根据配置并发数、作业数和监督资源预算产生有限 worker/batch，保留旧默认 4、最大 16 的行为基线；改默认值须记录。
2. backend 确定每批任务顺序，经 guardian 的限定协议启动 Java 并登记所有权；spawn 失败不计为一次成功转换。调度策略留在 backend，guardian 只执行已验证的进程规格和生命周期操作。
3. 一侧按背压写 stdin，另一侧持续读取 stdout/stderr；不能等待读完日志才继续写，也不能无限缓存全部日志。
4. 写完该批关闭 stdin；等待进程退出、输出流 EOF/限定收尾、子树回收。
5. 汇总批次终态。只有全部成功且未取消才执行成功路径的 after；错误、信号和 IO 故障不能只靠 `code > 0` 判断。

有限分片优先保证可追踪，再测吞吐；如静态分片失衡，可设计有限批次继续派发，但完成边界仍是批次进程终止，不是任意日志块。stdin 上游累计退出码可能截断，不能将退出码当作可靠失败条目数。无逐任务确认时显示“已提交/批次成功或失败/条目结果未知”。

Node.js 的 `error`、`exit`、`close` 和流关闭分别登记，统一收敛为一次终态；`kill()` 返回成功不表示进程或子树已经退出。退出后仍需限定日志收尾时间，避免继承管道的后代永久阻塞 EOF。guardian 对 backend 的健康监督独立运行，backend 卡死后停止所属运行并清理其脚本与 Java 子树；不得自动重放已有文件副作用的任务。

## 状态机和取消

| 当前状态 | 可接受动作 | 必须结果 |
| --- | --- | --- |
| Ready | preview、start、选择/表单、reload | start 冻结 plan/run；重复 requestId 返回同一结果 |
| BeforeHooks | cancel；只读查看 | 失败不派发 Java；修改选择不能改变该 run |
| Converting | cancel；只读查看/日志 | 任一状态变化带 runId；记录已发生副作用 |
| AfterHooks | cancel；查看产物 | 失败标明转换已完成但后处理失败 |
| Cancelling | 重复 cancel、查询 | 幂等；等待所有所属作用域实际清理 |
| Succeeded / Failed / Cancelled | 新运行、reload、reset | 旧回包无法修改新运行；新运行新 runId |

reset 是业务操作而非直接清空 JS 变量。若当前有活动运行，先取消并等待收尾，再清状态。GUI 重载先恢复后端快照；不重复 start。主进程强制终止的清理由监督进程承担，见脚本宿主分册。

## 日志与兼容服务

日志管线为：字节读取 → 增量解码 → 原始记录 → 有序 hook → 安全渲染模型 → UI/磁盘。stdout/stderr 各自保证流内次序，不宣称能恢复操作系统未提供的两流绝对时间顺序。

hook 修改失败时保留原始记录和错误；若部分合法修改已返回，可按确定合同展示，不能悄悄丢失旧可见内容。故障 hook 的隔离/禁用周期明确为当前运行或会话，并在界面可见，不永久静默关闭功能。hook 内日志带来源标记，避免再次进入同一 hook 链。

Node.js 内部诊断与用户 log4js 日志区分，Tauri 原生诊断只记录壳层问题。guardian 的协议 stdout 不混入任何日志，诊断使用 stderr；backend 的业务日志由独立有界通道传输。log4js 自定义 appender 可能执行代码，不放入 backend 或 guardian；超时、路径、flush 和轮转单独监督。异常 regex 在可终止任务中执行，不能阻塞日志服务。

内存队列必须有界，超出 UI 容量的日志仍落盘并显示可加载范围。磁盘满/权限失败/日志服务挂起时，报告持久化失败并执行既定停止或降级策略；不得既承诺无损又默默丢弃，也不能让无限背压永久卡住转换取消。

## P3 任务清单

| 任务 | 依赖 | 拟实现位置/动作 | 验收 |
| --- | --- | --- | --- |
| P3-01 | G1、P0 配置样本 | `packages/backend/src/config`：TypeScript 解析、校验与来源模型 | CF01，文本与字段不丢失；BD-07 差异明确 |
| P3-02 | P3-01 | include 图、覆盖、路径、候选事务 | CF02/CF03，竞态与坏配置不覆盖有效状态 |
| P3-03 | P2-03、P3-02 | set_name 与提交阶段整合 | SC02/CF02；异常/超时后策略可解释 |
| P3-04 | P2-08、P3-02 | `packages/backend/src/domain`：选择器、资格矩阵、三态选择 | CF04/CF05，精确匹配与禁用节点正确 |
| P3-05 | P3-04 | PlanBuilder、输出检查与冻结 | CF05/CF06，before 修改三种可见性符合合同 |
| P3-06 | P3-05 | Java argv/stdin 编码器、fallback | EX01，按真实 parser 往返，不按显示字符串猜测 |
| P3-07 | P2-02、P3-06 | backend Java 模块与 guardian 适配：批次调度、背压、退出汇总 | EX02/SC11，静默进程也可完成，多块日志不重复派发 |
| P3-08 | P3-07、P2-09 | cancel/reset/close 状态机 | EX03，终态一次、取消可完成、无误杀 |
| P3-09 | P2-08、P3-07 | 日志、log4js、分页和 flush | EX04，日志风暴/磁盘错误有界且可诊断 |
| P3-10 | P3-03 至 P3-09 | 固定真实 JAR 差分与 G3 报告 | EX05；所有输出格式按业务内容比较 |

失败时回退对应模块/批次，不删除旧基线，不修改 JAR 协议来掩盖本仓库适配问题。只要某种输出格式、事件路径或自定义选择器仍无验证，新内核就不能替换正式入口。
