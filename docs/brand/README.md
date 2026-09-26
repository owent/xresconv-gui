# 应用视觉资源

## 设计合同

主图形用表格与向右箭头表达“从表格批量转换出数据”。深蓝底色 `#102B3A` 与浅色表格保证明暗桌面背景下都可辨认；青绿 `#35C9B5` 标记输入，琥珀色 `#FFB45E` 标记转换方向。图标不含文字，适合缩小到任务栏尺寸。

选用 SVG 母版和 Tauri 2 官方图标生成器，保持 Windows ICO、macOS ICNS、Linux PNG 与网页图标一致。输出文件在 Git LFS 中；回滚时可恢复本目录母版及对应的生成文件。风险是小尺寸缩放会减少网格细节，需检查 32 px 预览和各平台实际窗口图标。

## 文件与生成

| 文件 | 用途 |
| --- | --- |
| [app-icon.svg](app-icon.svg) | 唯一可编辑母版（512 × 512，SVG） |
| `../../src-tauri/icons/` | Tauri 桌面包：PNG、ICO、ICNS |
| `../logo.png`、`../logo.ico`、`../logo.icns` | 旧 Electron 窗口与打包入口 |
| `../../apps/desktop/public/favicon.png` | 新前端网页图标 |

从仓库根目录执行 `corepack yarn tauri icon docs/brand/app-icon.svg -o build/icon-generation`，然后复制该目录中的 `icon.png`、`icon.ico`、`icon.icns`、`32x32.png`、`128x128.png`、`128x128@2x.png` 到 `src-tauri/icons/`。将前三种格式复制到 `docs/logo.*`，并将 `32x32.png` 复制到 `apps/desktop/public/favicon.png`。生成器还会输出移动端资源；本仓库仅支持桌面端，不纳入这些文件。

静态视觉资源、字体、媒体和不透明二进制通过根目录 `.gitattributes` 走 Git LFS；源代码、CSS、JSON 和文档保持普通 Git 文本。克隆后执行 `git lfs pull`，打包前应确认图标文件是真实内容而非 LFS 指针。
