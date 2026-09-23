# 06 测试实施与验收证据

[执行索引](README.md) · [上一册](05-packaging-release.md) · [下一册](07-cutover.md)

本册把主计划 C01–C15、R01–R12、I01–I14 展开为可执行场景。**P0 旧版基线已有 [阶段记录](records/README.md)；下列新架构用例及 D6 新增验收仍需实施执行，不继承旧 Rust 骨架的通过状态。** 测试 ID 是固定引用，不以预估总用例数作为覆盖证明。

## 测试目录与夹具

| 拟定目录 | 内容 | 运行约束 |
| --- | --- | --- |
| `tests/fixtures/config` | 最小/完整 XML、include 图、非法/延迟/大配置 | UTF-8、来源与预期模型齐全 |
| `tests/fixtures/selectors` | 当前 docs/custom-selector.json 的冻结样本和边界规则 | 不修改真实用户选择器文件 |
| `tests/fixtures/scripts` | 五类正常脚本、对象别名、动态 require、模块缓存 | 标出旧/新允许差异与运行上下文 |
| `tests/fixtures/conversion` | 表格、协议、固定 JAR/JDK manifest、预期输出 | 大文件/外部 JAR 按哈希获取，不冒充当前仓库文件 |
| `tests/helpers/fake-converter` | 可控制 stdin、stdout/stderr、退出和子树的假程序 | argv/stdin 原样捕获；与真实 JAR 测试分开 |
| `tests/script-host` | 真实 Node worker 和监督进程集成 | 每例有外部截止与清理检查 |
| `tests/backend` / `tests/guardian` | Node 业务、角色协议、监督与生命周期 | 独立进程故障注入；Node 单元/契约 job 无 Rust 依赖 |
| `tests/browser` / `tests/desktop` | 浏览器 adapter 测试 / 原生 Tauri 测试 | 报告分别标识，不混称桌面验收 |
| `tests/installers` | 干净 VM 快照、安装入口、断网与包管理证据 | 只允许显式隔离测试环境执行故障/卸载 |

每个 fixture 有 manifest：ID、内容哈希、来源、适用 OS/架构、关联 F/C/R/I、旧观察结果、新预期、归一化规则、清理方法。旧基线只通过人工审阅更新；测试程序不得失败后自动重写 expected。

fake-converter 至少支持：无输出、单条多块输出、多条一次输出、拆分 UTF-8、无尾换行、stderr warning、慢读 stdin、提前关 stdin、启动即退、非零/信号退出、写完后挂起、多层子进程。测试 runner 用真实管道触发，不仅 mock `spawn()` 返回值。

## 配置和计划用例

| ID | 准备与执行 | 断言 | 映射 |
| --- | --- | --- | --- |
| CF01 | 加载最小/完整/空属性/重复键/CDATA/实体/非法 XML；与旧观察比对 | 脚本文本不二次转义；scheme/global 数组和默认值一致；按 BD-07 严格拒绝非法 XML 并给来源错误 | F01/F02、C01/C06 |
| CF02 | 两级 include；相同文件重复、环、大小写/软链接别名；两文件人为不同延迟；加载途中换入口 | 合并顺序可解释；旧竞态记 BD-05；只最新成功候选提交，坏候选不覆盖 | F01、C02、R10 |
| CF03 | 在中文/空格/UNC/长路径/非 BMP/相对目录执行；变更启动 cwd | include/工作/JAR/资源目录不串用；平台不支持的路径明确诊断 | F01/F06、C03/C14 |
| CF04 | 父子混选、禁用叶子、空分类、展开/折叠、精确/glob/regex/无效规则和默认选择 | 三态/选中集合与旧版一致；非法和灾难回溯规则不冻结宿主 | F03/F04、C04/C05 |
| CF05 | 全输出格式、多矩阵、tag/class、rename/output_dir 回退、未知格式及输出重名 | 计划集合、argv、资格、预览与冲突策略逐项匹配 | F02/F06/F07、C06/C07 |
| CF06 | before 修改 item/options/选择；after 读取；下一次运行重新生成计划 | 当前冻结命令、后续 hook 可见性、下次运行结果三项分别正确 | F05/F08/F09、C08/C09/C15 |

CF02 不能只比较一次偶然顺序。用受控延迟复现旧代码并记录，再决定目标稳定顺序；不以“旧实现偶发通过”要求新实现保留竞态。

## 脚本和隔离用例

| ID | 准备与执行 | 断言 | 映射 |
| --- | --- | --- | --- |
| SC01 | 合法握手；版本错配；半帧/截断/超大长度/非法 UTF-8/未知操作/原型污染键；stdout 打印伪协议 | 接受合法消息、拒绝非法控制；不误解析 stdout；内存/队列有界 | C09、R09/R12 |
| SC02 | 五入口逐字段检测；同 item/不同 item；连续两次 before/after；首次转换前、转换中、结束后、下一次转换前及 reset 后日志 | set_name 无 require；data 生命周期正确；日志 hook 上下文的保留/更新/清除符合旧合同 | F09、C09 |
| SC03 | 同按钮两次点击和动作链、不同按钮；同步 resolve；重复 resolve/reject；从不完成 | data 身份和隔离正确；只结束一次；外部截止生效；失败阻止后续 action | F05/F09、C08/C09、R02/R04/R05 |
| SC04 | require 内置/相对/动态/npm/原生包；adm-zip/compressing 创建与解压往返；按钮与 hook 共用状态模块；环境变量样本；离线运行 | 加载锚点/ABI/cache/环境符合契约；归档内容/路径正确；跨进程单例差异不可静默忽略 | F09、C11/C12 |
| SC05 | D3 公开节点合同的读写/操作及对象别名；未公开 Fancytree/DOM 调用；多 item 共用 default_scheme 数组；函数/Buffer/BigInt 存入按钮 data；配置更换后发旧 patch | 公开合同的对象别名与类型保留，操作只作用合法 revision，不对 data 强制 JSON 化；排除接口给诊断与迁移指引 | F03/F09、C10、R04/R10 |
| SC06 | 脚本发 alert_warning；分别 yes/no/ESC/关闭/重复点击；脚本结束后回调；worker 失效后点击 | 合法回调不提前销毁且只调用一次，过期回调不执行；按 BD-06 修复 ESC 关闭不回调造成的挂起 | F05/F09、C09/C10、R04/R05 |
| SC07 | 同步 throw、异步 throw、rejection、同步循环、异步循环、process.exit/abort、原生崩溃 | 对应隔离域失败，GUI 可交互、状态可收尾，无无限重启或自动重放 | F09、R01/R02/R03/R11 |
| SC08 | 可控 heap/Buffer/native 内存压力、派生多层/后台/detached 子进程；取消和强杀 GUI | 实测资源上限与清理；未支持的恶意逃逸边界记录，不能误写“完全沙箱” | F09/F12、R03/R07/R08 |
| SC09 | 多日志 hook 连续改写、第二个 throw、hook 内再次 log、日志突发和慢 hook | 顺序、递归保护、原始记录和错误可查；管道读取、取消不死锁 | F10、C13、R05/R09 |
| SC10 | worker 写文件后崩溃；有多个活动 invocation；旧 generation 迟到回包 | 不重试副作用；所有受影响调用进入确定状态；新 worker 不接受旧回复 | F08/F09、R04/R07/R10/R11 |
| SC11 | 分别阻塞/终止 backend、guardian；worker 伪报 backend 身份、向 stdout 注入帧、发送超大帧；可信 fork 通道断开/背压/发送回调后不响应；壳强杀 | 身份绑定实际通道；按字节限长后再解析不可信消息；发送回调不当作业务完成；独立监督截止可用，UI 故障可见，所属子树清理有实证，不自动重放 | F08/F09/F12、R03/R04/R07/R09/R10/R11/R12 |

### 必须保留的具体样例

以下脚本内容供 fixture 实施使用，本次不执行故障代码。

按钮状态样例（同一个按钮执行两次应得到 1、2；另一按钮从 1 开始）：

```javascript
data.counter = (data.counter || 0) + 1;
log_info(String(data.counter));
resolve(data.counter);
```

异步死循环样例使用旧上下文实际具备的 require 能力，不假设 VM 自带全局 setTimeout：

```javascript
require('node:timers').setTimeout(() => {
  while (true) { /* 在隔离测试 VM 中由外部监督终止。 */ }
}, 0);
```

节点对象样例按 P2 冻结的公开合同分类。以下为 P0 观察过的旧对象用法，不能因其曾经可用就自动列为 D3 的兼容承诺：

```javascript
const item = selected_items[0];
if (item.ft_node.data.item !== item) throw new Error('broken item alias');
item.ft_node.setTitle('新标题');
resolve();
```

P2 必须把上述访问逐项标为公开保留或未公开排除：保留项验证镜像身份/操作可见性，排除项验证诊断与迁移指引。不得为了让这个旧样例无差异运行而恢复 Fancytree/DOM。

SC07/08 必须在外层测试 runner 再加硬超时。循环/资源耗尽用例在隔离 CI/VM，结束时检查该用例的进程树、句柄、临时目录；外层 runner 自身被杀后也要有回收机制。故障测试不能污染下一用例而制造误判。

SC11 在 Windows/macOS/Linux 分别执行，guardian 死亡后的树清理由独立测试 runner 观察，不使用已死亡进程自行上报作为证据。Node 内置 IPC 的接收回调已晚于反序列化，不能用回调中的 Ajv/长度检查冒充不可信输入的分配前大小限制。backend/guardian/worker 的退出、挂起、断连分别验收，不能只杀 worker 即宣称新架构存活性通过。

## 转换与日志用例

| ID | 准备与执行 | 断言 | 映射 |
| --- | --- | --- | --- |
| EX01 | 特殊参数逐项编码并喂真实 parser/固定 JAR；同时测试 argv fallback | 原值可还原；无法表示的参数预先阻塞；无 shell 注入或静默截断 | F06、C03/C06 |
| EX02 | fake-converter 各输出模式；并发 1/4/16、少于 worker 的任务数、空任务；slow stdin/提前关闭 | 每任务只提交一次；无输出也能完成；日志块数量不改变任务数；批次失败不冒充精确条目失败数 | F08、R06/R09 |
| EX03 | 在 before/转换/after/收尾阶段取消、重置、关闭；同请求重投；强杀宿主 | 终态只发布一次，before 失败不启动 Java，取消后无迟到污染，无误杀无关进程 | F08、R04/R06/R07/R10 |
| EX04 | UTF-8 拆包、ANSI、log4js appender/轮转/flush、磁盘满/只读/慢日志服务 | 内容及错误可查，UI 有界，完整日志或明确失败；取消不会无限等待日志 | F10、C12/C13、R05/R09 |
| EX05 | 同一真实 JDK/JAR/表格/proto，旧新分别跑全部原格式与矩阵 | 文件集合/路径/业务内容一致；只归一化预先声明的时间等非业务字段 | F06/F07/F08、C07/C15 |

EX05 不仅比较 exit code 或文件存在。确定性格式做字节比较；非确定性序列化先解析再比较业务结构，归一化规则必须先审阅。每种格式标明真实执行的 fixture，不能以一种格式成功推断全部支持。

## UI 与真实桌面用例

| ID | 步骤 | 断言 | 映射 |
| --- | --- | --- | --- |
| UI01 | 无配置/有效配置/坏配置/Java 缺失分别启动；检查 F01–F12 入口 | 所有旧功能可找到，空/加载/失败状态有明确操作 | F01–F12、C14 |
| UI02 | 订阅后断开/重连、漏一段事件、两次挂载、后端快照版本变化 | 无重复订阅/任务，缺口触发重同步，旧事件不覆盖新状态 | R04/R10 |
| UI03 | 鼠标/空格/方向键/双击；10k/100k 树；滚动卸载再返回；搜索隐藏选中节点 | 三态/选择不丢，焦点与读屏正确，全选含义稳定，p95 有测量 | F03、C04 |
| UI04 | 多值目录、空字段、未知协议/格式、版本冲突、输出冲突预览 | 输入不丢、后端校验可定位、不可执行时不能启动 | F02/F06/F07、C06/C07 |
| UI05 | 选择器默认选择、按钮链、hook checked/mutable、脚本弹框 | 顺序与可修改性正确；原生系统对话框另有实际打开验证 | F04/F05/F09、C08/C09/C14 |
| UI06 | before 失败、Java 批次失败、after 失败、取消、未知条目结果 | 文案区分实际阶段和已发生副作用，不假成功 | F08、R01/R06/R07 |
| UI07 | 日志筛选/分页/复制、允许富文本、事件属性/script/dangerous URL | 正常显示保留，无 WebView 执行或 Tauri 越权 | F10、C13、R12 |
| UI08 | 三平台真实 WebView、明暗主题、DPI/缩放/长中文、原生对话框/CLI | 布局、可访问性和启动参数一致，不依赖 CDN/开发服务器 | F11/F12、C14 |

浏览器层使用 Playwright Chromium/WebKit/Firefox；真实应用层使用 WDIO Tauri service 的 embedded provider，覆盖三平台。官方目前提供测试专用 Rust 插件，必须用独立 feature 启用；production 包扫描和启动验证不得残留测试服务。[Tauri 测试文档](https://v2.tauri.app/develop/tests/webdriver/)、[WDIO Tauri](https://webdriver.io/docs/desktop-testing/tauri/)

原生文件对话框可在大部分 E2E 中通过 adapter 注入选择结果，以保证稳定性，但这只能证明应用处理逻辑。每平台仍需一次真实系统对话框打开/选择/取消的自动化或人工记录；不能宣称 DOM 自动化完整覆盖系统窗口。

## 安装和产物用例

| ID | 准备与执行 | 断言 | 映射 |
| --- | --- | --- | --- |
| PK01 | 生成全目标预期清单；故意缺一个变体、篡改 hash、放入测试包 | 汇总失败；仅全矩阵、production feature、正确 digest 可交付 | I10、G5/G6 |
| PK02 | Windows 已有合格/过旧/无 WebView2；bootstrap 联网与断网 | 复用、升级、安装和断网诊断符合策略，先检查后 GUI | I01/I02/I04/I05 |
| PK03 | Windows 无 runtime/无缓存/断网，安装 offline；拒绝提权/策略阻止/需重启 | 真离线完成或明确失败/重启；架构正确，不假成功 | I03/I06/I07/I10 |
| PK04 | macOS 两架构，签名包断网首次打开；最低系统和不支持系统 | 支持系统可用；旧系统明确拒绝；没有虚构 WKWebView 安装步骤 | I01/I05/I10/I11 |
| PK05 | Linux 缺 WebKit 的支持桌面，运行 bootstrap；测试参数/退出码/权限 | 引导器能先于 GTK/WebKit 启动，正确安装或诊断 | I02/I04/I06/I09/I12 |
| PK06 | 每 distro/arch 的最小/已更新桌面，清缓存断网跑 offline；依赖冲突/包锁/损坏/空间不足 | D2 自含包路径验证随包完整性与系统集成，回退路径验证完整闭包/本地包源；均无远端获取/降级/源永久修改，失败可恢复 | I03/I05/I06/I07/I12 |
| PK07 | 安装目录中文/空格/只读；移除全局 Node/npm/开发工具，启动全部 Node 角色并运行归档脚本 | 各角色复用单份固定 Node，JS/模块/必要适配定位正确，动态 require 可用，无网络补包 | I09/I13 |
| PK08 | 核对签名、公证、SBOM、license、最终 hashes 和二进制依赖/端口 | 应用及 sidecar 都有效，无测试服务/私密配置/旧 UI 运行依赖 | I10/I11、G5 |
| PK09 | 旧版→新版、同版修复、降回旧版、卸载重装；删除 runtime 后启动；无 Java/JAR | 用户数据保留，共享 runtime 不卸载；修复/诊断在 GUI 创建前可用 | I05/I08/I14 |

所有用例标明适用性：macOS 的无 WKWebView 离线补装是“不支持，按系统要求拒绝”，不得写成 I03 补装成功。某测试不适用需要平台理由，不能用 N/A 隐去尚无测试机或尚未实现的能力。

离线证明包含 VM 镜像/架构、安装前 runtime 清单、缓存状态、网卡/防火墙状态、网络捕获或防火墙日志、包管理记录、安装退出码、运行脚本和最终文件 hash。仅“拔网后界面能打开”不够证明首次安装闭包完整。

## 执行频率和命令

| 层级 | 触发 | 门槛 |
| --- | --- | --- |
| 本地任务验证 | 每次相关实现/修复 | 对应 ID 用例、lint/typecheck；必要时真实子进程 |
| PR | 所有变更 | contracts/unit/browser；受影响桌面与包检查，权限只读 |
| 平台集成 | 进程/UI/安装变化 | 三平台真实桌面、相关架构与安装器 |
| 完整验收 | 候选发行 | 全部必需 OS × distro × arch × variant、真实 JAR、签名安装、性能 |

统一命令采用主计划列出的 `yarn test:unit/test:script-host/test:contracts/test:browser/test:desktop/test:conversion/test:installers`，实施时在各工具真实能力内提供 case/target 过滤，不能捏造某框架不存在的 CLI 参数。所有 runner 必须输出实际发现与执行数量；零用例视为失败。

Node 业务与契约 job 在不提供 Rust/Cargo 的环境执行 schema 生成、类型检查和相关测试，确认已经解除旧 Cargo 导出依赖。Tauri 原生壳单独执行 `cargo fmt --all --check`、`cargo clippy --workspace --all-targets --locked -- -D warnings`、`cargo test --workspace --locked`；workspace 收敛为必要桌面入口/胶水，不含 Rust 业务工程。生产 feature 和 E2E feature 分别检查，不能用单次 `--all-features` 构建取代生产权限验证。

不得把故障测试直接指向开发者机器的真实项目或安装目录。安装器 runner 缺少隔离目标标识时拒绝执行；测试用的卸载、杀进程只作用于 manifest 登记的测试安装/进程所有权。

## 性能、稳定性和证据模板

P0 固定参考硬件/VM、数据、压缩算法和架构。候选门槛沿用主计划：Windows x64 bootstrap 至少减少 50%、关键交互 p95 小于 100 ms、转换吞吐不低于基线 90%、100 次循环无持续泄漏。这些是待验证目标，不能写成预测收益。

性能步骤：预热与冷启动分开 → 同负载重复测量 → 保存各次原值 → 计算分布/中位数/p95 → 标明失败/异常样本及原因。冷启动至少 10 次，交互每类至少 100 次作为初始采样计划；实际稳定性不足时增加样本并说明，不只删掉慢样本。

泄漏循环包括加载→选择→转换→取消或完成→重置；分别检查 GUI/WebView、Node backend、Node guardian、worker/helper、Java 的进程数、句柄和内存稳定态，并报告整个进程树总量，避免只看 GUI 而遗漏多 Node 进程成本。UI 日志保留窗口造成的正常增长与孤儿订阅增长分别解释。故障进入终态需在配置截止时间加已验证清理宽限内完成。

报告至少包含以下内容；本次不生成虚假的成功报告：

```text
reportVersion / taskId / caseIds / requirementIds
sourceCommit / dirtyTreeDigest / fixtureManifestHash
osImage / distro / arch / webviewVersion / nodeVersion / jdkJarHashes
buildFeatures / appDigest / installerDigest / variant
command / cwd / startedAt / duration / executedCaseCount / exitCode
expected / observed / comparison / normalizationRules
stdoutStderr / screenshots / processTreeBeforeAfter / networkEvidence
cleanupResult / retryHistory / unsupportedCases / verdict
```

可复现产物位于 CI artifact 或本地 `build/<task>/` 的任务输出，长期保留的摘要和清单在实施时建立索引。重试不能覆盖首轮失败证据；偶发问题记录触发条件、责任任务和恢复门槛，不以自动重试成功掩盖。

## P6 验收任务

| 任务 | 前置 | 执行 | 完成条件 |
| --- | --- | --- | --- |
| P6-01 | G2/G3/G4 | 审查 F/C/R/I → CF/SC/EX/UI/PK → 测试实现映射 | 每项有真实断言，无仅列名未实现的强制项 |
| P6-02 | P6-01 | 真实脚本/配置与固定 JAR 差分 | 无未解释兼容差异，BD 项有证据 |
| P6-03 | P6-01 | 故障/资源/取消/宿主死亡和 100 次循环 | 清理、无重放和主流程存活达到各平台合同 |
| P6-04 | G5 | 全目标安装/签名/离线/升级与卸载 | 必需变体齐全、报告绑定最终介质 hash |
| P6-05 | P6-02 至 P6-04 | 大小、启动、交互和吞吐测量 | 达标或明确阻塞，未删除功能/平台换取体积 |
| P6-06 | P6-05 | 汇总 G6 验收与剩余问题 | 无阻断缺陷、无未说明的能力删除，方可进入 P7 |
