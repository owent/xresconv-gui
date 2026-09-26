# 01 基线、依赖与工程骨架

[执行索引](README.md) · [下一册：脚本宿主](02-contracts-script-host.md)

对应主计划 P0/P1。P0 与 P1 已完成并有 Windows 实测记录（P1-00～P1-09；Actions 升级与 Linux/macOS 骨架实测待 CI）；按 D6 调整后的去向登记与迁移已完成，既有产物未删除。依赖版本以主计划快照和实施时核验为准，命令是否可用须看实际实现与记录。

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

### P1-00：现有骨架收敛为 Node 业务层

P1-00 已按下表完成既有代码与测试的迁移审计，去向登记见 [P1-00](records/P1-00.md)；不实际删除 crates、不修改 Cargo 或 Node 锁文件的边界在当时登记中生效，替代测试通过后才移除旧模块。保留 P0 fixtures/golden 和旧验证记录；仅因实现语言变化，不自动重写预期输出。

| 当前工作树对象 | 目标处理 | 验收/依赖 |
| --- | --- | --- |
| `crates/config` | 将 XML 校验意图/测试转到 `packages/backend` 的 TS 配置模块，使用经 fixture 验证的 JS 解析器 | CF01–CF03；保留 BD-07，完成替代后移除旧 crate |
| `crates/domain` | 状态枚举与终态规则转为 TS 领域模块 | CF06/EX03；状态机不得两份并行维护 |
| `crates/process-supervisor` | timeout/回收测试迁至 `packages/guardian`；旧单进程 smoke 不算进程树已验收 | SC07/SC08/SC11；不继续开发 Rust guardian |
| `crates/protocol` | 已有协议样例保留，JSON Schema 迁成 `packages/contracts/schema` 的唯一源 | SC01、现有合法/非法样例；移除 cargo schema 导出依赖 |
| `packages/contracts` | 保留 json-schema-to-typescript/Ajv 流程，修改 generate:schema/类型来源注释 | 无 Cargo 的 Node 环境也能生成类型并运行契约测试 |
| `src-tauri` | 保留窗口/CLI/对话框/opener/必要消息桥，移除对业务 crates 的依赖 | 真实壳→guardian→backend 往返；不复制领域逻辑到 Tauri command |
| `Cargo.toml/lock`、工具链文件 | 仅保留 Tauri 壳所需工作区和依赖；清理业务专用项，保留实际需要的原生传递依赖 | 原生构建与最小桥接测试仍通过，不能整体删除 Cargo |
| `package.json`、Yarn、Vite/Biome/Vitest、现有前端 | 复用已经做出的依赖和骨架工作，补 backend/guardian workspaces | 不重做无关升级；Node 单测/契约不调用 Cargo |

P1-00 的审计报告区分：可直接保留、需迁移、迁移后删除、尚无验证。其迁移项分别并入 P1-04/P1-06/P2/P3，相关替代测试通过后才移除旧模块；不能先删代码再用空测试证明新架构通过。

### 升级批次

| 批次 | 对象 | 策略 | 失败时 |
| --- | --- | --- | --- |
| A | Node、Corepack、Yarn | 独立锁版本和 engines；先能重现旧构建，再迁移 lockfile | 保留升级前基线；解决工具链冲突，不改业务预期 |
| B | adm-zip、compressing、minimatch、log4js | 验证动态 require、导出形式、glob、归档和日志兼容 | 记录具体变更；选择适配层，禁止强推不兼容传递版本 |
| C | Electron、packager、gulp 与过渡 UI 库 | 可回退批次更新；原 macOS ASAR 约束在旧架构仍有效 | 架构停止支持进入 D1；不偷偷改变发行矩阵 |
| D | React/TypeScript/Vite、Tauri 官方插件、Node backend/guardian | 复用薄壳与前端；业务统一 TS/Node，不新增 Rust 领域工程 | 不删未完成替代的实现；冲突回到合同 |
| E | 测试、类型/lint、Actions | 按官方兼容范围成组升级，完整 SHA 固定 Actions | 禁止忽略失败或 force peer 安装 |

“更新所有依赖”的处理结果必须逐项是：升级保留、适配后保留、架构移除、明确阻塞。新架构删除的 jQuery 等包不需要为长期保留而额外包装。传递依赖通过合法解析更新，不越过父包版本契约。

### 版本核验清单

拟新增 `scripts/check-toolchain.*` 和 `docs/plan` 所引用的实施版本报告，记录以下字段：

- npm：registry、精确版本、integrity、engines、peerDependencies、平台可选包、生命周期脚本。
- Tauri 原生依赖：仅核验壳与实际所需插件的 crate/MSRV/feature/目标，保留 Cargo.lock；不再维护业务专用 Rust 依赖清单。
- Node：发行通道、支持平台、官方归档与校验值；明确 Current 与 LTS 的选择。
- Action：稳定 tag、完整 commit SHA、action.yml runtime、runner 要求、权限、嵌套 `uses`。
- OS/打包工具：SDK、编译器、NSIS、签名工具、Linux 仓库快照；不把 Tauri 上游固定的内部依赖强行替换成不兼容版本。

核验脚本只产生报告/建议，不能在每次构建自动升级。主计划快照不是可永久复用的 latest 证明；P1 与发行冻结前各刷新一次。

### 具体任务

| 任务 | 依赖 | 拟改文件/产物 | 完成断言 |
| --- | --- | --- | --- |
| P1-00 | G0、D6、当前工作树 | 上述保留/迁移/删除审计，更新 P1–P3 验证范围 | 不改 P0 历史证据；每个 Rust 业务模块有 Node 替代任务 |
| P1-01 | P1-00 | 工具链报告、`package.json`、`.yarnrc.yml`、仅供 Tauri 的 `rust-toolchain.toml` | 精确版本及 peer/MSRV 全部可解释 |
| P1-02 | P1-01 | Yarn 4 lockfile、工作区定义；清理两份非权威锁文件 | `yarn install --immutable` 不改锁；node-modules 布局保留动态加载 |
| P1-03 | P1-02 | 旧架构依赖升级批次与对应回归 | 旧功能对照可运行；过渡期 prepare 不破坏新包 |
| P1-04 | P1-01 | 复用 apps/desktop 与薄 src-tauri，建立 packages/backend/guardian 入口 | 三平台窗口/选文件与 Node 服务握手成功，不承载 Rust 业务 |
| P1-05 | P1-04 | Vite 资源路径、Tauri 资源映射、图标、CLI 参数入口 | 安装目录含空格/中文仍可定位资源，无 HTTP 服务依赖 |
| P1-06 | P1-04 | packages/contracts 的 JSON Schema/TS/Ajv，移除 Cargo 导出 | UI/各 Node 角色判断一致；最小 Tauri 桥接拒绝越权/过大请求 |
| P1-07 | P1-04 | Biome、tsconfig、Vitest 和壳的原生检查；更新来源索引 | Node 业务测试不依赖 Rust；原生壳仍有独立构建验证 |
| P1-08 | P1-05、P1-07 | 原生桌面 E2E 最小测试构建 | 三平台真实应用握手通过；测试插件被独立 feature 控制 |
| P1-09 | P1-03 至 P1-08 | G1 报告、工具链和骨架审阅 | 不依赖开发机全局模块；未通过项有明确阻塞 |

包管理迁移必须检查根 `prepare` 对 Fancytree 的补丁与复制库动作。过渡期保留旧入口专用准备步骤，新应用构建不能自动复制 jQuery；P7 再删除失效步骤。工作树 package.json 已改为 docs 资源路径，保留该迁移并用实际资源清单核验。

## 工程边界和质量入口

packages/backend 的领域模块不依赖 Tauri/React，可在纯 Node 环境运行。guardian 只负责消息路由/截止/进程所有权，不导入 XML、转换规则或用户脚本。contracts 不反向依赖业务包；前端只经 adapter 调用服务，生成类型的更新必须经契约测试。

目标命令：`yarn lint/typecheck/test:contracts/test:unit/test:desktop`，其中已有脚本先审计再复用。配置/状态机/调度/契约测试统一 Vitest/Node；Cargo 仅用于 Tauri 壳。保留旧启动/打包命令直至 P7 交接，禁止构建时下载未登记运行文件。

回退单位是该升级批次和对应锁文件/文档，不回退用户原有源码改动。基线预期文件修改必须显示差异理由；不得自动用新实现输出覆盖旧结果。

## 参考与证据

- [Yarn nodeLinker 配置](https://yarnpkg.com/configuration/yarnrc#nodeLinker)：目标使用普通 node_modules。
- [Tauri 外部程序](https://v2.tauri.app/develop/sidecar/)：资源命名与目标架构必须一致；监督仍由本项目实现。
- [来源索引](../ai/source-index.md)：版本快照和新测试体系的复查登记。
