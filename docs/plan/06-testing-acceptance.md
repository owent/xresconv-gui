# 06 测试实施与验收证据

[执行索引](README.md) · [上一册](05-packaging-release.md) · [下一册](07-cutover.md)

本册集中维护 C01–C15、R01–R12、I01–I14 类别及 CF/SC/EX/UI/PK 执行场景。测试编号保持固定，逐用例映射见 [P6-01](records/P6-01.md)，本机/真实项目汇总见 [P6-06](records/P6-06.md)，当前 CI 与发布范围见 [发布核对](records/RELEASE-2026-10-03.md)。第一轮用户验证已完成，不推断未提供记录的实机矩阵通过。

## 验收类别

Linux 权限用例须以普通用户运行，root/CAP_DAC_OVERRIDE 会绕过只读文件权限；最小构建容器须设置 UTF-8 locale（如 `LANG=C.UTF-8` / `LC_ALL=C.UTF-8`），否则本轮 OpenJDK 17 的文件名原生编码仍为 ASCII，`-Dfile.encoding=UTF-8` 不能替代它。容器内进程树测试须有 init 回收孤儿（Podman 使用 `--init`）；普通 shell 作为 PID 1 不满足该条件。WSL 挂载目录的大量并发模块读取可能触发短启动截止；先减少测试并发或移至 Linux 文件系统并保留首轮结果，不跳过失败用例。

### 功能与兼容类别 C01–C15

| 测试 ID | 场景 | 必须断言 |
| --- | --- | --- |
| C01 | 最小/完整 XML、CDATA、转义字符、空属性、非法 XML | 模型与公开合同一致；BD-07 明确修复旧转义/容错缺陷，失败可定位且不覆盖有效配置 |
| C02 | 多层 include、重复/循环 include、同名覆盖、跨目录 | 顺序、默认值、错误与路径基准正确 |
| C03 | 中文/空格/引号/UNC/长路径/软链接 | 文件与 Java 参数实际可用，无错误转义或路径串用 |
| C04 | 树级联、部分选择、禁止节点、展开收起、键盘 | UI 与 Node 业务服务选择集合一致，重绘/虚拟化不丢状态 |
| C05 | 精确/glob/regex、大小写、无效规则、灾难回溯 | 旧语义对照；超时不会阻塞 UI |
| C06 | 多 proto_file/data_src_dir、Java options/default_scheme | 数组和覆盖规则正确，重复值处理与基线一致 |
| C07 | 所有输出格式及单/多矩阵、tag/class、rename/output_dir | 任务集合、输出路径、实际内容正确；无效组合不能选中 |
| C08 | 多个选择器文件、默认选中、reload 和动作链 | 顺序、共享 data、错误中断及重载行为一致 |
| C09 | 五类脚本入口、启用/禁用/mutable、resolve/reject | 调用顺序、上下文、数据生命周期与结束语义符合契约 |
| C10 | D3 公开节点合同、对象别名和回调引用；未公开接口访问 | 公开数据镜像和操作回传正确，排除项有诊断/迁移说明，不依赖 jQuery/真实 DOM |
| C11 | 动态/相对 require、模块缓存、npm 与原生扩展 | 实际发行目录离线可加载；ABI 不符给出可行动错误 |
| C12 | adm-zip/compressing、log4js 自定义配置及轮转 | 归档 round-trip、文件日志内容、轮转和退出 flush 正确 |
| C13 | on_append_log 改写与递归、ANSI 和富文本 | 改写有序、原日志可追溯，不执行 HTML 中主动内容 |
| C14 | 所有启动参数、开发工具、文件对话框、版本/Java 检查 | 从安装目录/快捷方式/CLI 启动均正确 |
| C15 | 旧版与新版使用相同真实 JAR/输入 | 可确定输出字节比较；含时间戳等字段按预先定义规则归一化，不能忽略业务差异 |

### 故障与恢复类别 R01–R12

| 测试 ID | 注入 | 必须断言 |
| --- | --- | --- |
| R01 | 同步 throw、异步回调 throw、未处理 rejection | 脚本/任务进入预期失败态，GUI/主进程继续运行 |
| R02 | 同步死循环、Promise/定时器回调死循环、永不 resolve | 外部截止时间生效，终止并回收 worker，不依赖 worker 自身定时器 |
| R03 | process.exit、abort、可控原生崩溃、内存/Buffer 耗尽；backend/guardian 各自崩溃或挂起 | 只影响对应隔离域，桌面层仍可显示故障，运行可收尾并清理，无无限重启或副作用自动重放 |
| R04 | resolve/reject 多次、结束后回调、旧 generation 回包 | 最多结束一次，迟到消息被拒绝 |
| R05 | 按钮连点、重入、多个按钮、日志 hook 同时执行 | 按约定串行/并行，data 不串用，日志不死锁 |
| R06 | Java 启动失败、非零退出、信号、stdin 关闭、stdout/stderr 分块 | 终态与错误正确，不把日志块当任务完成 |
| R07 | 运行中取消/重置/关闭窗口/主宿主被终止 | 所属进程树清理，重开后无幽灵任务和旧回调 |
| R08 | 派生多层子进程、detached、持续后台进程 | 验证各平台清理边界；未满足的强隔离要求阻塞对应安全声明 |
| R09 | 日志风暴、超大/畸形 IPC、未知方法、版本错配 | 有界处理，拒绝非法输入，不拖垮 GUI |
| R10 | 两个配置会话、运行中更换配置、输出同名 | 版本隔离正确，旧任务不能覆盖新状态，冲突策略明确 |
| R11 | 宿主崩溃时已有文件副作用 | 不自动重试脚本或伪造回滚，清楚标记需用户核验 |
| R12 | 配置/日志富文本注入、危险 URL、原型污染 | 不能进入 UI 执行或调用任意 Tauri 能力 |

资源耗尽和原生崩溃测试在隔离的 CI/VM 中运行，外部监督进程自身有硬截止时间；每个用例结束检查子进程、句柄和临时文件，不在开发者日常环境制造无限资源消耗。

### 交付与运行时类别 I01–I14

每个正式支持的 OS × 发行版版本 × 架构 × 发行变体均执行下列适用用例；Windows/Linux 覆盖 bootstrap/offline，macOS 只发布 bootstrap，系统 WebView 特例按 05 册约定验收。

| 测试 ID | 初始状态/操作 | 必须断言 |
| --- | --- | --- |
| I01 | 已有满足要求的运行时，在线与断网 | 直接复用，无额外下载或安装 |
| I02 | 无运行时，bootstrap 在线 | 安装引导先于 GUI，安装完成复检后可运行 |
| I03 | 无运行时，offline 断网且无下载缓存 | 仅包内资源完成安装和启动，捕获网络访问证明 |
| I04 | 无运行时，bootstrap 断网 | 给出明确恢复办法，不白屏、不循环重试 |
| I05 | 运行时版本过旧 | 升级或明确拒绝；不误判“文件存在即可用” |
| I06 | 普通用户、管理员、拒绝提权、企业策略阻止 | 明确结果，无半安装后假成功 |
| I07 | 安装中断、文件损坏、校验失败、空间不足、包管理锁 | 安全退出，可恢复重试，不破坏已有系统运行时 |
| I08 | 从旧版升级、同版修复、卸载重装 | 配置和用户数据策略一致，共享系统运行时不随本应用卸载 |
| I09 | 中文/空格安装目录、只读目录、快捷方式启动 | Node、资源与脚本模块定位正确 |
| I10 | Windows ARM64、macOS 两架构、Linux 两架构 | 原生运行，无误装其他架构依赖 |
| I11 | macOS stapled 签名包离线首次打开 | Gatekeeper 与 sidecar 启动通过；过旧系统不伪装可补装 WKWebView |
| I12 | Linux 最小支持桌面与已更新桌面 | 离线闭包完整、复用已满足依赖，无外部仓库访问或强制降级 |
| I13 | 无系统 Node、无 npm 网络、无开发工具 | 用户脚本正常运行；不尝试安装开发依赖 |
| I14 | Java/JAR 缺失或不兼容 | GUI 正常显示诊断，与 GUI 运行时安装状态区分 |

Windows/Linux 当前为便携归档：I08 的升级/修复/卸载对应新目录替换、重解压与删除应用目录；不执行已取消的 NSIS/DEB/RPM 安装器流程。PK08/I11 的签名、公证与 Gatekeeper 属签名渠道 R6；当前无证书的开发预发布如实记录未签名，其他安全/许可/hash 检查仍必需。

## 测试目录与数据

| 实际目录/规划入口 | 内容 | 运行约束 |
| --- | --- | --- |
| `tests/fixtures/config` | 最小/完整 XML、include 图、非法/延迟/大配置 | UTF-8、来源与预期模型齐全 |
| `tests/fixtures/selectors` | 当前 docs/custom-selector.json 的冻结样本和边界规则 | 不修改真实用户选择器文件 |
| `tests/fixtures/scripts` | 五类正常脚本、对象别名、动态 require、模块缓存 | 标出旧/新允许差异与运行上下文 |
| `tests/fixtures/conversion` | 表格、协议、固定 JAR/JDK manifest、预期输出 | 大文件/外部 JAR 按哈希获取，不冒充当前仓库文件 |
| `packages/guardian/test/fixtures/fake-converter.mjs` | 可控制 stdin、stdout/stderr、退出和子树的假程序 | argv/stdin 原样捕获；与真实 JAR 测试分开 |
| `packages/script-host/test` | 真实 Node worker 和监督进程集成 | 每例有外部截止与清理检查 |
| `packages/backend/test` / `packages/guardian/test` | Node 业务、角色协议、监督与生命周期 | 独立进程故障注入；Node 单元/契约 job 无 Rust 依赖 |
| `apps/desktop/test` / `tests/browser` / `tests/desktop` | 浏览器 adapter 测试 / 原生 Tauri 测试 | 报告分别标识，不混称桌面验收 |
| 规划：隔离 VM/原生机验收记录（当前无 `tests/installers` runner） | R5 缺运行时、断网与目录替换/删除证据 | 只允许显式隔离测试环境执行故障/卸载 |

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
| SC11 | 分别阻塞/终止 backend、guardian；worker 伪报 backend 身份、向 stdout 注入帧、发送超大帧；可信 fork 通道断开/背压/发送回调后不响应；强杀桌面层进程 | 身份绑定实际通道；按字节限长后再解析不可信消息；发送回调不当作业务完成；独立监督截止可用，UI 故障可见，所属子树清理有实证，不自动重放 | F08/F09/F12、R03/R04/R07/R09/R10/R11/R12 |

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
| EX03 | 在 before/转换/after/收尾阶段取消、调用后端 reset RPC、关闭；同请求重投；强杀宿主 | 终态只发布一次，before 失败不启动 Java，取消后无迟到污染，无误杀无关进程 | F08、R04/R06/R07/R10 |
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

浏览器层使用 Playwright Chromium/WebKit/Firefox；当前真实应用层由 `tests/desktop/run.mjs` 管理外部 tauri-driver，WebdriverIO 直接连接它，再由 Windows msedgedriver / Linux WebKitWebDriver 驱动真实系统 WebView。CI 覆盖 Windows/Linux，macOS 留待单独验证；本仓库未使用 embedded provider 或测试专用 Rust 插件。上游另提供支持 macOS 的 embedded 方案，不能据此声称当前仓库覆盖三平台。[Tauri 测试文档](https://v2.tauri.app/develop/tests/webdriver/)、[WDIO Tauri](https://webdriver.io/docs/desktop-testing/tauri/)

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

当前根入口为 `corepack yarn lint` / `typecheck` / `test:unit` / `test:contracts` / `test:browser` / `test:desktop` / `test:conversion` / `check:shell` / `test:shell`；发行校验见 05/08 册。单脚本宿主测试用 `corepack yarn workspace @xresconv/script-host test`。根 `test:script-host` / `test:installers` / `package:verify` 尚未实现，不列为可执行命令。所有 runner 报告实际执行数，零用例失败；过滤参数按真实 CLI 核验。

Node 业务与契约 job 在不提供 Rust/Cargo 的环境执行 schema 生成、类型检查和相关测试，确认已经解除旧 Cargo 导出依赖。Tauri 桌面层单独执行 `cargo fmt --all --check`、`cargo clippy --workspace --all-targets --locked -- -D warnings`、`cargo test --workspace --locked`；workspace 收敛为必要桌面入口与接口适配代码，不含 Rust 业务工程。生产 feature 和 E2E feature 分别检查，不能用单次 `--all-features` 构建取代生产权限验证。

不得把故障测试直接指向开发者机器的真实项目或安装目录。安装器 runner 缺少隔离目标标识时拒绝执行；测试用的卸载、杀进程只作用于 manifest 登记的测试安装/进程所有权。

## 性能、稳定性和证据模板

P0 固定参考硬件/VM、数据、压缩算法和架构。质量门槛：Windows x64 bootstrap 至少减少 50%、关键交互 p95 小于 100 ms、转换吞吐不低于基线 90%、100 次循环无持续泄漏。Windows 本机达标证据见 P6-05，其他平台必须实测，不能外推收益。

性能步骤：预热与冷启动分开 → 同负载重复测量 → 保存各次原值 → 计算分布/中位数/p95 → 标明失败/异常样本及原因。冷启动至少 10 次，交互每类至少 100 次作为初始采样计划；实际稳定性不足时增加样本并说明，不只删掉慢样本。

泄漏循环包括加载→选择→转换→取消或完成→再次转换；另测后端 reset RPC。分别检查 GUI/WebView、Node backend、Node guardian、worker/helper、Java 的进程数、句柄和内存稳定态，并报告整个进程树总量，避免只看 GUI 而遗漏多 Node 进程成本。UI 日志保留窗口造成的正常增长与孤儿订阅增长分别解释。故障进入终态需在配置截止时间加已验证清理宽限内完成。

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

## 当前验收范围

- P6-01 映射审查/14 项子场景补齐与 P6-03 Windows 100 轮泄漏循环已完成，见 [P6-01](records/P6-01.md)。
- P6-02 自动化差分与真实项目已完成本机复验：八格式 JAR、官方 sample、五真实脚本；atsf4g-co 13 条目/26 任务/26 文件成功，见 [P6-06](records/P6-06.md)。
- P6-05 Windows 本机大小/吞吐/交互门槛达标，P6-06 为本机范围汇总；不是全平台 G6。
- dev.0 首次发布/第一轮用户验证见 [发布记录](records/RELEASE-2026-10-03.md)；9967c38 的 release 依赖失败见 [CI 修复记录](records/CI-FIX-2026-10-03.md)，651ea5e 的标题/Yarn 竞态及当前修复见 [桌面/缓存记录](records/CI-E2E-2026-10-03.md)。
- XML 隔离、Windows/Linux 门禁与最终包结果见 [执行记录](records/EXECUTION-2026-10-03.md)；当前本地回归与两平台桌面见桌面/缓存记录；额外实机、签名与 CI 后续范围集中至 [08 册](08-release-follow-up.md)，不维护第二份任务表。

## 当前自动化入口补充（2026-10-04 核对）

- 单元/契约入口保持 `corepack yarn test:unit` / `test:contracts`；本轮外层限时运行器及日志索引见审查记录。
- `test:browser` 使用本次生产构建启动独占 preview，整体上限 10 分钟，结果写入 `build/browser-test-results/`。工作区测试覆盖详情、输出矩阵、事件、弹框、主题、大字号、窄窗口和 axe。
- `test:desktop` 显式启动已安装的 tauri-driver / 原生 WebDriver，不隐式下载或附加测试插件。默认执行 `tauri build --debug --no-bundle`；构建上限 30 分钟、驱动就绪 15 秒、每轮测试 5 分钟；WDIO 建连超时 120 秒、重试次数 2，每项 Mocha 用例上限 60 秒。CI job 总上限 40 分钟；结束回收所属进程树。
- CI 的 `desktop-e2e` 等待 Node/Rust 质量 job 通过后并行运行 Windows/Linux。安装驱动后，Windows 另验证控制台回归并以 medium integrity 运行测试，Linux 用 xvfb-run 提供虚拟显示。默认空会话 9 项、CLI 加载会话 4 项，共 13 项；不将 debug 应用测试当作最终归档/离线介质验收。
- 桌面默认依次验证空会话、`tests/fixtures/config/tree-items.xml` 的首次 CLI 加载。测试前备份 exe 旁显示设置，每轮重置，最终恢复原字节；`XRESCONV_E2E_INPUT` 可覆盖加载文件，`XRESCONV_E2E_SKIP_BUILD=1` 只用于已确认匹配源码的本地二进制。
- 首个标题用例经 `waitForAppTitle` 等待导航就绪（30 秒 / 100ms 轮询），再执行原有精确断言；永久空/错误标题仍失败，不添加 spec 重跑。就绪回归由 desktop-e2e workspace 的 `test` 纳入根 `test:unit`。
- Edge WebDriver 的应用参数使用 `--input=路径`，不能拆成两个数组元素；浏览器标志应放 `webviewOptions.additionalBrowserArguments`。失败截图和 CLI/页面诊断保存在 `build/desktop-test-results/`。
- 真实转换使用 `tests/fixtures/conversion/runtime.mts` 解析 JAR/样本；缺失时显式跳过，多个 JAR 不猜测版本。配置方法和实跑命令见 [转换测试说明](../../tests/fixtures/conversion/README.md)。统一入口 `corepack yarn test:conversion`（即 `node tests/conversion/run-e2e.mjs`；缺 JAR/样本 exit 2 显式退出，相邻 target 有多个匹配 JAR 时必须显式设 `XRESCONV_TEST_JAR`）。
- Linux preflight 回归仅在 Linux 执行，mock sudo/ldconfig 后验证参数保真、分步安装与复检；不会安装系统包。Windows 跳过这两项必须保留在结果中。
