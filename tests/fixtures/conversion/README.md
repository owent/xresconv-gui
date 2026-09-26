# conversion/ 转换对照 Fixtures

真实转换基线需要固定的 xresloader JAR、JDK 与示例表格，体积原因不进 Git。

- JAR/示例数据获取方式、版本与 SHA-256：见 `../legacy/manifest.json` 的 `external_artifacts` 与 `docs/plan/records/P0-04.md`。
- 旧版转换命令行形态（源码推导，`src/main.js:1955-2048`）：全局段 `-p <proto>`、`-a <data_version>`、`<option value 原样>`、`-f <proto_file>`（多值为 JSON 数组逐项）、`-d <data_src_dir>`（同前）；条目段 `-t <type> -n <rename> -o <output_dir> <item options 原样> -s <file> -m <scheme>` 或逐键 `-m key=value`。
- stdin 协议：每条任务一行，`\r\n` 结尾（`src/main.js:2100-2101`）；进程按 stdout/stderr data 事件触发下一条（BD-03）。
- 预期输出对比规则：字节级比较；含时间戳/版本字段的格式按 manifest 的 `normalization` 条目归一化后再比。

状态：`pending-runtime`，P0-04 采集后回填。
