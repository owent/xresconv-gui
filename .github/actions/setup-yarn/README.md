# Yarn 安装与缓存

CI、release、Portable 的 JS 安装入口统一调用本 action；调用前须 checkout 并 setup-node。

- Corepack 读取根 packageManager（当前 Yarn 4.18.1），不另装 npm/pnpm。
- 安装时关闭 global cache，实际 cacheFolder 和 Actions 缓存路径都为 `build/yarn-cache`。
- archives 按 OS/CPU/锁文件/配置/根 package 区分；部分命中仍完整执行 `yarn install --immutable`，不缓存 node_modules。
- 安装成功立即保存新 key，后面的测试失败仍能复用依赖；安装失败保持非零，不关闭 TLS 或跳过锁校验。
- Windows 用 pwsh，POSIX 用 bash；不嵌套其他 shell。使用已核验的 actions/cache restore/save v6.1.0。

实现见 [action.yml](action.yml)，调研/回归见 [CI 记录](../../../docs/plan/records/CI-E2E-2026-10-03.md)；本地包管理默认 global cache 策略不变。
