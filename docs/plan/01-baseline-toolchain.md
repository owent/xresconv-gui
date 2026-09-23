# 01 基线、依赖与工程骨架

[执行索引](README.md) · [下一册：脚本宿主](02-contracts-script-host.md)

对应主计划 P0/P1。本文所有目标文件、命令及实现任务均为拟新增；依赖版本以主计划版本表及实施时核验结果为准。

## P0：建立可比较的基线

| 任务 | 前置/输入 | 操作与产物 | 验收 |
| --- | --- | --- | --- |
| P0-01 | 当前工作树 | 记录 HEAD、暂存/未暂存/未跟踪文件清单及相关文件哈希；确定用于对照的工作树快照 | 用户改动完整；当前 `docs/` 迁移不被旧 `doc/` 路径覆盖 |
| P0-02 | P0-01、源码与 README | 建立 `tests/fixtures/legacy/manifest.json`，为 F01–F12 收集配置/输入/输出/事件轨迹 | 每项有来源、哈希和观察方法；不能执行的样例明确缺口 |
| P0-03 | 五类脚本入口 | 提取上下文属性、属性类型、对象别名、回调和 data 生命周期；登记 DOM/Electron/Fancytree 使用 | SC 用例覆盖真实样本；源码/文档分歧逐条记录 |
| P0-04 | 旧应用、固定 JDK/JAR | 在隔离数据目录运行旧版；记录配置模型、argv/stdin、文件输出与事件顺序 | 产物归属可追溯，不能把发行版 Electron 41.1.0 当成本地 41.10.3 |
| P0-05 | P0-04 | 测压缩/展开大小、启动、10k/100k 节点、日志、转换吞吐；生成基线报告 | 同硬件、同压缩口径、同业务输入，有原始测量而非单个主观值 |
| P0-06 | D1–D5 | 平台/脚本/权限决策记录，列出阻塞任务及可继续项 | 候选平台不被写成已经支持；不以未答复当同意 |
| P0-07 | P0-02 至 P0-06 | 完成 G0 审阅，固定一套不可自动重写的预期结果 | 每个差异都能归入兼容契约或显式 BD 变更 |

P0 先形成 fixture、观察记录和最小对照入口；需要新测试框架的自动化在 P1 接入。基线采集必须使用实际旧应用执行环境，不能在普通 Node 中模拟 Fancytree 后声称验证了 Electron 行为。基线应用与新应用使用不同临时输出目录，绝不同时转换到用户原输出目录。

### 基线文件格式

每个 fixture 至少包含：`fixtureId`、对应 F/C/R 类别、来源路径/提交/哈希、旧应用版本、JDK/JAR 哈希、工作目录、输入文件、旧观察结果、预期新结果、差异编号、允许归一化字段。禁止把绝对开发机路径、真实凭据或私人表格直接提交。

建议在 `tests/fixtures/` 分别保存 `config/`、`selectors/`、`scripts/`、`conversion/`、`faults/`；每个目录有 README，解释数据来源与执行方法。体积大的基线包及日志保存在带校验值的测试产物中，不把全部安装器提交到 Git。

必须采样的源码锚点：

| 来源 | 要观察的行为 |
| --- | --- |
| `src/main.js` 的 `build_conv_tree` | include、同名覆盖、脚本文本、数组、默认值、set_name 突变 |
| `run_custom_button_action_script` / `run_custom_button_action` | 共享按钮 data、动作顺序、错误/未知动作、重载 |
| `logger_append_style_message` | 同条日志共享 VM、递归保护、部分修改后异常、上下文存在条件 |
| `conv_start` / `run_one_cmd` / `handle_exit_fn` | 计划冻结、pending 栈顺序、并发、输出触发派发、exit/error/close 去重 |
| `alert_warning` | yes/no 后 on_close 顺序；关闭按钮/ESC 行为单独观察，不能照注释推断 |
| `src/setup.js`、`gulpfile.js`、工作流 | 参数、窗口、资源路径、架构、压缩及发行触发 |

include 代码中后续 `ret.then(load_sub_file)` 没有回写 `ret`；需用两个延迟不同的 include 复现其排序和父配置提交行为。不能把推测的串行顺序当已证明的旧合同，也不能把偶发竞态固化为新实现要求。

## P1：升级批次与回退

| 批次 | 对象 | 策略 | 失败时 |
| --- | --- | --- | --- |
| A | Node、Corepack、Yarn | 独立锁版本和 engines；先能重现旧构建，再迁移 lockfile | 保留升级前基线；解决工具链冲突，不改业务预期 |
| B | adm-zip、compressing、minimatch、log4js | 验证动态 require、导出形式、glob、归档和日志兼容 | 记录具体变更；选择适配层，禁止强推不兼容传递版本 |
| C | Electron、packager、gulp 与过渡 UI 库 | 可回退批次更新；原 macOS ASAR 约束在旧架构仍有效 | 架构停止支持进入 D1；不偷偷改变发行矩阵 |
| D | React/TypeScript/Vite、Tauri/Rust 插件 | 按目标架构建立独立入口；新旧入口短期可对照 | 不删旧实现；冲突回到选型合同 |
| E | 测试、类型/lint、Actions | 按官方兼容范围成组升级，完整 SHA 固定 Actions | 禁止忽略失败或 force peer 安装 |

“更新所有依赖”的处理结果必须逐项是：升级保留、适配后保留、架构移除、明确阻塞。新架构删除的 jQuery 等包不需要为长期保留而额外包装。传递依赖通过合法解析更新，不越过父包版本契约。

### 版本核验清单

拟新增 `scripts/check-toolchain.*` 和 `docs/plan` 所引用的实施版本报告，记录以下字段：

- npm：registry、精确版本、integrity、engines、peerDependencies、平台可选包、生命周期脚本。
- Rust：crate 版本、校验值、MSRV、feature、目标支持；提交 Cargo.lock。
- Node：发行通道、支持平台、官方归档与校验值；明确 Current 与 LTS 的选择。
- Action：稳定 tag、完整 commit SHA、action.yml runtime、runner 要求、权限、嵌套 `uses`。
- OS/打包工具：SDK、编译器、NSIS、签名工具、Linux 仓库快照；不把 Tauri 上游固定的内部依赖强行替换成不兼容版本。

核验脚本只产生报告/建议，不能在每次构建自动升级。主计划快照不是可永久复用的 latest 证明；P1 与发行冻结前各刷新一次。

### 具体任务

| 任务 | 依赖 | 拟改文件/产物 | 完成断言 |
| --- | --- | --- | --- |
| P1-01 | G0 | 工具链报告、`package.json`、`.yarnrc.yml`、`rust-toolchain.toml` | 精确版本及 peer/MSRV 全部可解释 |
| P1-02 | P1-01 | Yarn 4 lockfile、工作区定义；清理两份非权威锁文件 | `yarn install --immutable` 不改锁；node-modules 布局保留动态加载 |
| P1-03 | P1-02 | 旧架构依赖升级批次与对应回归 | 旧功能对照可运行；过渡期 prepare 不破坏新包 |
| P1-04 | P1-01 | `apps/desktop/`、`src-tauri/`、`crates/`、`packages/` | 新旧启动入口可区分；三平台窗口和原生选文件启动成功 |
| P1-05 | P1-04 | Vite 资源路径、Tauri 资源映射、图标、CLI 参数入口 | 安装目录含空格/中文仍可定位资源，无 HTTP 服务依赖 |
| P1-06 | P1-04 | `crates/protocol/`、Schema/TS 生成器、共享消息样例 | Rust/JS 对同一合法及非法输入判断一致 |
| P1-07 | P1-04 | Biome、tsconfig、Vitest、Rust 检查；更新来源索引 | lint/typecheck/test 命令失败能返回非零；不加载生产凭据 |
| P1-08 | P1-05、P1-07 | 原生桌面 E2E 最小测试构建 | 三平台真实应用握手通过；测试插件被独立 feature 控制 |
| P1-09 | P1-03 至 P1-08 | G1 报告、工具链和骨架审阅 | 不依赖开发机全局模块；未通过项有明确阻塞 |

包管理迁移必须检查根 `prepare` 对 Fancytree 的补丁与复制库动作。过渡期保留旧入口专用准备步骤，新应用构建不能自动复制 jQuery；P7 再删除失效步骤。`package.json` 目前仍引用 `doc`，而工作树已迁移部分资源到 `docs`，实施时用真实资源清单核验，不能照旧字段继续打包。

## 工程边界和质量入口

Rust 领域 crate 不依赖 Tauri 窗口；脚本协议包不导入 React；前端组件通过 adapter 调用领域命令。禁止 `packages/contracts` 反向依赖业务包，生成结果的更新必须经契约测试。

拟新增命令：`yarn lint`、`yarn typecheck`、`yarn test:contracts`、`yarn test:unit`、`yarn test:desktop`。保留现有启动/打包命令直至 P7 交接，映射变化写进开发文档。安装阶段禁止依赖“构建时顺便下载”的未登记运行文件。

回退单位是该升级批次和对应锁文件/文档，不回退用户原有源码改动。基线预期文件修改必须显示差异理由；不得自动用新实现输出覆盖旧结果。

## 参考与证据

- [Yarn nodeLinker 配置](https://yarnpkg.com/configuration/yarnrc#nodeLinker)：目标使用普通 node_modules。
- [Tauri 外部程序](https://v2.tauri.app/develop/sidecar/)：资源命名与目标架构必须一致；监督仍由本项目实现。
- [来源索引](../ai/source-index.md)：版本快照和新测试体系的复查登记。
