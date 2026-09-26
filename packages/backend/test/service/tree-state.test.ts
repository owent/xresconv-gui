/**
 * SessionTreeState 单元测试（P2-05 后端半区）。
 *
 * 覆盖：构建/快照往返（旧版 item_data 载荷形状）、ops 应用与版本失配整批拒绝、
 * set_fields 旧版字段翻译（scheme_data→schemeData、id/ft_node 跳过）、
 * 矩阵资格（main.js:1050-1108 禁用/恢复分支）。
 * NodeMirror 侧的镜像/别名/诊断覆盖在 @xresconv/script-host 的 node-mirror.test.ts。
 */

import { describe, expect, it } from "vitest";
import type { ParsedConfig, TreeItem } from "../../src/config/model.ts";
import { flattenTreeItems } from "../../src/domain/selection.ts";
import {
  applyLegacyItemFields,
  SessionTreeState,
  toLegacyItemData,
} from "../../src/service/tree-state.ts";

function makeItem(name: string, extra: Partial<TreeItem> = {}): TreeItem {
  return {
    name,
    options: [],
    desc: `${name} desc`,
    schemeData: { DataSource: [`${name}.xlsx|s1|1,1`] },
    tags: [],
    classes: [],
    ...extra,
  };
}

/** id 赋值对齐 load-config：树文档序从 1 开始（每次构建独立编号，测试间不漂移）。 */
function makeConfig(
  tree: ParsedConfig["tree"],
  matrix: ParsedConfig["outputMatrix"] = [],
): ParsedConfig {
  const config = {
    path: "/tmp/p2-05/config.xml",
    dir: "/tmp/p2-05",
    protoFile: [],
    dataSrcDir: [],
    outputMatrix: matrix,
    globalOptions: [],
    javaOptions: ["-Dfile.encoding=UTF-8"],
    defaultScheme: [],
    gui: { onBeforeConvert: [], onAfterConvert: [], onAppendLog: [], scripts: {} },
    tree,
    diagnostics: [],
    loadedFiles: ["/tmp/p2-05/config.xml"],
  } as ParsedConfig;
  let id = 1;
  for (const item of flattenTreeItems(config.tree)) {
    item.id = id++;
  }
  return config;
}

describe("SessionTreeState", () => {
  it("matrix exclusions recompute ancestor selection and restore remembered selections", () => {
    const config = makeConfig([
      {
        kind: "category",
        id: "group",
        name: "group",
        children: [
          { kind: "item", item: makeItem("one") },
          { kind: "item", item: makeItem("two") },
        ],
      },
    ]);
    const state = new SessionTreeState(config);
    state.applyScriptOps([{ v: state.selectionVersion, op: "select_all" }]);
    state.replaceMatrixEligibility([{ tags: ["missing"], classes: [], type: "lua" }], true);
    expect(state.buildSnapshot().nodes[0]).toMatchObject({ selected: false, partsel: false });
    state.replaceMatrixEligibility([], false);
    expect(state.buildSnapshot().nodes[0]).toMatchObject({ selected: true, partsel: true });
    expect(state.getSelectedItems()).toHaveLength(2);
  });
  it("构建：快照节点为旧版载荷形状（snake_case、id、无 ft_node），版本从 1 起", () => {
    const config = makeConfig([
      {
        kind: "category",
        id: "c1",
        name: "Cat",
        children: [{ kind: "item", item: makeItem("a") }],
      },
      { kind: "item", item: makeItem("b", { tags: ["x"] }) },
    ]);
    const state = new SessionTreeState(config);
    const snapshot = state.buildSnapshot();
    expect(snapshot.version).toBe(1);
    expect(snapshot.nodes.length).toBe(2);
    const cat = snapshot.nodes[0];
    expect(cat?.key).toBe("cat:c1");
    expect(cat?.folder).toBe(true);
    expect(cat?.item).toBeUndefined();
    const leaf = cat?.children[0];
    expect(leaf?.key).toBe(1);
    expect(leaf?.item).toMatchObject({
      id: 1,
      name: "a",
      scheme_data: { DataSource: ["a.xlsx|s1|1,1"] },
    });
    expect(leaf?.item).not.toHaveProperty("ft_node");
    expect(leaf?.item).not.toHaveProperty("schemeData");
    // 顶层 item 节点
    expect(snapshot.nodes[1]?.key).toBe(2);
  });

  it("item 缺运行时 id → 构建抛错（load-config 必须先赋值）", () => {
    const config = makeConfig([{ kind: "item", item: makeItem("no-id") }]);
    const item = flattenTreeItems(config.tree)[0];
    expect(item).toBeDefined();
    if (item !== undefined) {
      delete item.id;
    }
    expect(() => new SessionTreeState(config)).toThrow(/missing runtime id/);
  });

  it("set_node_states ops 应用 + 选中派生；镜像版本随变更递增", () => {
    const config = makeConfig([
      { kind: "item", item: makeItem("a") },
      { kind: "item", item: makeItem("b") },
    ]);
    const state = new SessionTreeState(config);
    const v1 = state.buildSnapshot().version;
    const report = state.applyScriptOps([
      { op: "set_node_states", v: v1, changes: [{ key: 1, selected: true, partsel: true }] },
    ]);
    expect(report.applied).toBe(1);
    expect(report.rejected).toEqual([]);
    expect(state.getSelectedItems().map((item) => item.name)).toEqual(["a"]);
    expect(state.buildSnapshot().version).toBe(v1 + 1);
    // 快照反映活状态
    expect(state.buildSnapshot().nodes[0]?.selected).toBe(true);
  });

  it("版本失配整批拒绝（陈旧镜像的迟到写入不生效）", () => {
    const config = makeConfig([{ kind: "item", item: makeItem("a") }]);
    const state = new SessionTreeState(config);
    const report = state.applyScriptOps([
      { op: "set_node_states", v: 999, changes: [{ key: 1, selected: true, partsel: true }] },
      { op: "set_fields", v: 999, target: "item_data", item_id: 1, fields: { name: "hacked" } },
    ]);
    expect(report.applied).toBe(0);
    expect(report.rejected.length).toBe(2);
    expect(report.rejected[0]?.reason).toContain("stale tree version");
    expect(state.getSelectedItems()).toEqual([]);
    expect(flattenTreeItems(config.tree)[0]?.name).toBe("a");
  });

  it("set_fields 翻译旧版字段名；id/ft_node 被跳过；null 删键", () => {
    const config = makeConfig([{ kind: "item", item: makeItem("a") }]);
    const state = new SessionTreeState(config);
    const v = state.buildSnapshot().version;
    const report = state.applyScriptOps([
      {
        op: "set_fields",
        v,
        target: "item_data",
        item_id: 1,
        fields: {
          name: "renamed",
          scheme_data: { DataSource: ["z.xlsx|s2|2,2"] },
          id: 42,
          ft_node: {},
        },
      },
    ]);
    expect(report.applied).toBe(1);
    const item = flattenTreeItems(config.tree)[0];
    expect(item?.name).toBe("renamed");
    expect(item?.schemeData).toEqual({ DataSource: ["z.xlsx|s2|2,2"] });
    expect(item?.id).toBe(1); // id 是树身份，脚本不可改写
    expect(item).not.toHaveProperty("ft_node");
    // 活值进下一份快照（标题同步）
    expect(state.buildSnapshot().nodes[0]?.title).toBe("renamed");
  });

  it("diagnostic op 透传不进状态；未知 op 拒绝但不影响同批其他 op", () => {
    const config = makeConfig([{ kind: "item", item: makeItem("a") }]);
    const state = new SessionTreeState(config);
    const v = state.buildSnapshot().version;
    const report = state.applyScriptOps([
      { op: "diagnostic", v, code: "D3_EXCLUDED", message: "node.visitParents not supported" },
      { op: "mystery", v },
      { op: "set_node_states", v, changes: [{ key: 1, selected: true, partsel: true }] },
    ]);
    expect(report.diagnostics).toEqual([
      { code: "D3_EXCLUDED", message: "node.visitParents not supported" },
    ]);
    expect(report.rejected.length).toBe(1);
    expect(report.applied).toBe(1);
    expect(state.getSelectedItems().length).toBe(1);
  });

  it("矩阵资格：multiSelected 下不匹配 item 记忆勾选并置 unselectable；切出后恢复 auto_select", () => {
    const tagged = makeItem("tagged", { classes: ["keep"] });
    const plain = makeItem("plain");
    const matrix = [
      { tags: [], classes: ["keep"], type: "bin" },
      { tags: [], classes: ["keep"], type: "json" },
    ];
    const config = makeConfig(
      [
        { kind: "item", item: tagged },
        { kind: "item", item: plain },
      ],
      matrix,
    );
    const state = new SessionTreeState(config);
    // 加载期（内容推导 multiSelected=true）：plain 不匹配任何规则 → unselectable
    let snapshot = state.buildSnapshot();
    expect(snapshot.nodes[1]?.unselectable).toBe(true);
    expect(snapshot.nodes[0]?.unselectable).toBe(false);

    // 勾选 tagged，再应用矩阵（multiSelected）：tagged 匹配 → 不受影响
    state.applyScriptOps([
      {
        op: "set_node_states",
        v: state.buildSnapshot().version,
        changes: [{ key: 1, selected: true, partsel: true }],
      },
    ]);
    state.applyMatrixEligibility(matrix, true);
    expect(state.getSelectedItems().map((item) => item.name)).toEqual(["tagged"]);

    // 用户切出多输出项（main.js:1087-1108 enable 分支）：plain 恢复可勾选，
    // 并按记忆的 auto_select（加载期记忆为 false）保持未勾选
    state.applyMatrixEligibility(matrix, false);
    snapshot = state.buildSnapshot();
    expect(snapshot.nodes[1]?.unselectable).toBe(false);
    expect(snapshot.nodes[1]?.selected).toBe(false);
    expect(snapshot.nodes[0]?.selected).toBe(true);
  });

  it("矩阵屏蔽项不被父级级联/select_all 选中（2026-09-27 用户反馈回归）", () => {
    const keep = makeItem("keep", { classes: ["ok"] });
    const blocked = makeItem("blocked");
    const matrix = [{ tags: [], classes: ["ok"], type: "bin" }];
    const config = makeConfig(
      [
        {
          kind: "category",
          name: "group",
          children: [
            { kind: "item", item: keep },
            { kind: "item", item: blocked },
          ],
        },
      ],
      matrix,
    );
    const state = new SessionTreeState(config);
    // blocked 不匹配规则 → unselectable
    expect(state.buildSnapshot().nodes[0]?.children[1]?.unselectable).toBe(true);

    // 父级目录勾选（UI select_node op → applySetSelected 级联）
    const v = state.buildSnapshot().version;
    const report = state.applyScriptOps([
      { op: "select_node", v, key: "cat:group", selected: true },
    ]);
    expect(report.rejected).toHaveLength(0);
    const snap = state.buildSnapshot();
    const group = snap.nodes[0];
    expect(group?.children[0]?.selected).toBe(true); // keep 被级联选中
    expect(group?.children[1]?.selected).toBe(false); // blocked 保持未选
    expect(group?.children[1]?.unselectable).toBe(true);
    // 屏蔽项不阻碍父级达成全选（可计子项全选 → 目录 ✓）
    expect(group?.selected).toBe(true);
    // 屏蔽项不进入转换选择集
    expect(state.getSelectedItems().map((item) => item.name)).toEqual(["keep"]);
  });

  it("矩阵资格：auto_select 记忆——禁用前勾选的 item 在恢复时重新勾选", () => {
    // 单规则无限定 → withRule=false，加载期不动；随后矩阵换成带限定规则时
    // 已勾选的匹配项不受影响；不匹配且已勾选的项被记忆 auto_select=true 并取消。
    const plain = makeItem("plain");
    const config = makeConfig(
      [{ kind: "item", item: plain }],
      [{ tags: [], classes: [], type: "bin" }],
    );
    const state = new SessionTreeState(config);
    expect(state.buildSnapshot().nodes[0]?.unselectable).toBe(false);
    state.applyScriptOps([
      {
        op: "set_node_states",
        v: state.buildSnapshot().version,
        changes: [{ key: 1, selected: true, partsel: true }],
      },
    ]);
    const strict = [
      { tags: [], classes: ["vip"], type: "bin" },
      { tags: [], classes: ["vip"], type: "json" },
    ];
    state.applyMatrixEligibility(strict, true);
    let node = state.buildSnapshot().nodes[0];
    expect(node?.unselectable).toBe(true);
    expect(node?.selected).toBe(false);
    // 恢复：auto_select 记忆为 true → 重新勾选（main.js:1105）
    state.applyMatrixEligibility(strict, false);
    node = state.buildSnapshot().nodes[0];
    expect(node?.unselectable).toBe(false);
    expect(node?.selected).toBe(true);
  });

  it("applyLegacyItemFields / toLegacyItemData 助手：scheme_data 翻译、id/ft_node 免疫", () => {
    const item = makeItem("x");
    applyLegacyItemFields(item, {
      scheme_data: { S: ["v"] },
      name: "y",
      id: 99,
      ft_node: { hack: true },
    });
    expect(item.schemeData).toEqual({ S: ["v"] });
    expect(item.name).toBe("y");
    expect(item.id).not.toBe(99);
    expect(item).not.toHaveProperty("ft_node");
    const payload = toLegacyItemData(item);
    expect(payload.scheme_data).toEqual({ S: ["v"] });
    expect(payload).not.toHaveProperty("schemeData");
  });

  it("UI select_node：toggle 级联三态（父子混选），stateChanges 供增量同步", () => {
    const config = makeConfig([
      {
        kind: "category",
        id: "c1",
        name: "Cat",
        children: [
          { kind: "item", item: makeItem("a") },
          { kind: "item", item: makeItem("b") },
        ],
      },
    ]);
    const state = new SessionTreeState(config);
    const v1 = state.buildSnapshot().version;
    // toggle 父节点 → 级联全选，父 selected=true partsel=false。
    const report = state.applyScriptOps([{ op: "select_node", v: v1, key: "cat:c1" }]);
    expect(report.applied).toBe(1);
    expect(report.stateChanges.length).toBe(3);
    expect(report.version).toBe(v1 + 1);
    expect(state.getSelectedItems().map((item) => item.name)).toEqual(["a", "b"]);
    // 再 toggle 一个叶子 → 父转 partsel。
    const report2 = state.applyScriptOps([{ op: "select_node", v: report.version, key: 1 }]);
    expect(report2.stateChanges.length).toBeGreaterThan(0);
    const snap = state.buildSnapshot();
    expect(snap.nodes[0]?.selected).toBe(false);
    expect(snap.nodes[0]?.partsel).toBe(true);
    expect(state.getSelectedItems().map((item) => item.name)).toEqual(["b"]);
  });

  it("UI select_node：显式 selected=false；unselectable 为 no-op（fancytree 直调语义）", () => {
    const config = makeConfig(
      [
        {
          kind: "category",
          id: "c1",
          name: "Cat",
          children: [
            { kind: "item", item: makeItem("a") },
            { kind: "item", item: makeItem("b") },
          ],
        },
      ],
      [{ type: "bin", tags: ["keep"], classes: [] }],
    );
    const state = new SessionTreeState(config);
    // 矩阵资格（withRule 单规则）首次多输出勾选时禁用不匹配项——先全选再禁用：
    state.applyScriptOps([{ op: "select_all", v: state.buildSnapshot().version }]);
    const matrix = config.outputMatrix;
    state.applyMatrixEligibility(matrix, true); // 两 item 均不匹配 → 禁用并记忆勾选
    const before = state.buildSnapshot().version;
    const report = state.applyScriptOps([{ op: "select_node", v: before, key: 1 }]);
    expect(report.applied).toBe(1);
    expect(report.stateChanges).toEqual([]); // unselectable no-op，不报错误
    expect(report.version).toBe(before); // 无实际变更不推版本
    expect(state.buildSnapshot().nodes[0]?.children[0]?.unselectable).toBe(true);
  });

  it("UI select_all/select_none：版本闸 + report.version 回传 + 空变更不推版本", () => {
    const config = makeConfig([
      {
        kind: "category",
        id: "c1",
        name: "Cat",
        children: [{ kind: "item", item: makeItem("a") }],
      },
      { kind: "item", item: makeItem("b") },
    ]);
    const state = new SessionTreeState(config);
    const v1 = state.buildSnapshot().version;
    const all = state.applyScriptOps([{ op: "select_all", v: v1 }]);
    expect(all.applied).toBe(1);
    expect(all.version).toBe(v1 + 1);
    expect(state.getSelectedItems().map((item) => item.name)).toEqual(["a", "b"]);
    // 重复 select_all：无实际变更，版本不推（幂等）。
    const again = state.applyScriptOps([{ op: "select_all", v: all.version }]);
    expect(again.stateChanges).toEqual([]);
    expect(again.version).toBe(all.version);
    // 版本失配整批拒绝，report.version 仍为当前版本供重同步。
    const stale = state.applyScriptOps([{ op: "select_none", v: 999 }]);
    expect(stale.applied).toBe(0);
    expect(stale.rejected[0]?.reason).toContain("stale tree version");
    expect(stale.version).toBe(all.version);
    // 正确版本 select_none 生效。
    const none = state.applyScriptOps([{ op: "select_none", v: all.version }]);
    expect(none.applied).toBe(1);
    expect(state.getSelectedItems()).toEqual([]);
  });

  it("UI select_node：未知 key 拒绝该 op 但不影响同批其他 op", () => {
    const config = makeConfig([{ kind: "item", item: makeItem("a") }]);
    const state = new SessionTreeState(config);
    const v1 = state.buildSnapshot().version;
    const report = state.applyScriptOps([
      { op: "select_node", v: v1, key: 999 },
      { op: "select_node", v: v1, key: 1, selected: true },
    ]);
    expect(report.applied).toBe(1);
    expect(report.rejected.length).toBe(1);
    expect(report.rejected[0]?.reason).toContain("unknown tree node key");
    expect(state.getSelectedItems().map((item) => item.name)).toEqual(["a"]);
  });
});
