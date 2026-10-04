# 文档检查测试

`corepack yarn test:docs` 验证本地文档链接检查器的文件删除、中文及重复标题、代码块、图片、引用链接和编码路径处理。

测试在 `build/docs-validation` 创建独立输入目录，完成后回收，不修改正式文档。检查器实现见 [check-docs.mjs](../../scripts/check-docs.mjs)，完整检查入口为 `corepack yarn lint`。
