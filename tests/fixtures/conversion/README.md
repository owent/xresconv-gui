# conversion/ 转换对照 Fixtures

真实转换基线需要固定的 xresloader JAR、JDK 与示例表格，体积原因不进 Git。

- JAR/示例数据获取方式、版本与 SHA-256：见 `../legacy/manifest.json` 的 `external_artifacts` 与 `docs/plan/records/P0-04.md`。
- 旧版转换命令行形态（源码推导，`src/main.js:1955-2048`）：全局段 `-p <proto>`、`-a <data_version>`、`<option value 原样>`、`-f <proto_file>`（多值为 JSON 数组逐项）、`-d <data_src_dir>`（同前）；条目段 `-t <type> -n <rename> -o <output_dir> <item options 原样> -s <file> -m <scheme>` 或逐键 `-m key=value`。
- stdin 协议：每条任务一行，`\r\n` 结尾（`src/main.js:2100-2101`）；进程按 stdout/stderr data 事件触发下一条（BD-03）。
- 预期输出对比规则：字节级比较；含时间戳/版本字段的格式按 manifest 的 `normalization` 条目归一化后再比。

## 当前真实转换验证

`runtime.mts` 优先读取 `XRESCONV_TEST_JAR` / `XRESCONV_TEST_SAMPLE`；未设置时使用相邻仓库 `../xresloader/target/` 内唯一版本 JAR 与 `../xresloader/sample/`。有多个 JAR 时必须显式指定；缺少 JAR/样本的单元集成测试报告 skip，不伪造通过。

- `corepack yarn test:conversion`（= `node tests/conversion/run-e2e.mjs`）：八格式直 argv 与 stdin 差分，输出/报告在 `build/g3-e2e/`；外层运行须限时 10 分钟并回收进程树。缺 JAR/样本 exit 2 显式退出（脚本报 `[G3-E2E] required artifact missing`），不经管道取退出码。
- `node tests/conversion/project-smoke.mjs <可信项目 XML>`：加载无 before/after/log hook 的真实项目，覆盖 JAR 与全部矩阵输出目录，产物只写 `build/project-smoke/`，不修改原 XML。脚本有软取消期限，必须再加外层 4 分钟硬超时。
- 2026-09-30 复跑：`XRESCONV_TEST_JAR` 显式指向 xresloader-2.23.7.jar（相邻 target 同时存在 shaded 变体，自动解析按多 JAR 拒绝猜测），八格式全 MATCH，见 [P6-01](../../../docs/plan/records/P6-01.md)。此前 JAR=2.23.7，八格式 30 文件一致；真实项目 14 条目/28 任务/28 文件成功。环境、哈希和保留的测试记录见 [2026-09-27 审查](../../../docs/plan/records/REVIEW-2026-09-27.md)。
