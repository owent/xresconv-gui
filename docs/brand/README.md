# 图标资源

## 母版与用途

主图形以表格和向右箭头表达批量数据转换。深蓝 #102B3A 为背景，青绿 #35C9B5 标记输入，琥珀 #FFB45E 表示转换方向。图标无文字，缩小后仍需检查辨识度。

| 文件 | 用途 |
| --- | --- |
| [app-icon.svg](app-icon.svg) | 可编辑 SVG 母版 |
| `src-tauri/icons` | PNG、ICO、ICNS 桌面资源 |
| `docs/logo.png` / `logo.ico` / `logo.icns` | 文档和共享导出 |
| `apps/desktop/public/favicon.png` | 前端图标 |

## 生成与验证

从仓库根执行 `corepack yarn tauri icon docs/brand/app-icon.svg -o build/icon-generation`，将桌面 PNG、ICO、ICNS 复制到 src-tauri/icons，共享 logo 复制到 docs，32x32.png 复制到前端 favicon.png。仅保留桌面需要的导出。

检查 32 px 预览、明暗桌面背景、实际窗口和任务栏效果。图标、媒体和不透明二进制通过 .gitattributes 使用 Git LFS，源码和文档保持普通文本。克隆后执行 git lfs pull，打包前确认资源不是 LFS 指针；生成中间文件完成后清理。
