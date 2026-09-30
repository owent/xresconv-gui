# 界面素材索引（3.0 新版）

本目录保存 3.0 新界面的 README 展示素材，均为**真实发行包实拍**（非设计稿）：
2026-09-30 采集于 Windows x64、bootstrap 变体解压布局、应用版本 3.0.0-dev.1。

| 文件 | 内容 | 采集方式 |
| --- | --- | --- |
| `workflow.gif` | 转换流程：全选 → 开始转换 → on_before_convert 确认弹窗 → 真实 xresloader 转换日志 → 成功结果 | 演示配置（官方样本表格，bin+lua 双输出矩阵） |
| `theme-ui.gif` | 显示设置 → 暗色主题切换 → 条目搜索过滤 | 真实工程配置加载态 |
| `main-light.png` | 转换成功后的主界面（亮色，含运行结果与日志） | 同 workflow 演示配置 |
| `script-dialog.png` | on_before_convert 中 alert_warning 的确认弹窗 | 同上 |
| `real-project-light.png` / `real-project-dark.png` | 真实工程（atsf4g-co 生成配置）加载后的亮/暗主界面 | 8 分组树与双输出矩阵 |
| `details.png` | 详细配置对话框（转表工具/目录/协议等） | 真实工程配置 |
| `output-matrix.png` | 输出矩阵与重命名规则面板 | 真实工程配置 |

## 更新方法

素材由脚本自动采集（WebView2 CDP 驱动真实应用 + ffmpeg 合成 GIF），不在 UI 改版后手工截图：

1. 构建发行布局：`corepack yarn package:windows --portable --variant=bootstrap`，
   解压 `build/dist/*bootstrap.7z` 到 `build/p6-05/run2/xresconv-gui/`；
2. 采集：`node build/p6-media/capture2.mjs`（产物在 `build/p6-media/media2/`，
   含 10fps 截帧目录与 still 图片）；
3. 合成 GIF：ffmpeg 调色板两步法（960 宽、8fps，命令见 `build/p6-media/README.md`）；
4. 复制到本目录并按上表命名，README 引用路径不变。

演示配置为 `build/p6-media/demo.xml`（真实 JAR + 官方样本表格，输出重定向到
`build/p6-media/out/`）；真实工程配置位于相邻 atsf4g-co 仓库（只加载与界面操作，
不执行写盘转换）。
