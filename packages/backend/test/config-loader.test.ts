import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/config/check-well-formed.ts";
import { parseXmlConfig, resolveWorkDir } from "../src/config/loader.ts";
import type { TreeCategoryNode, TreeItemNode, TreeNode } from "../src/config/model.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "config");
const fx = (name: string) => path.join(FIXTURES, name);

function categories(tree: TreeNode[]): TreeCategoryNode[] {
  return tree.filter((n): n is TreeCategoryNode => n.kind === "category");
}
function items(tree: TreeNode[]): TreeItemNode[] {
  return tree.filter((n): n is TreeItemNode => n.kind === "item");
}

describe("parseXmlConfig: 最小配置与默认值", () => {
  it("① 最小配置全部字段取默认值", async () => {
    const cfg = await parseXmlConfig(fx("minimal.xml"));
    expect(cfg.path).toBe(path.resolve(fx("minimal.xml")));
    expect(cfg.dir).toBe(FIXTURES);
    expect(cfg.workDir).toBeUndefined();
    expect(resolveWorkDir(cfg)).toBeUndefined();
    expect(cfg.xresloaderPath).toBeUndefined();
    expect(cfg.protoFile).toEqual([]);
    expect(cfg.outputDir).toBeUndefined();
    expect(cfg.dataVersion).toBeUndefined();
    expect(cfg.dataSrcDir).toEqual([]);
    expect(cfg.rename).toBeUndefined();
    expect(cfg.proto).toBeUndefined();
    expect(cfg.outputMatrix).toEqual([]);
    expect(cfg.globalOptions).toEqual([]);
    // 初始隐含 JVM 参数（main.js:931）
    expect(cfg.javaOptions).toEqual(["-Dfile.encoding=UTF-8"]);
    expect(cfg.defaultScheme).toEqual([]);
    expect(cfg.gui).toEqual({
      onBeforeConvert: [],
      onAfterConvert: [],
      onAppendLog: [],
      scripts: {},
    });
    expect(cfg.tree).toEqual([]);
    expect(cfg.diagnostics).toEqual([]);
    expect(cfg.loadedFiles).toEqual([path.resolve(fx("minimal.xml"))]);
  });

  it("入口文件不存在 → ConfigError READ_FAILED 含 path", async () => {
    const err = await parseXmlConfig(fx("no-such-entry.xml")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).code).toBe("READ_FAILED");
    expect((err as ConfigError).details?.path).toBe(path.resolve(fx("no-such-entry.xml")));
  });
});

describe("parseXmlConfig: global 标签映射（P0-08 §1.2）", () => {
  it("② 全标签映射、别名等价、空值过滤、累积与替换", async () => {
    const cfg = await parseXmlConfig(fx("global-all.xml"));
    expect(cfg.workDir).toBe("work");
    expect(cfg.workDirSourceDir).toBe(FIXTURES);
    expect(resolveWorkDir(cfg)).toBe(path.resolve(FIXTURES, "work"));
    expect(cfg.xresloaderPath).toBe("jar/x.jar");
    // proto_file 多值累积（main.js:1232-1233）
    expect(cfg.protoFile).toEqual(["a.pb", "b.pb"]);
    expect(cfg.outputDir).toBe("out");
    expect(cfg.dataVersion).toBe("1.2.3");
    // data_src_dir / data_source_dir 完全等价别名；空标签重置但空值不入列（main.js:1238-1244）
    expect(cfg.dataSrcDir).toEqual(["ds1", "ds2"]);
    expect(cfg.rename).toBe("/a/b/");
    expect(cfg.proto).toBe("protobuf");
    // ③ output_type 矩阵：rename trim、output_dir 不 trim、tags/classes 空白切分（main.js:1262-1276）
    expect(cfg.outputMatrix).toEqual([
      {
        type: "bin",
        rename: "/x/y/",
        outputDir: " od ",
        tags: ["t1", "t2"],
        classes: ["c1", "c2"],
      },
    ]);
    // option：name/desc 缺省回退 value（main.js:1277-1283）
    expect(cfg.globalOptions).toEqual([
      { name: "n1", desc: "d1", value: "v1" },
      { name: "v-only", desc: "v-only", value: "v-only" },
    ]);
    // java_option：空值忽略（main.js:1284-1285）
    expect(cfg.javaOptions).toEqual(["-Dfile.encoding=UTF-8", "-Xmx1g"]);
    // default_scheme：同名累积、空 name 忽略（main.js:1286-1295）
    expect(cfg.defaultScheme).toEqual([
      { name: "KeyRow", value: "2" },
      { name: "KeyRow", desc: "第二行", value: "3" },
    ]);
    // 未识别标签进 diagnostics（旧版静默忽略，BD-C6）
    expect(cfg.diagnostics).toHaveLength(1);
    expect(cfg.diagnostics[0]?.tag).toBe("unknown_tag");
  });

  it("⑩ 大小写不匹配的标签仅进 diagnostics（BD-C5）", async () => {
    const cfg = await parseXmlConfig(fx("case-tags.xml"));
    expect(cfg.workDir).toBeUndefined();
    expect(cfg.protoFile).toEqual([]);
    expect(cfg.diagnostics.map((d) => d.tag)).toEqual(["WORK_DIR", "Proto_File"]);
  });
});

describe("parseXmlConfig: include 合并（P3-02）", () => {
  it("④ 确定性合并：父覆盖子标量、数组累积、矩阵按文件重写", async () => {
    const cfg = await parseXmlConfig(fx("include-parent.xml"));
    // DFS 文档顺序：子先应用，父最后（BD-C1）
    expect(cfg.loadedFiles).toEqual([
      path.resolve(fx("include-child.xml")),
      path.resolve(fx("include-parent.xml")),
    ]);
    // 父覆盖子（DOM 级标量）
    expect(cfg.workDir).toBe("parent-work");
    // 父含 proto_file 标签 → 整体替换子值（main.js:1298-1305）
    expect(cfg.protoFile).toEqual(["parent.pb"]);
    // 父未设置 output_dir → 子值保留
    expect(cfg.outputDir).toBe("child-out");
    // 父无 output_type → 矩阵被重写为空（main.js:1319-1429 每文件重写）
    expect(cfg.outputMatrix).toEqual([]);
    // 数组类累积不覆盖
    expect(cfg.globalOptions.map((o) => o.value)).toEqual(["child-opt", "parent-opt"]);
    expect(cfg.javaOptions).toEqual(["-Dfile.encoding=UTF-8", "-Xchild"]);
    // items 累积，子项在前
    expect(items(cfg.tree).map((n) => n.item.name)).toEqual(["子项", "父项"]);
  });

  it("⑤ include 循环 → INCLUDE_CYCLE 含完整链", async () => {
    const err = await parseXmlConfig(fx("include-cycle-a.xml")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).code).toBe("INCLUDE_CYCLE");
    expect((err as ConfigError).details?.chain).toEqual([
      path.resolve(fx("include-cycle-a.xml")),
      path.resolve(fx("include-cycle-b.xml")),
      path.resolve(fx("include-cycle-a.xml")),
    ]);
    expect((err as ConfigError).message).toContain("include-cycle-a.xml");
  });

  it("⑥ 菱形 include → INCLUDE_DUPLICATE", async () => {
    const err = await parseXmlConfig(fx("include-diamond.xml")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).code).toBe("INCLUDE_DUPLICATE");
    expect((err as ConfigError).details?.path).toBe(path.resolve(fx("d-shared.xml")));
  });

  it("⑥ 同文件不同拼写（./ 前缀）判重 → INCLUDE_DUPLICATE（规范化键，BD-C2）", async () => {
    const err = await parseXmlConfig(fx("include-dup.xml")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).code).toBe("INCLUDE_DUPLICATE");
    expect((err as ConfigError).details?.path).toBe(path.resolve(fx("include-child.xml")));
  });

  it("include 目标不存在 → READ_FAILED 含解析后路径", async () => {
    const err = await parseXmlConfig(fx("include-missing.xml")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).code).toBe("READ_FAILED");
    expect((err as ConfigError).details?.path).toBe(path.resolve(fx("no-such-file.xml")));
  });

  it("中文/空格目录的相对 include（CF03 路径变体之一）", async () => {
    const cfg = await parseXmlConfig(fx("include-spaced.xml"));
    expect(cfg.loadedFiles).toEqual([
      path.resolve(FIXTURES, "子 目录", "包含 文件.xml"),
      path.resolve(fx("include-spaced.xml")),
    ]);
    expect(cfg.workDir).toBe("含空格目录");
    expect(cfg.workDirSourceDir).toBe(path.resolve(FIXTURES, "子 目录"));
    expect(resolveWorkDir(cfg)).toBe(path.resolve(FIXTURES, "子 目录", "含空格目录"));
  });
});

describe("parseXmlConfig: 严格 XML 与实体（BD-07）", () => {
  it("⑦ 非法 XML → INVALID_XML 带 line/column", async () => {
    const err = await parseXmlConfig(fx("invalid.xml")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).code).toBe("INVALID_XML");
    expect((err as ConfigError).details?.line).toBeGreaterThan(0);
    expect((err as ConfigError).details?.column).toBeGreaterThan(0);
    expect((err as ConfigError).details?.path).toBe(path.resolve(fx("invalid.xml")));
  });

  it("⑪ DOCTYPE 外部实体被拒绝且不读取目标文件", async () => {
    const err = await parseXmlConfig(fx("xxe.xml")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).code).toBe("INVALID_XML");
    expect((err as ConfigError).message).toContain("External entities");
    // 哨兵文件内容绝不出现在错误信息中（未发生读取）
    expect((err as ConfigError).message).not.toContain("SENTINEL-SECRET-CONTENT");
  });
});

describe("parseXmlConfig: gui 块（P0-08 §1.5）", () => {
  it("⑧ 脚本文本原样保留（CDATA/实体解码）、timeout、enabled 开关", async () => {
    const cfg = await parseXmlConfig(fx("gui.xml"));
    // set_name 后写覆盖 + diagnostic（BD-C7）；CDATA 内 < > & 原样保留、不 trim
    expect(cfg.gui.setName?.filename).toBe(path.resolve(fx("gui.xml")));
    expect(cfg.gui.setName?.source).toContain("item_data.file.length > 0");
    expect(cfg.gui.setName?.source.startsWith("\n")).toBe(true);
    expect(cfg.diagnostics.some((d) => d.tag === "set_name")).toBe(true);

    const [anon, named] = cfg.gui.onBeforeConvert;
    // 无 name → 布尔 enabled，默认 true，timeout 默认 30000（main.js:1490-1494）
    expect(anon?.enabled).toBe(true);
    expect(anon?.timeoutMs).toBe(30000);
    expect(anon?.toggle).toBeUndefined();
    expect(anon?.source).toBe("resolve();");
    // 实体解码：&gt; &amp;&amp; &lt; → > && <
    expect(named?.source).toContain("if (a > 0 && b < 2)");
    expect(named?.timeoutMs).toBe(15000);
    expect(named?.filename).toBe(path.resolve(fx("gui.xml")));
    // checked="false" → 不勾选；mutable="no" → 不可改（main.js:1135-1167）
    expect(named?.enabled).toBe(false);
    expect(named?.toggle).toEqual({ name: "命名事件", checked: false, mutable: false });

    // 非法 timeout 回退 30000 + diagnostic（BD-C8）
    expect(cfg.gui.onAfterConvert[0]?.timeoutMs).toBe(30000);
    expect(cfg.diagnostics.some((d) => d.message.includes("timeout"))).toBe(true);

    // checked="0" → false
    expect(cfg.gui.onAppendLog[0]?.enabled).toBe(false);

    // script：CDATA 原文、匿名 name ""、workDir 解析期快照（main.js:1598）
    const s1 = cfg.gui.scripts.s1;
    expect(s1?.source).toBe("if (a < 1 && b > 2) { resolve(); }");
    expect(s1?.timeoutMs).toBe(5000);
    expect(s1?.workDir).toBe(FIXTURES);
    expect(s1?.filename).toBe(path.resolve(fx("gui.xml")));
    expect(cfg.gui.scripts[""]?.source).toBe("resolve();");
  });
});

describe("parseXmlConfig: item/scheme_data（P0-08 §8、main.js:1610-1700）", () => {
  it("⑫ file+scheme 直存、DataSource 特例、default_scheme 补缺、分类挂载", async () => {
    const cfg = await parseXmlConfig(fx("items.xml"));
    const roots = cfg.tree;
    // 树结构：c1 > c2 > 表A；表B/表C/表D 挂根（表D cat 未命中）
    const c1 = categories(roots)[0];
    expect(c1?.name).toBe("分类一");
    const c2 = categories(c1?.children ?? [])[0];
    expect(c2?.name).toBe("分类二");
    const itemA = items(c2?.children ?? [])[0]?.item;
    const [itemB, itemC, itemD] = items(roots).map((n) => n.item);

    // file+scheme 直存（main.js:1616-1617）；tags/classes 切分
    expect(itemA?.file).toBe("a.xlsx");
    expect(itemA?.scheme).toBe("sch_a");
    expect(itemA?.tags).toEqual(["t1", "t2"]);
    expect(itemA?.classes).toEqual(["client"]);
    expect(itemA?.desc).toBe("表A");
    // 无自有 scheme → default_scheme 补缺（main.js:1689-1692）
    expect(itemA?.schemeData.KeyRow).toEqual(["2"]);
    expect(itemA?.schemeData.MacroSource).toEqual(["res.xlsx|macro|2,1"]);

    // DataSource 特例：| 切分回填 file、不设置 scheme（main.js:1671-1685）；scheme 值不 trim 原文入列
    expect(itemB?.file).toBe("b.xlsx");
    expect(itemB?.scheme).toBeUndefined();
    expect(itemB?.schemeData.DataSource).toEqual(["b.xlsx|sheet1|3,1"]);
    expect(itemB?.schemeData.ProtoName).toEqual(["pb", "pb2"]);
    expect(itemB?.schemeData.KeyRow).toEqual(["2"]);
    // item option：value trim、name/desc 原样（main.js:1652-1658）
    expect(itemB?.options).toEqual([{ name: "on", desc: "od", value: "ov" }]);

    // item 自有 scheme 永远优先于 default_scheme；datasource 大小写不敏感（main.js:1671）
    expect(itemC?.schemeData.KeyRow).toEqual(["9"]);
    expect(itemC?.schemeData.datasource).toEqual(["onlyfile.xlsx"]);
    expect(itemC?.file).toBe("onlyfile.xlsx");
    expect(itemC?.schemeData.MacroSource).toEqual(["res.xlsx|macro|2,1"]);

    // cat 未命中 cat_map → 挂根（main.js:1771-1776）
    expect(itemD?.name).toBe("表D");
    expect(itemD?.cat).toBe("missing");
  });
});

describe("parseXmlConfig: 官方 sample（xresloader/xresconv-conf）", () => {
  it("⑨ sample.xml 直接加载：global/gui/item 关键字段", async () => {
    const cfg = await parseXmlConfig(fx("official-sample.xml"));
    expect(cfg.workDir).toBe("../xresloader/sample");
    expect(resolveWorkDir(cfg)).toBe(path.resolve(FIXTURES, "..", "xresloader", "sample"));
    expect(cfg.xresloaderPath).toBe("../target/xresloader-2.14.0-rc3.jar");
    expect(cfg.proto).toBe("protobuf");
    expect(cfg.protoFile).toEqual(["proto_v3/kind.pb"]);
    // 空 data_src_dir 标签 → 重置为空数组（B7 语义）
    expect(cfg.dataSrcDir).toEqual([]);
    expect(cfg.dataVersion).toBe("1.0.0.0");
    // 三条 output_type 矩阵
    expect(cfg.outputMatrix).toEqual([
      { type: "bin", tags: [], classes: [] },
      {
        type: "json",
        rename: "/(?i)\\.bin$/\\.json/",
        outputDir: "json_output",
        tags: [],
        classes: [],
      },
      { type: "ue-csv", rename: "/(?i)\\.bin$/\\.csv/", tags: [], classes: ["client"] },
    ]);
    expect(cfg.javaOptions).toEqual(["-Dfile.encoding=UTF-8", "-Xmx2048m", "-client"]);
    expect(cfg.defaultScheme.map((e) => [e.name, e.value])).toEqual([
      ["KeyRow", "2"],
      ["MacroSource", "资源转换示例.xlsx|macro|2,1"],
    ]);

    // gui 块（入口文件自身 → 生效）
    expect(cfg.gui.setName?.source).toContain("item_data.file.match");
    expect(cfg.gui.onBeforeConvert).toHaveLength(1);
    expect(cfg.gui.onBeforeConvert[0]?.timeoutMs).toBe(15000);
    expect(cfg.gui.onBeforeConvert[0]?.toggle?.name).toBe("转表开始前事件");
    expect(cfg.gui.onAfterConvert[0]?.timeoutMs).toBe(60000);
    expect(Object.keys(cfg.gui.scripts).sort()).toEqual(["delaycall", "自定义脚本"]);
    expect(cfg.gui.scripts.delaycall?.workDir).toBe(
      path.resolve(FIXTURES, "..", "xresloader", "sample"),
    );

    // 树：大分类 > 角色配置（人物表/升级表）；测试（嵌套数组测试）
    const allCats = categories(cfg.tree).find((n) => n.id === "all_cats");
    const kind = categories(allCats?.children ?? [])[0];
    expect(kind?.id).toBe("kind");
    expect(items(kind?.children ?? []).map((n) => n.item.name)).toEqual(["人物表", "升级表"]);
    const nested = items(categories(cfg.tree).find((n) => n.id === "test")?.children ?? [])[0]
      ?.item;
    expect(nested?.file).toBe("资源转换示例.xlsx");
    expect(nested?.scheme).toBeUndefined();
    expect(nested?.schemeData.ProtoName).toEqual(["arr_in_arr_cfg"]);
    expect(nested?.schemeData.KeyRow).toEqual(["2"]);
    expect(nested?.classes).toEqual(["client", "server"]);
    // 升级表自带 option
    expect(items(kind?.children ?? [])[1]?.item.options).toEqual([
      { name: "移除空列表项", desc: "自定义选项", value: "--disable-empty-list" },
    ]);
  });

  it("⑨ sample_include.xml 加载：include 合并、父覆盖子、gui 被重建清空（BD-C13）", async () => {
    const cfg = await parseXmlConfig(fx("official-sample-include.xml"));
    expect(cfg.loadedFiles).toEqual([
      path.resolve(fx("official-sample.xml")),
      path.resolve(fx("official-sample-include.xml")),
    ]);
    // 父无 work_dir → 子值保留
    expect(cfg.workDir).toBe("../xresloader/sample");
    // 父 output_type lua 重写矩阵
    expect(cfg.outputMatrix).toEqual([{ type: "lua", tags: [], classes: [] }]);
    // 父 rename/output_dir 覆盖
    expect(cfg.rename).toBe("/(?i)\\.bin$/\\.lua/");
    expect(cfg.outputDir).toBe("../..");
    // option 跨文件累积，子在前
    expect(cfg.globalOptions.map((o) => o.value)).toEqual([
      "--validator-rules custom_validator.yaml",
      "--pretty 2",
    ]);
    // 旧版每文件清空重建 gui：入口文件无 gui 块 → 子文件 gui 被清空（忠实保留，BD-C13）
    expect(cfg.gui.setName).toBeUndefined();
    expect(cfg.gui.onBeforeConvert).toEqual([]);
    expect(cfg.gui.scripts).toEqual({});
    // 树非空（子文件累积保留）
    expect(cfg.tree.length).toBeGreaterThan(0);
  });
});
