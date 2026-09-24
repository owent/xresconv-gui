# 阶段记录索引

[返回执行计划](../README.md)

历史记录保留当时证据；当前实现状态、修复及复验以 [2026-09-24 代码审查](REVIEW-P0-P3-2026-09-24.md) 为准。P0 旧版基线未重跑，P1/P2/P3 模块通过不等于跨平台阶段验收。

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
| [P2-03](P2-03.md) | script-host 五入口 worker(BD-S 清单) |
| [P3-01](P3-01.md) | XML 配置加载器与 include 合并(BD-C 清单) |
| [P3-04](P3-04.md) | 匹配原语(partial,BD-M 清单) |
| [P3-05](P3-05.md) | 计划构建/stdin 编码器/Java 运行器(BD-P 清单) |
| [P3-06](P3-06.md) | 编排服务:set_name/事件链/取消/日志管线(BD-O 清单) |
| [P3-10](P3-10.md) | G3 真实 JAR 差分(新栈 stdin vs 直 argv,SHA-256 全 MATCH) |

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
