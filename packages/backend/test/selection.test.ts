/**
 * 选择与资格判定测试（P3-04 余量）。
 * 行为锚点：check_matrix_rule（main.js:1012-1032）、
 * custom_selector_on_click 匹配部分（main.js:333-414）。
 */
import { describe, expect, it } from "vitest";
import type { OutputMatrixRule, TreeItem, TreeNode } from "../src/config/model.ts";
import {
  flattenTreeItems,
  matrixRuleMatchesItem,
  resolveSelectorItems,
} from "../src/domain/selection.ts";

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

describe("matrixRuleMatchesItem（main.js:1012-1032）", () => {
  it("tags/classes 均空 → 通过", () => {
    expect(matrixRuleMatchesItem(makeRule(), makeItem())).toBe(true);
  });

  it("tags 非空需交集（BD-M1 修复后 tags 与 classes 同一规则）", () => {
    const rule = makeRule({ tags: ["server"] });
    expect(matrixRuleMatchesItem(rule, makeItem({ tags: ["server", "x"] }))).toBe(true);
    expect(matrixRuleMatchesItem(rule, makeItem({ tags: ["client"] }))).toBe(false);
    expect(matrixRuleMatchesItem(rule, makeItem())).toBe(false);
  });

  it("classes 非空需交集；tags+classes 同时限定需都满足", () => {
    const rule = makeRule({ tags: ["server"], classes: ["c1"] });
    expect(matrixRuleMatchesItem(rule, makeItem({ tags: ["server"], classes: ["c1"] }))).toBe(true);
    expect(matrixRuleMatchesItem(rule, makeItem({ tags: ["server"] }))).toBe(false);
    expect(matrixRuleMatchesItem(rule, makeItem({ classes: ["c1"] }))).toBe(false);
  });
});

describe("flattenTreeItems", () => {
  it("DFS 顺序只取 item 叶子，category 不产生任务", () => {
    const a = makeItem({ name: "a" });
    const b = makeItem({ name: "b" });
    const c = makeItem({ name: "c" });
    const tree: TreeNode[] = [
      { kind: "item", item: a },
      {
        kind: "category",
        name: "cat",
        children: [
          { kind: "item", item: b },
          { kind: "category", name: "sub", children: [{ kind: "item", item: c }] },
        ],
      },
    ];
    expect(flattenTreeItems(tree).map((i) => i.name)).toEqual(["a", "b", "c"]);
  });
});

describe("resolveSelectorItems（main.js:333-414）", () => {
  it("by_schemes：file 必中且 scheme 缺省或中；仅 file&&scheme 的 item 参与", () => {
    const withBoth = makeItem({ name: "both", file: "role.xlsx", scheme: "scheme_role" });
    const fileOnly = makeItem({ name: "fileOnly", file: "role.xlsx" });
    const dsItem = makeItem({ name: "ds", schemeData: { DataSource: ["role.xlsx|sheet|1,1"] } });
    const selector = { by_schemes: [{ file: "glob:*.xlsx" }] };
    const matched = resolveSelectorItems(selector, [withBoth, fileOnly, dsItem]);
    // else-if 互斥（main.js:338/365）：dsItem 不走 by_schemes；fileOnly 无 scheme 不参与
    expect(matched.map((i) => i.name)).toEqual(["both"]);
  });

  it("by_schemes：scheme 规则存在时必须命中", () => {
    const item = makeItem({ name: "i", file: "role.xlsx", scheme: "scheme_role" });
    expect(
      resolveSelectorItems({ by_schemes: [{ file: "glob:*.xlsx", scheme: "scheme_role" }] }, [
        item,
      ]),
    ).toHaveLength(1);
    expect(
      resolveSelectorItems({ by_schemes: [{ file: "glob:*.xlsx", scheme: "other" }] }, [item]),
    ).toHaveLength(0);
  });

  it("by_sheets：DataSource 按 | 切分，sheet 缺省任意命中，首条命中即停", () => {
    const item = makeItem({
      name: "ds",
      schemeData: { DataSource: ["book.xlsx|equip|3,1", "book.xlsx|role|3,1"] },
    });
    // sheet 缺省：file 中即命中
    expect(resolveSelectorItems({ by_sheets: [{ file: "book.xlsx" }] }, [item])).toHaveLength(1);
    // sheet 命中第二段
    expect(
      resolveSelectorItems({ by_sheets: [{ file: "book.xlsx", sheet: "role" }] }, [item]),
    ).toHaveLength(1);
    // sheet 不中
    expect(
      resolveSelectorItems({ by_sheets: [{ file: "book.xlsx", sheet: "nope" }] }, [item]),
    ).toHaveLength(0);
    // 每个 item 至多命中一次（has_matched，main.js:374-377）
    const two = resolveSelectorItems(
      {
        by_sheets: [
          { file: "book.xlsx", sheet: "equip" },
          { file: "book.xlsx", sheet: "role" },
        ],
      },
      [item],
    );
    expect(two).toHaveLength(1);
  });

  it("by_sheets：无第二段 DataSource 时 sheet 输入为 undefined（规则缺省仍命中）", () => {
    const item = makeItem({ name: "ds", schemeData: { DataSource: ["book.xlsx"] } });
    expect(resolveSelectorItems({ by_sheets: [{ file: "book.xlsx" }] }, [item])).toHaveLength(1);
    expect(
      resolveSelectorItems({ by_sheets: [{ file: "book.xlsx", sheet: "any" }] }, [item]),
    ).toHaveLength(0);
  });

  it("file&&scheme 的 item 不参与 by_sheets（else-if 互斥）", () => {
    const item = makeItem({
      name: "both",
      file: "book.xlsx",
      scheme: "s",
      schemeData: { DataSource: ["book.xlsx|role|3,1"] },
    });
    expect(
      resolveSelectorItems({ by_sheets: [{ file: "book.xlsx", sheet: "role" }] }, [item]),
    ).toHaveLength(0);
  });
});
