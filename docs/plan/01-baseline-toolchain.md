# 01 基线与工具链

[执行索引](README.md) · [下一册](02-contracts-script-host.md) · [当前任务](08-release-follow-up.md)

P0/P1 实施已完成；旧基线、语言迁移和工具链批次不再列为活动任务。原始观察/命令/限制见 [records 索引](records/README.md) 的 P0-01～P0-08、P1-00～P1-09；当前平台构建/检查结果见 [发布核对记录](records/RELEASE-2026-10-03.md)。

## 基线入口与维护

| 验证记录 | 用途 |
| --- | --- |
| [P0-01](records/P0-01.md)、[P0-04](records/P0-04.md)、[P0-05](records/P0-05.md) | 旧工作树、真实 GUI/JAR、体积和性能；版本与原始口径固定 |
| [P0-02](records/P0-02.md)、[P0-03](records/P0-03.md)、[P0-08](records/P0-08.md) | F01–F12 数据、五入口/对象/回调/data、源码与 README 差异 |
| [P0-06](records/P0-06.md)、[P0-07](records/P0-07.md) | D1–D5、BD 分类与 G0 |
| [P1-00](records/P1-00.md)、[P1-06](records/P1-06.md) | D6 收敛与 JSON Schema/TS/Ajv 唯一源 |
| [P1-01](records/P1-01.md)、[P1-02](records/P1-02.md)、[P1-09](records/P1-09.md) | 工具链/Yarn 4 与骨架范围 |

基线必须来自固定旧应用环境；普通 Node 模拟节点不能证明 Electron/Fancytree 行为。旧应用与新应用写不同隔离输出目录，不能同时覆盖用户业务输出；测试失败不得自动用新结果重写 golden。

每个测试数据 manifest 保留 ID、F/C/R 映射、来源提交/哈希、旧版本、JDK/JAR 哈希、cwd/输入、旧观察/新预期、BD 编号、归一化规则。大安装包/日志留在带 digest 的测试产物，不提交绝对开发机路径或私人业务数据。

## 当前工具链约定

- Node LTS ≥24，当前发行目标 Node 24；明确开发工具与随包 Node 的版本/架构/ABI。
- Yarn 4 经 Corepack，根 `packageManager` 为准；`nodeLinker: node-modules`，唯一 JS 锁为 `yarn.lock`。安装 `corepack yarn install --immutable`。
- Tauri 2、必要插件、Cargo.lock 与 Rust 工具链只服务桌面层；backend/guardian/领域/协议源使用 Node/TS。
- contracts 在无 Rust 的 Node 环境生成类型并测试；不恢复 Cargo schema 导出。guardian 不导入 XML/转换规则/用户脚本，前端只经 adapter 调用 backend。
- 当前命令以根 `package.json` 和 [06 册](06-testing-acceptance.md) 为准；旧 Electron/gulp/prepare 已于 P7 删除，回退使用 v2.6.0。

## 依赖升级与冻结

每批升级先查官方稳定 release/迁移文档，再更新锁文件和相关行为测试。直接/传递包处理结果分别记录升级保留、适配保留、架构移除或明确阻塞；不强推不兼容 peer/传递版本。

| 对象 | 核验字段与回归 |
| --- | --- |
| npm/JS | 精确版本/integrity/engines/peer/生命周期脚本；动态 require、模块 cache、glob、归档往返、日志扩展 |
| Node | 通道/官方归档/哈希/支持系统/架构/原生模块 ABI；不静默改发行目标 |
| Tauri/Rust | CLI/JS API/插件兼容、MSRV/feature/triple；原生传递依赖按上游契约更新 |
| Actions | 稳定 v 数字 tag、action.yml runtime、runner/权限/嵌套 uses；当前工作流用版本标签 |
| 系统与打包工具 | SDK/编译器/7-Zip/zstd/WebView、macOS bundle 工具；Linux 最老构建基线 |

已有 `scripts/check-toolchain.mjs` 检查本机 Node/Yarn/Rust/packageManager；Yarn 精确版本读取根 packageManager，并经 corepack 查询实际版本，随包 Node 目标以 targets.json 为准。它不自动升级，也不证明全部框架/Action 为当前最新。历史选型快照见 [来源索引](../ai/source-index.md)，发行冻结前重新核验易变事实。

回退对应升级批次、锁文件和受影响文档，保留用户既有改动；基线预期变化须人工审阅差异理由。

## 来源

[Yarn nodeLinker](https://yarnpkg.com/configuration/yarnrc#nodeLinker)、[Tauri sidecar](https://v2.tauri.app/develop/sidecar/)、[来源索引](../ai/source-index.md)。历史迁移/旧 ASAR 限制只用于记录复现，不继续指导新构建。
