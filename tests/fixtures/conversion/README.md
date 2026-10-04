# 转换对照数据

真实转换需要 xresloader JAR、兼容 Java 和上游示例表格。`runtime.mts` 优先读取 XRESCONV_TEST_JAR / XRESCONV_TEST_SAMPLE，未设置时使用相邻 xresloader 仓库；多个候选 JAR 拒绝猜测。

`golden` 保存用于字节比较的输出及 SHA256SUMS。对含非稳定内容的格式按测试规则归一化，不能仅比较文件数或退出码。

- `corepack yarn test:conversion`：八格式 argv 与 stdin 输出差分，报告放入 build；缺 JAR/样本 exit 2。
- `node tests/conversion/project-smoke.mjs <trusted-project.xml>`：加载没有 before/after/log hook 的可信项目，将所有输出重定向到 build/project-smoke。

差分入口使用外层 10 分钟截止，project smoke 使用外层 4 分钟截止，两者均需回收所属进程树。单元集成测试缺外部文件时显式 skip，不能报告为真实转换通过。详见[测试文档](../../../docs/development/testing.md#真实转换)。
