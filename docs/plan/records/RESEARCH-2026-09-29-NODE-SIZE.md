# Windows bootstrap 的 Node 体积研究

[阶段记录索引](README.md) · [发行规范](../05-packaging-release.md) · [来源索引](../../ai/source-index.md)

研究日期：2026-09-29。问题是当前 bootstrap 中 Node 占比过高，评估压缩、定制构建和替代运行时。本记录是实验与建议，不改变现有发行格式、运行时或 D6 架构决策。

后续归档格式已改为 Windows 双变体 7z；当前实现及新的同负载验收见[归档变更记录](REVIEW-2026-09-29-ARCHIVE-FORMAT.md)。以下测量和建议保留为当时的研究记录。

## 发布样本与测量口径

输入为实际下载的 [v3.0.0-dev.0 Windows x64 bootstrap ZIP](https://github.com/owent/xresconv-gui/releases/download/v3.0.0-dev.0/xresconv-gui-3.0.0-dev.0-windows-x64-bootstrap.zip)，不是本地历史构建：

- ZIP：44,436,203 字节（42.38 MiB）；SHA-256 `94a7ad9c84163413c4e358df9439f4c50b6dd578ab89c6a1436c701b8000dc32`。
- manifest 的 sourceCommit：`990e5d2834defcd63c6cf823633f779410704407`；Node `24.21.0`，ICU `78.3`。
- 包内 Node SHA-256：`ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32`。
- Node 可执行文件：93,580,104 字节（89.24 MiB），ZIP 内压缩数据 36,033,426 字节（34.36 MiB），占整个 ZIP **81.09%**。
- 包内全部 1,243 个文件展开共 114,902,773 字节；ZIP 各条目的压缩长度不含中央目录等归档开销。

`packages/packaging/src/assemble.ts` 已经只复制一份 Node，guardian、backend 和各 worker 共用。应用入口已由 esbuild 生成 JS；生产依赖闭包另外打包，未携带 npm/corepack 安装目录。因此，减少后台进程数量或删除 npm 目录，不能减少当前随包 Node 二进制大小。

实际运行包内 Node 读取 `process.config.variables`：Amaro、SQLite、OpenSSL、inspector、Node snapshot/code cache 均启用，`icu_small=false`，`enable_lto=false`、`enable_thin_lto=false`。`icu_path=deps/icu-small` 是源码目录名，不能据此认定成品使用 small-icu。

## 同一完整负载的压缩实验

Windows x64；7-Zip 26.03、zstd 1.5.7、bsdtar 3.8.8（libzstd 1.5.7）。将原 ZIP 解压，使用完全相同的目录重新归档，不裁剪语言、不修改二进制、不删除依赖。

| 格式 | 参数 | 整包字节 | MiB | 相对已发布 ZIP |
| --- | --- | --- | --- | --- |
| 原发布 ZIP | 当前 .NET `CompressionLevel.Optimal` | 44,436,203 | 42.38 | 基线 |
| ZIP | 7z `-tzip -mx=9 -mmt=2` | 41,187,787 | 39.28 | -7.31% |
| tar.zst | zstd `-19 -T0 --long=27` | 31,827,140 | 30.35 | -28.38% |
| 7z | `-t7z -mx=9 -mmt=2` | 27,332,890 | 26.07 | -38.49% |

三个实验归档均通过压缩工具完整性检查；再次解压后，各 1,243 个文件的相对路径、大小及 SHA-256 与原包逐一相等。tar.zst 由本机系统 tar 成功解压。这些检查验证负载完整性，没有修改运行时，也不声称重跑了桌面 E2E。

复现方式：在任务临时目录将原包解压到 `extracted/xresconv-gui/` 后执行下列命令；工具版本、文件时间与元数据差异可能影响最后几个字节。

```powershell
tar -cf payload.tar -C extracted xresconv-gui
zstd -19 -T0 --long=27 payload.tar -o payload.tar.zst
7z a -t7z -mx=9 -mmt=2 payload.7z ./extracted/xresconv-gui
7z a -tzip -mx=9 -mmt=2 payload-zip-max.zip ./extracted/xresconv-gui
```

建议优先考虑此方向：只降低下载体积，运行行为及展开体积不变。ZIP 保持现有解压体验；tar.zst 能复用当前 offline 的压缩实现；7z 在本样本最小。后两者改变公开资产格式，必须同步目标矩阵、命名、校验与下载文档，并验证最低支持 Windows 的解压方式。本机新 bsdtar 成功不证明全部旧 Windows 内置 tar 都支持；[微软 tar 文档](https://learn.microsoft.com/en-us/windows/tar/)也不能替代目标系统验收。回滚为恢复原 ZIP 打包器与矩阵。

## 通过定制构建缩小 Node 二进制

已核对锁定版本 [configure.py](https://github.com/nodejs/node/blob/v24.21.0/configure.py)、[node.gyp](https://github.com/nodejs/node/blob/v24.21.0/node.gyp) 和 [vcbuild.bat](https://github.com/nodejs/node/blob/v24.21.0/vcbuild.bat)。以下选项是存在的构建能力，**本轮没有编译定制 Node，不预报节省多少 MiB**。

| 候选 | 适用性与代价 |
| --- | --- |
| `--without-amaro` | 移除内置 TypeScript 处理工具；已打包的应用入口是 JS，但用户动态加载 TS 模块的能力会变化，需先明确支持范围 |
| `--without-sqlite` | 同时移除 SQLite 与 Web Storage API；自定义脚本可能使用，不能只按应用源码搜索判定安全 |
| `--without-inspector` | 移除调试协议；需接受后端调试能力减少，并保留可诊断的常规日志 |
| 定制 ICU 语言数据 | 可保留中、英、日、韩、德、法、西、葡等主流语言；须保留简体中文及语言依赖链、编码转换、Unicode 规范化等能力 |
| `--with-ltcg` 等链接优化 | Windows 有对应构建选项；实际体积、工具链兼容与构建成本均须实测，不与其他 LTO 开关盲目叠加 |
| `--without-node-code-cache` | 可作为第二阶段实验；必须量化多个进程启动与 worker 补员延迟，不能仅看尺寸 |

ICU 需要独立设计。Node 的 [small-icu 说明](https://github.com/nodejs/node/blob/v24.21.0/doc/api/intl.md)明确影响 Intl 与 TextDecoder；锁定版本 [icu_small.json](https://github.com/nodejs/node/blob/v24.21.0/tools/icu/icu_small.json)还删除 converter、断词等数据。即使配上 `--with-icu-locales`，也不能把它等同于“只删除非主流语言”。更合适的研究方向是使用 [ICU Data Build Tool](https://unicode-org.github.io/icu/userguide/icu_data/buildtool.html) 的 locale filter 生成定制数据，保持其他功能类别，再接入 Node 构建；该接线尚未实构验证。

ICU 官方工具要求完整数据源；预制 `.dat` 可能覆盖过滤规则。应固定 ICU 78.3、核对实际输出语言和数据特性，避免设置了过滤参数但成品未变。语言回退也须测试：删除 locale 不自动保证所有用户脚本回退英文，应用自身可显式选择英文，第三方脚本的默认 locale 行为不能擅自承诺。

不建议的初始裁剪：`--without-ssl` 会关闭 crypto/https，而本项目直接使用 `node:crypto.randomUUID`，用户模块也可依赖 HTTPS；`--without-intl` 会丢失 Intl 并改变 Unicode 行为；`--v8-lite-mode` 关闭 JIT、显著降低执行性能；`--without-node-snapshot` 在锁定源码仍标注 experimental。当前包本来没有 npm/corepack 安装目录，仅加 `--without-npm/--without-corepack` 不是二进制瘦身方案。

建议分组实验，避免一次裁掉多个功能后无法归因：先完整 ICU + 单个可选功能裁剪，再测试 ICU locale filter，最后测试缓存/链接优化。每组记录展开大小、相同参数压缩大小、冷启动和转换吞吐。通过后才组合构建；仍保留原 Node 成品、哈希与打包开关用于回滚。

这会引入按平台/架构维护自建 Node、跟进安全修复、重新签名及更新 manifest/SBOM 的成本。版本号及 ABI 相同不能替代功能验证。

## 替代运行时与去捆绑方案

### Bun / Deno

核对官方发布资产：[Bun 1.4.2](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2) 的 Windows x64 ZIP 为 39,807,510 字节；[Deno 2.9.7](https://github.com/denoland/deno/releases/tag/v2.9.7) 的 Windows x64 ZIP 为 42,630,221 字节。发行 ZIP 参数不一致，因此不能仅靠这些数字评价替换收益；本轮另下载原始二进制，以同一 zstd/7z 参数比较。

| Windows x64 运行时 | exe 字节 | zstd 字节 / MiB | 7z 字节 / MiB |
| --- | --- | --- | --- |
| 当前包 Node 24.21.0 | 93,580,104 | 25,752,377 / 24.56 | 21,758,914 / 20.75 |
| Bun 1.4.2 | 86,096,984 | 31,950,947 / 30.47 | 27,111,457 / 25.86 |
| Deno 2.9.7 | 97,462,048 | 32,245,739 / 30.75 | 27,083,273 / 25.83 |

此表只压缩各自单个 exe，zstd 参数 `-19 -T0 --long=27`，7z 参数 `-t7z -mx=9 -mmt=2`。与上文完整应用归档的口径不同；未包含迁移后的应用、依赖与许可，不能当作完整替代包大小。Bun 展开体积略小，但这两个替代运行时在相同参数下的压缩文件均大于当前 Node，因此实测未显示直接替换后的下载量收益。单文件输出也通过 `zstd -t` / `7z t`。

下载样本 SHA-256：Bun ZIP `ce4c17497b2f29712a99d3d53f028de28cd42e3bacb8589599e7f000e49b6405`；Deno ZIP `a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238`。

本项目依赖 `child_process.fork`、IPC、`node:vm`、动态 `createRequire`、koffi Node-API、Windows Job Object 与进程树回收。Bun 当前文档已将 `node:vm` 标为 fully implemented，不能沿用过时的“不支持 vm”结论；但 child_process 仍列有兼容差异。[Bun 官方兼容性](https://bun.sh/docs/runtime/nodejs-compat)支持将其列为迁移候选，不能证明此项目无需修改即可运行。

[Deno 官方兼容说明](https://docs.deno.com/runtime/fundamentals/node/)支持 Node-API 扩展，但要求本地 node_modules 与 FFI 权限。权限、模块解析和进程启动参数必须适配。本轮只比较资产与文档，未运行 Bun/Deno 应用，不把任何候选判为已兼容或已不兼容。

### Node SEA、QuickJS 与原生改写

- [Node SEA](https://github.com/nodejs/node/blob/v24.21.0/doc/api/single-executable-applications.md)把脚本 blob 注入现有 Node 二进制，不会自动消除 V8/ICU。当前已经只带一份 Node；分别为多个角色制作 SEA 反而可能重复运行时，不作为主要瘦身方案。
- [QuickJS](https://bellard.org/quickjs/)是小型 JS 引擎，其引擎体积不能当作兼容本项目的运行时体积。Node 文件系统、模块解析、子进程、原生扩展等需要桥接或重写；仅把业务搬到 Rust、仍保留 Node 执行用户脚本，也无法去掉这份 Node。此方向需要重审 D6 和用户脚本兼容范围，属于架构变更。

### 不捆绑 Node 的在线轻量变体

若允许首次启动下载固定 Node，原 ZIP 扣除 node.exe 压缩条目后的算术估计约 **8.01 MiB**；不是实构新包，尚未计入新的下载/校验逻辑与元数据。安装后的 Node 体积和首次总下载量仍然存在，只是从发行资产转移到首次启动。

应新增明确命名的变体，保持 offline 自包含。运行时下载需固定版本/平台/架构/哈希、受控缓存、失败重试与可诊断的网络错误；任何校验/安装探针和后台进程均须无可见控制台。直接使用 PATH 中任意 Node 不符合当前版本固定与可复现要求。复用系统 Node 可作为显式高级选项，须校验版本、能力和原生模块，并固定验证后的绝对路径。

当前 [发行规范](../05-packaging-release.md)要求所有变体捆绑 Node，该方向需要先更新产品行为及验收标准，不能无声改变现有 bootstrap 的使用前提。

## 建议顺序与验收边界

1. 优先选择归档改进：保留 ZIP 可节省 7.31%；接受格式调整可从本样本 28.38%–38.49% 的实测收益中选择。先验最低 Windows 解压体验，再调整发布矩阵。
2. 若仍需缩小展开体积，再建立定制 Node 的实验构建；优先保留 Node API、koffi 和现有脚本接口，独立评估可选功能与 ICU 数据。
3. 只有接受首次运行网络依赖时，再设计不捆绑 Node 的轻量变体。Bun/Deno 需要尺寸收益和兼容性两方面的验证结果；QuickJS/原生改写不作为本轮尺寸问题的短期方案。

运行时发生变化时，至少验证：真实发行目录中的动态 require、adm-zip/compressing/koffi；guardian→backend fork 与各 worker 启停/超时/崩溃回收；无控制台窗口；真实转表样本；主流语言 Intl、缺失语言回退、Unicode 正则/normalize、GBK/UTF-8 解码；冷启动/内存/吞吐；全部支持平台的原生桌面验收。压缩格式变化则重点补归档 roundtrip、隐藏文件、损坏归档、失败不覆盖旧产物、命名/矩阵和最低系统解压测试。

本轮仅新增研究文档和来源索引，不修改产品源码，不新增与文档重复的单元测试。现有 AGENTS、Skills 和 CLAUDE 路由继续适用，无需新增提示词或规则；未把未经选择的候选写成 Plan 中的已承诺开发任务。实验目录为 `build/node-size-research/`，结束前清理，长期保留的研究记录保存在本记录中。
