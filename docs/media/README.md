# 界面素材

本目录保存应用界面的截图与动图，首页及用户文档通过相对路径引用。

| 文件 | 内容 |
| --- | --- |
| [workflow.gif](workflow.gif) | 选择、转换前确认、转换日志与结果 |
| [theme-ui.gif](theme-ui.gif) | 显示设置、主题切换与搜索 |
| [main-light.png](main-light.png) | 亮色主界面与日志 |
| [script-dialog.png](script-dialog.png) | 脚本确认弹窗 |
| [real-project-light.png](real-project-light.png) / [real-project-dark.png](real-project-dark.png) | 工程配置的亮色和暗色界面 |
| [details.png](details.png) | 工具、目录与协议详情 |
| [output-matrix.png](output-matrix.png) | 输出矩阵与重命名 |

## 更新方法

使用当前应用加载可公开的配置与样本，截图覆盖主界面、设置、输出矩阵和脚本弹窗。转换演示使用真实 JAR 与表格，将输出重定向到 `build/<task-name>`，避免修改业务目录。

可以通过桌面 WebDriver 或显式启用的 WebView2 调试接口采集帧，再用 ffmpeg 调色板流程生成 GIF。采集脚本、帧与中间文件仅放 `build/<task-name>`，完成后清理。截图中的路径、日志和数据需去除敏感内容。

复制最终素材到本目录，保持文件名与引用一致，并检查亮暗主题、字号、布局和图片尺寸。媒体使用 Git LFS，构建与预览前执行 git lfs pull。
