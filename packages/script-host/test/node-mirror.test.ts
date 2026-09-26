/**
 * NodeMirror 单元测试（P2-05）：别名恒等、同步方法、有序 ops、D3 排除诊断。
 * 合同：tests/fixtures/scripts/contract.md §6、docs/plan/records/P0-08.md §8。
 */

import type { TreeSnapshot } from "@xresconv/compat-service";
import { describe, expect, it } from "vitest";
import { buildMirror } from "../src/node-mirror.ts";

interface AnyNode {
  key: string | number;
  title: string;
  tooltip: string;
  folder: boolean;
  unselectable: boolean;
  data?: { item: Record<string, unknown>; option: { auto_select: boolean } };
  isFolder(): boolean;
  isSelected(): boolean;
  isPartsel(): boolean;
  isExpanded(): boolean;
  isRootNode(): boolean;
  getParent(): AnyNode | null;
  getChildren(): AnyNode[] | null;
  setSelected(flag?: boolean): undefined;
  toggleSelected(): undefined;
  setExpanded(flag?: boolean): undefined;
  visit(fn: (node: AnyNode) => unknown, includeSelf?: boolean): unknown;
  getSelectedNodes(stopOnParents?: boolean): AnyNode[];
  getTree(): { getSelectedNodes(s?: boolean): AnyNode[]; getRootNode(): AnyNode };
  getRootNode(): AnyNode;
  render(): undefined;
  toString(): string;
  [extra: string]: unknown;
}

function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${label} to be present`);
  }
  return value;
}

function makeSnapshot(): TreeSnapshot {
  return {
    version: 7,
    nodes: [
      {
        key: "cat:fruits",
        title: "fruits",
        tooltip: "fruits",
        folder: true,
        unselectable: false,
        selected: false,
        partsel: false,
        expanded: true,
        autoSelect: false,
        children: [
          {
            key: 1,
            title: "apple",
            tooltip: "apple desc",
            folder: false,
            unselectable: false,
            selected: true,
            partsel: false,
            expanded: false,
            autoSelect: false,
            item: { id: 1, name: "apple", desc: "apple desc", tags: ["t1"], classes: [] },
            children: [],
          },
          {
            key: 2,
            title: "banana",
            tooltip: "",
            folder: false,
            unselectable: true,
            selected: false,
            partsel: false,
            expanded: false,
            autoSelect: true,
            item: { id: 2, name: "banana", desc: "", tags: [], classes: [] },
            children: [],
          },
          {
            key: 4,
            title: "cherry",
            tooltip: "",
            folder: false,
            unselectable: false,
            selected: false,
            partsel: false,
            expanded: false,
            autoSelect: false,
            item: { id: 4, name: "cherry", desc: "", tags: [], classes: [] },
            children: [],
          },
        ],
      },
      {
        key: 3,
        title: "top-item",
        tooltip: "",
        folder: false,
        unselectable: false,
        selected: false,
        partsel: false,
        expanded: false,
        autoSelect: false,
        item: { id: 3, name: "top-item", desc: "", tags: [], classes: [] },
        children: [],
      },
    ],
  };
}

describe("别名恒等与初始状态（P0-08 §8）", () => {
  it("item.ft_node === node、node.data.item === item、node.key === item.id", () => {
    const mirror = buildMirror(makeSnapshot());
    expect(mirror.version).toBe(7);
    // 构造期聚合：apple 选中、cherry 未选、banana 被屏蔽（不计入聚合）→ fruits partsel
    expect(mirror.selectedNodes).toHaveLength(1);
    const node = mirror.selectedNodes[0] as AnyNode;
    const item = must(mirror.selectedItems[0], "selectedItems[0]");
    expect(node.key).toBe(1);
    expect(item.ft_node).toBe(node);
    expect(node.data?.item).toBe(item);
    expect(item.id).toBe(node.key);
    expect(node.isSelected()).toBe(true);
  });

  it("folder 节点无 data 字段（main.js:1447-1454）；根节点 key 为 root_1", () => {
    const mirror = buildMirror(makeSnapshot());
    const node = mirror.selectedNodes[0] as AnyNode;
    const folderNode = node.getParent() as AnyNode;
    expect(folderNode.folder).toBe(true);
    expect(folderNode.isFolder()).toBe(true);
    expect(folderNode.data).toBeUndefined();
    const root = node.getRootNode();
    expect(root.key).toBe("root_1");
    expect(root.isRootNode()).toBe(true);
    expect(folderNode.getParent()).toBe(root);
  });

  it("getChildren：叶子返回 null、文件夹返回子数组（fancytree 语义）", () => {
    const mirror = buildMirror(makeSnapshot());
    const node = mirror.selectedNodes[0] as AnyNode;
    expect(node.getChildren()).toBeNull();
    const folderNode = node.getParent() as AnyNode;
    expect(folderNode.getChildren()).toHaveLength(3);
  });
});

describe("同步方法与有序 ops", () => {
  it("setSelected 级联本地立即可读，ops 按调用序携带版本", () => {
    const mirror = buildMirror(makeSnapshot());
    const node = mirror.selectedNodes[0] as AnyNode;
    const folderNode = node.getParent() as AnyNode;
    folderNode.setSelected(true);
    // 2026-09-27 新语义：unselectable 的 banana 不被级联改写（屏蔽项绝不
    // 进入选择集）；可选子项被级联选中。
    const banana = folderNode.getChildren()?.[1] as AnyNode;
    expect(banana.isSelected()).toBe(false);
    expect(folderNode.isSelected()).toBe(true);
    folderNode.setExpanded(false);
    const ops = mirror.collectOps();
    expect(ops[0]).toMatchObject({ op: "set_node_states", v: 7 });
    const changes = (ops[0] as { changes: { key: string | number; selected: boolean }[] }).changes;
    // cherry(false→true) 与 folder(partsel→selected) 在变更集中；banana 不在
    expect(changes.map((c) => c.key)).toContain(4);
    expect(changes.map((c) => c.key)).toContain("cat:fruits");
    expect(changes.map((c) => c.key)).not.toContain(2);
    expect(ops[1]).toMatchObject({ op: "set_node_expanded", key: "cat:fruits", expanded: false });
  });

  it("unselectable 节点直接 setSelected 无 op 且无状态变化", () => {
    const mirror = buildMirror(makeSnapshot());
    const node = mirror.selectedNodes[0] as AnyNode;
    const banana = (node.getParent() as AnyNode).getChildren()?.[1] as AnyNode;
    banana.setSelected(true);
    expect(banana.isSelected()).toBe(false);
    const ops = mirror.collectOps();
    expect(ops.filter((op) => op.op === "set_node_states")).toHaveLength(0);
  });

  it("item 字段写入退出期 diff 为 set_fields（排除 ft_node/id，item_id 用构造期 id）", () => {
    const mirror = buildMirror(makeSnapshot());
    const item = must(mirror.selectedItems[0], "selectedItems[0]");
    item.name = "renamed";
    item.custom_field = { a: 1 };
    item.ft_node = "corrupted"; // 脚本覆写别名：不进 ops
    item.id = 999; // 脚本覆写身份：不进 ops、不影响 item_id
    const ops = mirror.collectOps();
    const setFields = ops.find((op) => op.op === "set_fields");
    expect(setFields).toBeDefined();
    expect(setFields).toMatchObject({ target: "item_data", item_id: 1, v: 7 });
    const fields = (setFields as { fields: Record<string, unknown> }).fields;
    expect(fields.name).toBe("renamed");
    expect(fields.custom_field).toEqual({ a: 1 });
    expect("ft_node" in fields).toBe(false);
    expect("id" in fields).toBe(false);
  });

  it("data.option.auto_select 写入产出 set_node_option", () => {
    const mirror = buildMirror(makeSnapshot());
    const node = mirror.selectedNodes[0] as AnyNode;
    must(node.data, "node.data").option.auto_select = true;
    const ops = mirror.collectOps();
    expect(ops.find((op) => op.op === "set_node_option")).toMatchObject({
      key: 1,
      fields: { auto_select: true },
    });
  });
});

describe("D3 排除接口诊断", () => {
  it("排除方法调用抛错并记一次 D3_EXCLUDED diagnostic op", () => {
    const mirror = buildMirror(makeSnapshot());
    const node = mirror.selectedNodes[0] as AnyNode;
    expect(() => (node.addChildren as () => void)()).toThrow(/not part of the supported/);
    expect(() => (node.addChildren as () => void)()).toThrow(/not part of the supported/);
    const diagnostics = mirror.collectOps().filter((op) => op.op === "diagnostic");
    expect(diagnostics).toHaveLength(1); // 去重
    expect(diagnostics[0]).toMatchObject({ code: "D3_EXCLUDED" });
    expect(String(must(diagnostics[0], "diagnostics[0]").message)).toContain("addChildren");
  });

  it("DOM 属性读取返回 undefined 并记诊断；未知属性静默 undefined", () => {
    const mirror = buildMirror(makeSnapshot());
    const node = mirror.selectedNodes[0] as AnyNode;
    expect(node.li).toBeUndefined();
    const diagnostics = mirror.collectOps().filter((op) => op.op === "diagnostic");
    expect(diagnostics).toHaveLength(1);
    expect(String(must(diagnostics[0], "diagnostics[0]").message)).toContain("li");
    // 未知属性不算命中排除清单
    expect(node.some_random_prop).toBeUndefined();
    expect(mirror.collectOps().filter((op) => op.op === "diagnostic")).toHaveLength(1);
  });

  it("直接写核心字段被忽略并记 D3_DIRECT_NODE_WRITE", () => {
    const mirror = buildMirror(makeSnapshot());
    const node = mirror.selectedNodes[0] as AnyNode;
    node.title = "hacked";
    expect(node.title).toBe("apple");
    const diagnostics = mirror.collectOps().filter((op) => op.op === "diagnostic");
    expect(diagnostics[0]).toMatchObject({ code: "D3_DIRECT_NODE_WRITE" });
  });

  it("render() 是 no-op（BD-S15）；toString/JSON 序列化不崩溃", () => {
    const mirror = buildMirror(makeSnapshot());
    const node = mirror.selectedNodes[0] as AnyNode;
    expect(node.render()).toBeUndefined();
    expect(node.toString()).toBe("FancytreeNode@1[title='apple']");
    const parsed = JSON.parse(JSON.stringify(node)) as Record<string, unknown>;
    expect(parsed).toMatchObject({ key: 1, selected: true });
    expect(mirror.collectOps().filter((op) => op.op === "diagnostic")).toHaveLength(0);
  });
});

describe("只读模式（on_append_log，BD-S16）", () => {
  it("读取/导航可用；修改方法 no-op 并记 D3_READ_ONLY", () => {
    const mirror = buildMirror(makeSnapshot(), { readonly: true });
    const node = mirror.selectedNodes[0] as AnyNode;
    expect(node.isSelected()).toBe(true);
    expect(node.getParent()?.key).toBe("cat:fruits");
    node.setSelected(false);
    expect(node.isSelected()).toBe(true);
    node.setExpanded(true);
    const ops = mirror.collectOps();
    expect(ops.filter((op) => op.op === "set_node_states")).toHaveLength(0);
    expect(ops.some((op) => op.op === "diagnostic" && op.code === "D3_READ_ONLY")).toBe(true);
  });
});

describe("getSelectedNodes / visit 经镜像", () => {
  it("树级 getSelectedNodes 反映实时级联结果；stopOnParents 生效", () => {
    const mirror = buildMirror(makeSnapshot());
    const node = mirror.selectedNodes[0] as AnyNode;
    const folderNode = node.getParent() as AnyNode;
    folderNode.setSelected(true);
    const all = node.getTree().getSelectedNodes();
    // banana 被屏蔽不进选择集；cherry 被级联选中
    expect(all.map((n) => n.key)).toEqual(["cat:fruits", 1, 4]);
    const stopped = node.getTree().getSelectedNodes(true);
    expect(stopped.map((n) => n.key)).toEqual(["cat:fruits"]);
  });

  it("node.visit 回调拿到镜像节点且可早停", () => {
    const mirror = buildMirror(makeSnapshot());
    const node = mirror.selectedNodes[0] as AnyNode;
    const folderNode = node.getParent() as AnyNode;
    const seen: (string | number)[] = [];
    folderNode.visit((child) => {
      seen.push(child.key);
      return undefined;
    });
    expect(seen).toEqual([1, 2, 4]);
    const seen2: (string | number)[] = [];
    folderNode.visit((child) => {
      seen2.push(child.key);
      return false;
    });
    expect(seen2).toEqual([1]);
  });
});
