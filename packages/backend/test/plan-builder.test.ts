/**
 * 转换计划构建测试（P3-05）。自造 ParsedConfig 对象（不经 XML）。
 * 行为锚点：main.js:1898-2048 命令生成顺序与默认值、main.js:1012-1032 资格过滤、
 * main.js:2068-2085 xresloader 存在性检查、main.js:2092 派发顺序（新版 FIFO，BD-P1）。
 */
function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected index ${i}`);
  return v;
}

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutputMatrixRule, ParsedConfig, TreeItem } from "../src/config/model.ts";
import {
  buildConversionPlan,
  type ConversionOverrides,
  PlanBuildError,
  resolveEffectiveSettings,
} from "../src/convert/plan-builder.ts";

let workDir: string;
let jarPath: string;
let subDir: string;

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "xresconv-plan-builder-"));
  jarPath = path.join(workDir, "xresloader.jar");
  writeFileSync(jarPath, "fake jar for existence check");
  // P4-04a：workDir 覆盖测试用的子目录（内含另一份 fake jar）。
  subDir = path.join(workDir, "sub");
  mkdirSync(subDir);
  writeFileSync(path.join(subDir, "sub.jar"), "fake jar in sub dir");
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function makeRule(partial: Partial<OutputMatrixRule> = {}): OutputMatrixRule {
  return { tags: [], classes: [], ...partial };
}

function makeItem(partial: Partial<TreeItem> = {}): TreeItem {
  return {
    name: "",
    desc: "",
    options: [],
    schemeData: {},
    tags: [],
    classes: [],
    ...partial,
  };
}

function makeConfig(partial: Partial<ParsedConfig> = {}): ParsedConfig {
  return {
    path: path.join(workDir, "conv.xml"),
    dir: workDir,
    workDir: ".",
    workDirSourceDir: workDir,
    xresloaderPath: "xresloader.jar",
    protoFile: [],
    dataSrcDir: [],
    outputMatrix: [],
    globalOptions: [],
    javaOptions: ["-Dfile.encoding=UTF-8"],
    defaultScheme: [],
    gui: { onBeforeConvert: [], onAfterConvert: [], onAppendLog: [], scripts: {} },
    tree: [],
    diagnostics: [],
    loadedFiles: [path.join(workDir, "conv.xml")],
    ...partial,
  };
}

describe("buildConversionPlan: 命令顺序与默认值（main.js:1955-2043）", () => {
  it("全局前缀顺序：-p → -a → globalOptions 原样 → -f×N → -d×N", () => {
    const config = makeConfig({
      proto: "protobuf",
      dataVersion: "1.0.0.0",
      globalOptions: [
        { name: "pretty", desc: "pretty", value: "--pretty 2" },
        { name: "x", desc: "x", value: "-c kind_const.lua" },
      ],
      protoFile: ["proto_v2/kind.pb", "proto_v3/kind.pb"],
      dataSrcDir: ["data a", "data b"],
    });
    const item = makeItem({ name: "i1", file: "a.xlsx", scheme: "scheme_a" });
    const plan = buildConversionPlan(config, { items: [item] });
    expect(plan.tasks).toHaveLength(1);
    expect(at(plan.tasks, 0).argv).toEqual([
      "-p",
      "protobuf",
      "-a",
      "1.0.0.0",
      "--pretty",
      "2",
      "-c",
      "kind_const.lua",
      "-f",
      "proto_v2/kind.pb",
      "-f",
      "proto_v3/kind.pb",
      "-d",
      "data a",
      "-d",
      "data b",
      "-t",
      "bin",
      "-s",
      "a.xlsx",
      "-m",
      "scheme_a",
    ]);
    // 旧式展示串（仅日志）：带引号拼接形态
    expect(at(plan.tasks, 0).display).toContain('-p "protobuf"');
    expect(at(plan.tasks, 0).display).toContain("--pretty 2");
    expect(at(plan.tasks, 0).display).toContain('-s "a.xlsx" -m "scheme_a"');
    expect(plan.workDir).toBe(workDir);
    expect(plan.javaArgs).toEqual(["-Dfile.encoding=UTF-8"]);
  });

  it("缺省值：无 proto 无 -p、无 dataVersion 无 -a、空矩阵默认单类型 bin", () => {
    const plan = buildConversionPlan(makeConfig(), {
      items: [makeItem({ file: "a", scheme: "s" })],
    });
    expect(at(plan.tasks, 0).argv).toEqual(["-t", "bin", "-s", "a", "-m", "s"]);
  });

  it("overrides 生效：proto/type/outputDir/rename 覆盖配置与矩阵默认", () => {
    const config = makeConfig({
      proto: "protobuf",
      outputDir: "cfg-out",
      outputMatrix: [makeRule({ type: "lua", rename: "/(?i)\\.bin$/\\.lua/" })],
    });
    const overrides: ConversionOverrides = { proto: "capnproto", outputDir: "ui-out" };
    const plan = buildConversionPlan(
      config,
      { items: [makeItem({ file: "a", scheme: "s" })] },
      overrides,
    );
    // 单类型模式：rename 默认取矩阵首条（main.js:1420-1422）
    expect(at(plan.tasks, 0).argv).toEqual([
      "-p",
      "capnproto",
      "-t",
      "lua",
      "-n",
      "/(?i)\\.bin$/\\.lua/",
      "-o",
      "ui-out",
      "-s",
      "a",
      "-m",
      "s",
    ]);
  });

  it("overrides 空串 = 用户清空：不发 -p，且输出目录为空时不发 -o（BD-P3）", () => {
    const config = makeConfig({ proto: "protobuf" });
    const plan = buildConversionPlan(
      config,
      { items: [makeItem({ file: "a", scheme: "s" })] },
      { proto: "" },
    );
    expect(at(plan.tasks, 0).argv).not.toContain("-p");
    expect(at(plan.tasks, 0).argv).not.toContain("-o");
  });

  it("item options value 原样片段经同形 tokenizer 切分（main.js:2027-2031）", () => {
    const item = makeItem({
      file: "a",
      scheme: "s",
      options: [
        { name: "p", desc: "p", value: "--pretty 2" },
        { name: "k", desc: "k", value: "-m 'Key=a b'" },
        { name: "empty", desc: "empty", value: "" },
      ],
    });
    const plan = buildConversionPlan(makeConfig(), { items: [item] });
    expect(at(plan.tasks, 0).argv).toEqual([
      "-t",
      "bin",
      "--pretty",
      "2",
      "-m",
      "Key=a b",
      "-s",
      "a",
      "-m",
      "s",
    ]);
  });

  it("schemeData 分支：每 key 每 value 一条 -m k=v（main.js:2036-2043）", () => {
    const item = makeItem({
      name: "ds",
      schemeData: {
        DataSource: ["book.xlsx|sheet1|3,1", "book.xlsx|sheet2|3,1"],
        KeyRow: ["2"],
      },
    });
    const plan = buildConversionPlan(makeConfig(), { items: [item] });
    expect(at(plan.tasks, 0).argv).toEqual([
      "-t",
      "bin",
      "-m",
      "DataSource=book.xlsx|sheet1|3,1",
      "-m",
      "DataSource=book.xlsx|sheet2|3,1",
      "-m",
      "KeyRow=2",
    ]);
  });

  it("任务顺序 FIFO（BD-P1：旧版 LIFO pop，main.js:2092）", () => {
    const items = [
      makeItem({ name: "first", file: "1.xlsx", scheme: "s1" }),
      makeItem({ name: "second", file: "2.xlsx", scheme: "s2" }),
    ];
    const plan = buildConversionPlan(makeConfig(), { items });
    expect(plan.tasks.map((t) => t.itemKey)).toEqual(["first", "second"]);
  });
});

describe("buildConversionPlan: 矩阵资格过滤（main.js:1012-1032、1333-1338）", () => {
  const matrix = [
    makeRule({ type: "lua", tags: ["server"] }),
    makeRule({ type: "json", classes: ["client"] }),
    makeRule({ type: "bin" }),
  ];

  it("tags/classes 交集过滤；无限定规则全过；均无交集 item 只命中无限定规则", () => {
    const serverItem = makeItem({ name: "sv", tags: ["server", "shared"], file: "a", scheme: "s" });
    const clientItem = makeItem({ name: "cl", classes: ["client"], file: "b", scheme: "s" });
    const plainItem = makeItem({ name: "pl", file: "c", scheme: "s" });
    const plan = buildConversionPlan(makeConfig({ outputMatrix: matrix }), {
      items: [serverItem, clientItem, plainItem],
    });
    expect(plan.tasks.map((t) => [t.itemKey, t.argv[t.argv.indexOf("-t") + 1]])).toEqual([
      ["sv", "lua"],
      ["sv", "bin"],
      ["cl", "json"],
      ["cl", "bin"],
      ["pl", "bin"],
    ]);
  });

  it("唯一规则带 tags/classes 限定仍是矩阵模式；规则值优先于全局回退", () => {
    const config = makeConfig({
      outputDir: "global-out",
      rename: "global-rename",
      outputMatrix: [makeRule({ type: "xml", outputDir: "rule-out", tags: ["x"] })],
    });
    const hit = makeItem({ tags: ["x"], file: "a", scheme: "s" });
    const miss = makeItem({ file: "b", scheme: "s" });
    const plan = buildConversionPlan(config, { items: [hit, miss] });
    expect(plan.tasks).toHaveLength(1);
    expect(at(plan.tasks, 0).argv).toContain("rule-out");
    expect(at(plan.tasks, 0).argv).toContain("global-rename");
    expect(at(plan.tasks, 0).argv).toContain("xml");
  });

  it("矩阵模式输出目录回退：规则无 output_dir 时用全局（main.js:1930、2021-2025）", () => {
    const config = makeConfig({
      outputDir: "global-out",
      outputMatrix: [
        makeRule({ type: "lua", tags: ["x"] }),
        makeRule({ type: "json", outputDir: "json-out" }),
      ],
    });
    const item = makeItem({ tags: ["x"], file: "a", scheme: "s" });
    const plan = buildConversionPlan(config, { items: [item] });
    const outDirs = plan.tasks.map((t) => t.argv[t.argv.indexOf("-o") + 1]);
    expect(outDirs).toEqual(["global-out", "json-out"]);
  });
});

describe("buildConversionPlan: xresloader 存在性检查（main.js:2068-2085）", () => {
  it("相对路径缺失 → PlanBuildError XRESLOADER_NOT_FOUND 含下载链接与上下文", () => {
    const config = makeConfig({ xresloaderPath: "no-such.jar" });
    const err = (() => {
      try {
        buildConversionPlan(config, { items: [] });
        return null;
      } catch (e) {
        return e as PlanBuildError;
      }
    })();
    expect(err).toBeInstanceOf(PlanBuildError);
    expect(err?.code).toBe("XRESLOADER_NOT_FOUND");
    expect(err?.message).toContain("https://github.com/xresloader/xresloader/releases");
    expect(err?.message).toContain(`[${workDir}] no-such.jar not exists`);
  });

  it("未配置 xresloaderPath 同样抛 XRESLOADER_NOT_FOUND", () => {
    expect(() =>
      buildConversionPlan(makeConfig({ xresloaderPath: undefined }), { items: [] }),
    ).toThrowError(PlanBuildError);
  });

  it("绝对路径：检查自身存在性（不拼 workDir）", () => {
    const plan = buildConversionPlan(makeConfig({ xresloaderPath: jarPath }), { items: [] });
    expect(plan.xresloaderPath).toBe(jarPath);
    expect(() =>
      buildConversionPlan(makeConfig({ xresloaderPath: path.join(workDir, "missing.jar") }), {
        items: [],
      }),
    ).toThrowError(PlanBuildError);
  });

  it("无选中 item → 空任务列表（仍校验 jar）", () => {
    const plan = buildConversionPlan(makeConfig(), { items: [] });
    expect(plan.tasks).toEqual([]);
  });
});

describe("buildConversionPlan: overrides 扩展字段（P4-04a）", () => {
  it("workDir 覆盖：相对路径按入口文件目录解析（main.js:1900-1906），jar 存在性随新目录", () => {
    const plan = buildConversionPlan(
      makeConfig({ xresloaderPath: "sub.jar" }),
      { items: [makeItem({ file: "a", scheme: "s" })] },
      { workDir: "sub" },
    );
    expect(plan.workDir).toBe(path.resolve(workDir, "sub"));
    expect(plan.xresloaderPath).toBe("sub.jar");
  });

  it("workDir 覆盖空串 = 用户清空 → 回退入口目录（不用配置的 work_dir）", () => {
    // 配置 work_dir 为 sub：默认有效目录是 sub；清空覆盖后回退 config.dir。
    // xresloaderPath 用绝对路径，使存在性检查与 workDir 取值解耦。
    const config = makeConfig({
      workDir: "sub",
      workDirSourceDir: workDir,
      xresloaderPath: jarPath,
    });
    expect(buildConversionPlan(config, { items: [] }).workDir).toBe(subDir);
    const plan = buildConversionPlan(config, { items: [] }, { workDir: "" });
    expect(plan.workDir).toBe(workDir);
  });

  it("xresloaderPath 覆盖：绝对路径替代坏配置值；空串/缺失相对路径 → XRESLOADER_NOT_FOUND", () => {
    const broken = makeConfig({ xresloaderPath: "no-such.jar" });
    const plan = buildConversionPlan(broken, { items: [] }, { xresloaderPath: jarPath });
    expect(plan.xresloaderPath).toBe(jarPath);
    for (const bad of ["", "missing.jar"]) {
      const err = (() => {
        try {
          buildConversionPlan(makeConfig(), { items: [] }, { xresloaderPath: bad });
          return null;
        } catch (e) {
          return e as PlanBuildError;
        }
      })();
      expect(err).toBeInstanceOf(PlanBuildError);
      expect(err?.code).toBe("XRESLOADER_NOT_FOUND");
    }
  });

  it("protoFile/dataSrcDir 覆盖：替换配置值；空数组 = 不发 -f/-d", () => {
    const config = makeConfig({
      protoFile: ["cfg.pb"],
      dataSrcDir: ["cfg-data"],
    });
    const item = makeItem({ file: "a", scheme: "s" });
    const overridden = buildConversionPlan(
      config,
      { items: [item] },
      { protoFile: ["o1.pb", "o2.pb"], dataSrcDir: ["o-data"] },
    );
    expect(at(overridden.tasks, 0).argv).toEqual([
      "-f",
      "o1.pb",
      "-f",
      "o2.pb",
      "-d",
      "o-data",
      "-t",
      "bin",
      "-s",
      "a",
      "-m",
      "s",
    ]);
    const cleared = buildConversionPlan(
      config,
      { items: [item] },
      { protoFile: [], dataSrcDir: [] },
    );
    expect(at(cleared.tasks, 0).argv).toEqual(["-t", "bin", "-s", "a", "-m", "s"]);
    // 缺省回退配置值（未覆盖字段不受影响）。
    const fallback = buildConversionPlan(config, { items: [item] }, { proto: "x" });
    expect(at(fallback.tasks, 0).argv).toContain("cfg.pb");
    expect(at(fallback.tasks, 0).argv).toContain("cfg-data");
  });

  it("matrix 覆盖：规则值进 -t/-n/-o 并参与资格过滤；规则缺省字段回退 overrides 全局值", () => {
    const config = makeConfig({ outputMatrix: [] }); // 配置无矩阵（默认单类型 bin）
    const matrix = [
      makeRule({ type: "lua", rename: "/l$/", outputDir: "out-lua", tags: ["server"] }),
      makeRule({}), // 无限定规则：type/rename/outputDir 回退全局
    ];
    const serverItem = makeItem({ name: "sv", tags: ["server"], file: "a", scheme: "s" });
    const plainItem = makeItem({ name: "pl", file: "b", scheme: "s" });
    const plan = buildConversionPlan(
      config,
      { items: [serverItem, plainItem] },
      { matrix, type: "json", outputDir: "ui-out" },
    );
    // sv 命中两条规则；pl 只命中无限定规则。
    expect(plan.tasks.map((t) => [t.itemKey, t.argv[t.argv.indexOf("-t") + 1]])).toEqual([
      ["sv", "lua"],
      ["sv", "json"],
      ["pl", "json"],
    ]);
    expect(at(plan.tasks, 0).argv).toEqual([
      "-t",
      "lua",
      "-n",
      "/l$/",
      "-o",
      "out-lua",
      "-s",
      "a",
      "-m",
      "s",
    ]);
    expect(at(plan.tasks, 1).argv).toContain("ui-out");
    // 冲突分组元数据：任务携带生效的 outputDir/rename。
    expect(at(plan.tasks, 0).outputDir).toBe("out-lua");
    expect(at(plan.tasks, 0).rename).toBe("/l$/");
  });

  it("matrix 覆盖空数组 = 清空矩阵 → 单类型模式（配置矩阵不生效）", () => {
    const config = makeConfig({
      outputMatrix: [makeRule({ type: "lua", rename: "/l$/" })],
    });
    const plan = buildConversionPlan(
      config,
      { items: [makeItem({ file: "a", scheme: "s" })] },
      { matrix: [] },
    );
    expect(at(plan.tasks, 0).argv).toEqual(["-t", "bin", "-s", "a", "-m", "s"]);
  });
});

describe("resolveEffectiveSettings（P4-04a 表单有效值快照）", () => {
  it("缺省全回退配置；单类型模式 type/rename 取矩阵首条", () => {
    const config = makeConfig({
      proto: "protobuf",
      dataVersion: "1.0.0.0",
      outputDir: "cfg-out",
      rename: "cfg-rename",
      protoFile: ["cfg.pb"],
      dataSrcDir: ["cfg-data"],
      outputMatrix: [makeRule({ type: "lua", rename: "/rule$/" })],
    });
    const effective = resolveEffectiveSettings(config, {});
    expect(effective).toEqual({
      workDir,
      xresloaderPath: "xresloader.jar",
      proto: "protobuf",
      dataVersion: "1.0.0.0",
      outputDir: "cfg-out",
      rename: "/rule$/", // 单类型模式：rename 取矩阵首条（main.js:1420-1422）
      type: "lua", // 单类型模式：type 取矩阵首条（main.js:1397-1402）
      protoFile: ["cfg.pb"],
      dataSrcDir: ["cfg-data"],
      matrix: config.outputMatrix,
    });
  });

  it("无矩阵无配置时字符串回退空串、type 缺省 bin；workDir 未配置回退入口目录", () => {
    const config = makeConfig({ workDir: undefined, workDirSourceDir: undefined });
    const effective = resolveEffectiveSettings(config, {});
    expect(effective.workDir).toBe(workDir);
    expect(effective.type).toBe("bin");
    expect(effective.proto).toBe("");
    expect(effective.rename).toBe("");
    expect(effective.matrix).toEqual([]);
  });

  it("矩阵模式：type 缺省 bin（全局回退）、rename 取配置 rename；覆盖逐字段生效", () => {
    const matrix = [makeRule({ type: "lua", tags: ["s"] }), makeRule({ type: "json" })];
    const config = makeConfig({ rename: "cfg-rename", outputMatrix: matrix });
    const effective = resolveEffectiveSettings(config, {
      proto: "capnproto",
      outputDir: "",
      workDir: "sub",
    });
    expect(effective.type).toBe("bin");
    expect(effective.rename).toBe("cfg-rename");
    expect(effective.proto).toBe("capnproto");
    expect(effective.outputDir).toBe(""); // 空串 = 用户清空生效
    expect(effective.workDir).toBe(path.resolve(workDir, "sub"));
  });
});
