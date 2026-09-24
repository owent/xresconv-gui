# 阶段记录索引

[返回执行计划](../README.md)

历史记录保留当时证据；当前实现状态、修复及复验以 [P2–P5 增量审查](REVIEW-P2-P5-2026-09-24.md) 为准，前次审查见 [P0–P3](REVIEW-P0-P3-2026-09-24.md)。P0 旧版基线未重跑，Windows 模块通过不等于跨平台阶段验收。

| 记录 | 内容 |
| --- | --- |
| [P0-01](P0-01.md) | 工作树和工具链基线 |
| [P0-02](P0-02.md) | 功能 fixture 与 manifest |
| [P0-03](P0-03.md) | 旧脚本接口与生命周期 |
| [P0-04](P0-04.md) | 真实旧 GUI/转换观察 |
| [P0-05](P0-05.md) | 大小、启动、树和日志性能基线 |
| [P0-06](P0-06.md) | 用户已定 D1–D5 |
| [P0-07](P0-07.md) | G0 审阅、BD-07 和后续限制 |
| [P0-08](P0-08.md) | 旧实现行为合同全量提取(main.js/setup.js 行号锚点) |

| 记录 | 内容 |
| --- | --- |
| [P2-01](P2-01.md) | guardian↔script-worker 接线与故障隔离 |
| [P2-02](P2-02.md) | 进程树监督（Job Object/taskkill 回退/POSIX 进程组）+ 故障注入与模块兼容实测 |
| [P2-03](P2-03.md) | script-host 五入口 worker(BD-S 清单) |
| [P2-05](P2-05.md) | NodeMirror：节点镜像/别名恒等/有序 ops 回流/排除诊断(BD-S15~17) |
| [P2-06](P2-06.md) | 弹框回调注册表与失效逻辑(SC06 全场景；BD-W10 有界留存) |
| [P2-07](P2-07.md) | watchdog 资源限额与内存耗尽验收(V8 堆顶/RSS 看门狗 BD-W11；BD-W7 修订) |
| [P2-08](P2-08.md) | matcher 隔离域(ReDoS 不阻塞日志服务；超时 fail-closed BD-M4；worker 补员) |
| [P2-09](P2-09.md) | 取消/重置/关闭统一收尾 + backend 监督(SC10/SC11/EX03；BackendSupervisor/长驻入口) |
| [P2-10](P2-10.md) | 发布目录离线模块加载验证(SC04/PK07 本机部分；回退锚点；esbuild 发行打包机制) |
| [P2-11](P2-11.md) | 真实脚本差分(xresconv-conf sample.xml 5 脚本逐字)与 BD 差异清单(BD-S18 新增) |
| [P2-12](P2-12.md) | G2 报告(SC01–SC11 全通过)与接口冻结(protocol v1 + 漂移守卫)；含 P2-04 吸收说明 |
| [P3-01](P3-01.md) | XML 配置加载器与 include 合并(BD-C 清单) |
| [P3-04](P3-04.md) | 匹配原语(partial,BD-M 清单) |
| [P3-05](P3-05.md) | 计划构建/stdin 编码器/Java 运行器(BD-P 清单) |
| [P3-06](P3-06.md) | 编排服务:set_name/事件链/取消/日志管线(BD-O 清单) |
| [P3-07](P3-07.md) | Java 批次调度/背压/退出汇总验收(EX02 矩阵；fake-converter；真实 JVM 并发) |
| [P3-10](P3-10.md) | G3 真实 JAR 差分(八格式 stdin vs 直 argv,SHA-256 全 MATCH) |

| 记录 | 内容 |
| --- | --- |
| [P4-01](P4-01.md) | UI 页面骨架与 tokens（11 区域组件、F01–F12→区域映射数据与断言、Tauri 适配层在途去重） |
| [P4-02](P4-02.md) | 业务 RPC 脊柱(壳↔guardian↔backend：backend-rpc 契约、BackendRpcApp、有界透传、事件转发) + Rust 壳通道（EventSink 解耦、0xc0000139 根因、fault 尽力关联） |
| [P4-03](P4-03.md) | 转换树与三态选择（后端 UI 选择 ops 扩展 + 前端树：adapter/store/RAC Tree 三态/键盘/搜索/StrictMode 订阅释放） |
| [P4-04a](P4-04a.md) | 转换参数覆盖存储与 RPC、预览 RPC（updateSettings/preview；有效值快照；输出冲突分组；契约按冻结规则 2 扩展） |

| 记录 | 内容 |
| --- | --- |
| [P5-01](P5-01.md) | 发行目标清单与 targets/manifest schema、命名和矩阵生成器（22 目标 = D1/D2 精确集合；PK01：重复/缺失/未知/禁架构/不一致均失败；清单卫生 lint 防开发机路径与秘密泄漏） |

| 记录 | 内容 |
| --- | --- |
| [P1-00](P1-00.md) | D6 骨架收敛审计（Rust 业务 → Node/TS） |
| [P1-01](P1-01.md) | 工具链固定与可复现构建 |
| [P1-02](P1-02.md) | Yarn 4 迁移、唯一锁文件 |
| [P1-03](P1-03.md) | 旧架构升级 Electron 44 + 真实基线回归 |
| [P1-04](P1-04.md) | backend/guardian 入口与壳→guardian→backend 握手链 |
| [P1-05](P1-05.md) | Vite 相对资源、图标、CLI 参数、空格/中文路径 |
| [P1-06](P1-06.md) | 契约唯一源（schema→TS/Ajv，无 Cargo） |
| [P1-07](P1-07.md) | lint/typecheck/Vitest/壳原生检查与来源索引 |
| [P1-08](P1-08.md) | Windows 桌面 E2E 最小构建实测 |
| [P1-09](P1-09.md) | G1 审阅：条件通过，三平台缺口待 CI |

本轮新增 D6 以 [主计划](../../../Plan.md) 为准：业务层改为 Node.js/TypeScript。已有 P1 文件不等于 G1 已通过；收敛与重验任务见 [P1-00](../01-baseline-toolchain.md)。历史记录中 Rust 工具链/实现方向只代表当时现场，不再指导新增 Rust 业务模块。
