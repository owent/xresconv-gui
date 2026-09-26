/**
 * 自定义选择器/按钮定义加载与校验测试（P4-05a）。
 *
 * 纯函数测试（无进程）：flattenSelectorDocument / validateSelectorEntry /
 * loadCustomSelectorFiles / selectorViews / parseButtonAction。
 * 旧版锚点：文件加载 setup.js:54-105；条目校验 main.js:752-767；
 * 动作解析 main.js:663-714；BD-O19/BD-O20 缺陷修复见记录。
 */

import { describe, expect, it } from "vitest";
import {
  flattenSelectorDocument,
  loadCustomSelectorFiles,
  parseButtonAction,
  selectorViews,
  validateSelectorEntry,
} from "../../src/service/custom-selector.ts";
import { fixture } from "./helpers.ts";

describe("flattenSelectorDocument（setup.js:70-78）", () => {
  it("顶层数组原样展平；单对象/非标量包装为单元素", () => {
    expect(flattenSelectorDocument([{ name: "a" }, { name: "b" }])).toHaveLength(2);
    expect(flattenSelectorDocument({ name: "a" })).toEqual([{ name: "a" }]);
    expect(flattenSelectorDocument("oops")).toEqual(["oops"]);
    expect(flattenSelectorDocument(null)).toEqual([null]);
  });
});

describe("validateSelectorEntry（main.js:752-767）", () => {
  it("字符串项直接作错误条目（旧版文件级失败入列语义）", () => {
    const entry = validateSelectorEntry("读取失败：xxx");
    expect(entry).toEqual({ ok: false, error: "读取失败：xxx" });
  });

  it("非对象/数组条目 → 错误", () => {
    expect(validateSelectorEntry(42)).toMatchObject({ ok: false });
    expect(validateSelectorEntry(null)).toMatchObject({ ok: false });
    expect(validateSelectorEntry([{ name: "a" }])).toMatchObject({ ok: false });
  });

  it("无 name / 空 name → 错误", () => {
    expect(validateSelectorEntry({ by_schemes: [{ file: "x" }] })).toEqual({
      ok: false,
      error: "自定义选择器必须配置名称",
    });
    expect(validateSelectorEntry({ name: "" })).toMatchObject({ ok: false });
  });

  it("by_schemes/by_sheets/action 全空 → 规则无效", () => {
    expect(validateSelectorEntry({ name: "空规则" })).toEqual({
      ok: false,
      error: "自定义选择器 空规则 的规则无效",
    });
    // 规则数组只含非对象项时按丢弃后为空判定。
    expect(validateSelectorEntry({ name: "脏规则", by_schemes: ["x", 1] })).toMatchObject({
      ok: false,
    });
  });

  it("BD-O19：字符串 action 归一化为单元素数组（旧版压入 undefined 的缺陷不复活）", () => {
    const entry = validateSelectorEntry({ name: "重载", action: "reload" });
    if (!entry.ok) throw new Error("expected ok entry");
    expect(entry.def.action).toEqual(["reload"]);
  });

  it("合法定义保留 by_schemes/by_sheets/default_selected/style", () => {
    const entry = validateSelectorEntry({
      name: "sel",
      by_schemes: [{ file: "glob:*.proto", scheme: "Kind" }],
      by_sheets: [{ file: "a.xlsx", sheet: "s1" }],
      default_selected: true,
      style: "outline-danger",
    });
    if (!entry.ok) throw new Error("expected ok entry");
    expect(entry.def.name).toBe("sel");
    expect(entry.def.by_schemes).toEqual([{ file: "glob:*.proto", scheme: "Kind" }]);
    expect(entry.def.by_sheets).toEqual([{ file: "a.xlsx", sheet: "s1" }]);
    expect(entry.def.default_selected).toBe(true);
    expect(entry.def.style).toBe("outline-danger");
  });
});

describe("loadCustomSelectorFiles（setup.js:54-105）", () => {
  it("逐文件 try/catch：不存在文件/坏 JSON 成错误条目，不中断其余", () => {
    const entries = loadCustomSelectorFiles([
      fixture("no-such-selector.json"),
      fixture("custom-selectors-bad.json"),
      fixture("custom-selectors-single.json"),
    ]);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ ok: false });
    expect(entries[0]).toMatchObject({ error: expect.stringContaining("no-such-selector.json") });
    expect(entries[1]).toMatchObject({ ok: false });
    expect(entries[1]).toMatchObject({
      error: expect.stringContaining("custom-selectors-bad.json"),
    });
    // 单对象顶层展平为一条合法定义。
    expect(entries[2]).toMatchObject({ ok: true, def: { name: "单对象" } });
  });

  it("错误样例文件：字符串项/无名/空规则逐条成错误条目", () => {
    const entries = loadCustomSelectorFiles([fixture("custom-selectors-errors.json")]);
    expect(entries).toEqual([
      { ok: false, error: "文件级失败样例条目" },
      { ok: false, error: "自定义选择器必须配置名称" },
      { ok: false, error: "自定义选择器 空规则 的规则无效" },
    ]);
  });

  it("错误文本只含路径与解析错误，不回显文件内容（PK01 口径）", () => {
    const entries = loadCustomSelectorFiles([fixture("custom-selectors-bad.json")]);
    const error = entries[0];
    if (error === undefined || error.ok) throw new Error("expected error entry");
    expect(error.error).not.toContain("not valid json");
  });
});

describe("selectorViews（快照投影）", () => {
  it("合法定义投影视图字段；错误条目 name 为 null", () => {
    const entries = loadCustomSelectorFiles([
      fixture("custom-selectors.json"),
      fixture("custom-selectors-errors.json"),
    ]);
    const views = selectorViews(entries);
    expect(views[0]).toEqual({
      name: "proto选择",
      hasAction: false,
      defaultSelected: true,
      style: null,
    });
    expect(views[2]).toEqual({
      name: "计数按钮",
      hasAction: true,
      defaultSelected: false,
      style: null,
    });
    // 错误条目：name null + error 原文。
    expect(views[8]).toEqual({ name: null, error: "文件级失败样例条目" });
  });
});

describe("parseButtonAction（main.js:663-714）", () => {
  it("非字符串 → no-op；trim + 大小写不敏感识别内建动作", () => {
    expect(parseButtonAction(42)).toEqual({ kind: "noop", raw: 42 });
    expect(parseButtonAction(null)).toEqual({ kind: "noop", raw: null });
    expect(parseButtonAction("reload")).toEqual({ kind: "reload" });
    expect(parseButtonAction(" RELOAD ")).toEqual({ kind: "reload" });
    expect(parseButtonAction("select_all")).toEqual({ kind: "select_all" });
    expect(parseButtonAction("Unselect_All")).toEqual({ kind: "unselect_all" });
  });

  it("script: 前缀提取脚本名（\\s* 容许、大小写不敏感）", () => {
    expect(parseButtonAction("script:counter")).toEqual({ kind: "script", name: "counter" });
    expect(parseButtonAction("SCRIPT :  counter ")).toEqual({ kind: "script", name: "counter" });
  });

  it("BD-O20：成对引号正确剥离（旧版 B3 缺陷不复活）", () => {
    expect(parseButtonAction('script:"counter"')).toEqual({ kind: "script", name: "counter" });
    expect(parseButtonAction("script:'counter'")).toEqual({ kind: "script", name: "counter" });
    // 不成对的引号原样保留（只剥成对引号）。
    expect(parseButtonAction('script:"counter')).toEqual({ kind: "script", name: '"counter' });
  });

  it("未知字符串 → no-op（保留原值供诊断）", () => {
    expect(parseButtonAction("frobnicate")).toEqual({ kind: "noop", raw: "frobnicate" });
    expect(parseButtonAction("")).toEqual({ kind: "noop", raw: "" });
  });
});
