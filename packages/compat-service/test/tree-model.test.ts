/**
 * SelectionTree（selectMode:3 语义）测试。用例语义锚定
 * jquery.fancytree 2.38.5（node_modules/jquery.fancytree/dist/jquery.fancytree-all.js）
 * 与旧 GUI 用法（src/main.js 行号见各注释）。
 */

import { describe, expect, it } from "vitest";
import { SelectionTree, type TreeNodeSnapshot } from "../src/tree-model.ts";

function item(key: number, extra?: Partial<TreeNodeSnapshot>): TreeNodeSnapshot {
  return {
    key,
    title: `item-${key}`,
    tooltip: "",
    folder: false,
    unselectable: false,
    selected: false,
    partsel: false,
    expanded: false,
    autoSelect: false,
    children: [],
    ...extra,
  };
}

function folder(key: string, children: TreeNodeSnapshot[]): TreeNodeSnapshot {
  return {
    key,
    title: key,
    tooltip: key,
    folder: true,
    unselectable: false,
    selected: false,
    partsel: false,
    expanded: false,
    autoSelect: false,
    children,
  };
}

function stateOf(tree: SelectionTree, key: string | number) {
  const node = tree.getNode(key);
  if (node === undefined) throw new Error(`missing node ${String(key)}`);
  return { selected: node.selected, partsel: node.partsel, expanded: node.expanded };
}

describe("SelectionTree 构造期聚合（fixSelection3FromEndNodes）", () => {
  it("叶子初始勾选向上聚合出 partsel/selected", () => {
    const tree = new SelectionTree([
      folder("f", [item(1, { selected: true }), item(2)]),
      item(3, { selected: true }),
    ]);
    // f: 一个子选中 → selected=false, partsel=true
    expect(stateOf(tree, "f")).toMatchObject({ selected: false, partsel: true });
    expect(stateOf(tree, 1)).toMatchObject({ selected: true, partsel: true });
    expect(stateOf(tree, 2)).toMatchObject({ selected: false, partsel: false });
    expect(stateOf(tree, 3)).toMatchObject({ selected: true, partsel: true });
  });

  it("全部子选中 → 文件夹 selected（partsel 同为 true，fancytree 定稿语义）", () => {
    const tree = new SelectionTree([
      folder("f", [item(1, { selected: true }), item(2, { selected: true })]),
    ]);
    // _changeSelectStatusAttrs(true) → selected=true, partsel=true（ft-all.js:1016-1019）
    expect(stateOf(tree, "f")).toMatchObject({ selected: true, partsel: true });
  });

  it("重复 key 构造失败", () => {
    expect(() => new SelectionTree([item(1), item(1)])).toThrow(/duplicate tree node key/);
  });
});

describe("setSelected 级联（nodeSetSelected + fixSelection3AfterClick）", () => {
  it("文件夹 setSelected(true) 级联选中全部子孙", () => {
    const tree = new SelectionTree([folder("f", [item(1), folder("g", [item(2)])]), item(3)]);
    const changes = tree.applySetSelected("f", true);
    expect(stateOf(tree, "f").selected).toBe(true);
    expect(stateOf(tree, 1).selected).toBe(true);
    expect(stateOf(tree, "g").selected).toBe(true);
    expect(stateOf(tree, 2).selected).toBe(true);
    expect(stateOf(tree, 3).selected).toBe(false);
    // 变更集包含所有受影响节点
    const keys = changes.map((c) => c.key).sort();
    expect(keys).toEqual([1, 2, "f", "g"].sort());
  });

  it("级联覆盖 unselectable 子孙（unselectableStatus 未配置的穿透语义）", () => {
    // _changeSelectStatusAttrs：unselectable && unselectableStatus==null 时状态照常写入
    // （ft-all.js:998-1008）；nodeSetSelected 注释明确 "only by propagation"。
    const tree = new SelectionTree([folder("f", [item(1, { unselectable: true }), item(2)])]);
    tree.applySetSelected("f", true);
    expect(stateOf(tree, 1).selected).toBe(true);
    expect(stateOf(tree, 2).selected).toBe(true);
  });

  it("unselectable 节点直接 setSelected 为 no-op（ft-all.js:5758-5761）", () => {
    const tree = new SelectionTree([item(1, { unselectable: true }), item(2, { selected: true })]);
    const changes = tree.applySetSelected(1, true);
    expect(changes).toEqual([]);
    expect(stateOf(tree, 1).selected).toBe(false);
    // 初始就是 selected 的 unselectable 节点也不能直接取消
    const tree2 = new SelectionTree([item(1, { unselectable: true, selected: true })]);
    expect(tree2.applySetSelected(1, false)).toEqual([]);
    expect(stateOf(tree2, 1).selected).toBe(true);
  });

  it("子节点逐个选中时父级 partsel → selected 迁移", () => {
    const tree = new SelectionTree([folder("f", [item(1), item(2)])]);
    tree.applySetSelected(1, true);
    expect(stateOf(tree, "f")).toMatchObject({ selected: false, partsel: true });
    tree.applySetSelected(2, true);
    expect(stateOf(tree, "f")).toMatchObject({ selected: true, partsel: true });
  });

  it("partsel 文件夹 setSelected(false) 不早退（ft-all.js:5767-5774）", () => {
    const tree = new SelectionTree([folder("f", [item(1), item(2)])]);
    tree.applySetSelected(1, true); // f → partsel
    const changes = tree.applySetSelected("f", false);
    expect(stateOf(tree, 1).selected).toBe(false);
    expect(stateOf(tree, "f")).toMatchObject({ selected: false, partsel: false });
    expect(changes.length).toBeGreaterThan(0);
  });

  it("状态已一致的 setSelected 是 no-op（空变更）", () => {
    const tree = new SelectionTree([item(1)]);
    expect(tree.applySetSelected(1, false)).toEqual([]);
    const once = tree.applySetSelected(1, true);
    expect(once).toHaveLength(1);
    expect(tree.applySetSelected(1, true)).toEqual([]);
  });

  it("未知 key 抛出", () => {
    const tree = new SelectionTree([item(1)]);
    expect(() => tree.applySetSelected(999, true)).toThrow(/unknown tree node key/);
  });
});

describe("toggleSelected（nodeToggleSelected，ft-all.js:5941-5956）", () => {
  it("普通翻转", () => {
    const tree = new SelectionTree([item(1)]);
    tree.applyToggleSelected(1);
    expect(stateOf(tree, 1).selected).toBe(true);
    tree.applyToggleSelected(1);
    expect(stateOf(tree, 1).selected).toBe(false);
  });

  it("partsel && lastIntent===true → 翻转为取消（ft-all.js:5947-5953）", () => {
    const tree = new SelectionTree([folder("f", [item(1), item(2)])]);
    tree.applySetSelected("f", true); // lastIntent(f)=true，全选
    tree.applySetSelected(1, false); // f → partsel(selected=false)，lastIntent(f) 仍为 true
    expect(stateOf(tree, "f")).toMatchObject({ selected: false, partsel: true });
    tree.applyToggleSelected("f"); // nuance：flag=false → 全部取消
    expect(stateOf(tree, "f")).toMatchObject({ selected: false, partsel: false });
    expect(stateOf(tree, 2).selected).toBe(false);
  });

  it("partsel 但 lastIntent!==true → 翻转为选中", () => {
    const tree = new SelectionTree([folder("f", [item(1), item(2)])]);
    tree.applySetSelected(1, true); // f → partsel，lastIntent(f)=false（从未直接点过 f）
    tree.applyToggleSelected("f"); // flag=!selected=true
    expect(stateOf(tree, "f").selected).toBe(true);
    expect(stateOf(tree, 2).selected).toBe(true);
  });
});

describe("visit / getSelectedNodes", () => {
  it("visit：false 全停、skip 跳过子树但继续兄弟（ft-all.js:2497-2518）", () => {
    const tree = new SelectionTree([folder("f", [item(1), item(2)]), item(3)]);
    const seen: (string | number)[] = [];
    tree.visit((node) => {
      seen.push(node.key);
      if (node.key === "f") return "skip";
      return undefined;
    });
    expect(seen).toEqual(["f", 3]);

    const seen2: (string | number)[] = [];
    const res = tree.visit((node) => {
      seen2.push(node.key);
      return node.key === 1 ? false : undefined;
    });
    expect(seen2).toEqual(["f", 1]);
    expect(res).toBe(false);
  });

  it("getSelectedNodes：DFS 序；stopOnParents 命中后跳过子树（ft-all.js:1397-1410）", () => {
    const tree = new SelectionTree([
      folder("f", [item(1, { selected: true }), item(2, { selected: true })]),
      item(3, { selected: true }),
    ]);
    // 构造聚合后 f 也是 selected
    const all = tree.getSelectedNodes();
    expect(all.map((n) => n.key)).toEqual(["f", 1, 2, 3]);
    const stopped = tree.getSelectedNodes(true);
    expect(stopped.map((n) => n.key)).toEqual(["f", 3]);
  });
});

describe("setExpanded / applyNodeStates / exportStates", () => {
  it("setExpanded 只在变化时报告", () => {
    const tree = new SelectionTree([folder("f", [item(1)])]);
    expect(tree.applySetExpanded("f", true)).toBe(true);
    expect(stateOf(tree, "f").expanded).toBe(true);
    expect(tree.applySetExpanded("f", true)).toBe(false);
    expect(tree.applySetExpanded("f", false)).toBe(true);
  });

  it("applyNodeStates 盖章与未知 key 拒绝", () => {
    const tree = new SelectionTree([folder("f", [item(1)])]);
    tree.applyNodeStates([{ key: 1, selected: true, partsel: true }]);
    expect(stateOf(tree, 1).selected).toBe(true);
    expect(() => tree.applyNodeStates([{ key: "nope", selected: true, partsel: false }])).toThrow(
      /unknown tree node key/,
    );
  });

  it("exportStates 导出全树状态", () => {
    const tree = new SelectionTree([folder("f", [item(1)])]);
    tree.applySetSelected("f", true);
    const states = tree.exportStates();
    expect(states).toHaveLength(2);
    expect(states.every((s) => s.selected)).toBe(true);
  });
});
