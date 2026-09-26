/**
 * 会话树状态（P2-05）：backend 侧的选择/展开权威状态与脚本 ops 应用。
 *
 * 职责：
 * - 从 ParsedConfig 构建 SelectionTree（@xresconv/compat-service，与 worker 内
 *   NodeMirror 共享同一 selectMode:3 实现，禁止分叉）与 item/option 索引；
 * - 生成线上快照（script-invoke context.tree）：item 载荷翻译回旧版字段形状
 *   （snake_case scheme_data、id、无 ft_node——别名由 worker 镜像重建）；
 * - 应用 worker 回传的 ops（set_node_states/set_node_expanded/set_fields/
 *   set_node_option/diagnostic）与 UI 选择 ops（select_node/select_all/
 *   select_none，P4-03；级联走同一 SelectionTree，UI 不分叉实现），
 *   逐 op 校验快照版本，失配整批拒绝；
 * - 矩阵资格（main.js:1034-1110 show_output_matrix）：见 applyMatrixEligibility。
 *
 * 版本约定：version 从 1 开始，每成功应用一批 ops 或一次矩阵资格变化 +1。
 * worker ops 上的 v 必须等于当前版本，否则整批拒绝（陈旧镜像的迟到写入不生效）。
 */

import {
  type NodeStateChange,
  SelectionTree,
  type TreeNodeSnapshot,
  type TreeSnapshot,
} from "@xresconv/compat-service";
import type { OutputMatrixRule, ParsedConfig, TreeItem, TreeNode } from "../config/model.ts";
import { isMatrixMode, matrixRuleMatchesItem } from "../domain/selection.ts";

export interface AppliedOpsReport {
  /** 成功应用的 op 数（diagnostic 不计入，它只进日志）。 */
  applied: number;
  /** 被拒绝的 op（含原因）；版本失配时全部拒绝。 */
  rejected: { op: string; reason: string }[];
  /** 脚本侧诊断（D3_EXCLUDED/D3_READ_ONLY/...），调用方负责进日志。 */
  diagnostics: { code: string; message: string }[];
  /** 应用后的当前版本（含失配拒绝场景——调用方据此重同步）。 */
  version: number;
  /**
   * UI 选择 ops（select_node/select_all/select_none，P4-03）产生的级联变更
   * 全集（应用顺序）；调用方（壳 UI）据此做增量显示更新，无需整树重取。
   * worker 路径的 set_node_states 是镜像盖章，不回填此字段。
   */
  stateChanges: NodeStateChange[];
}

/** worker ops 支持的最小形状（ops 契约见 docs/plan/records/P2-05.md）。 */
interface ScriptOp {
  v?: unknown;
  op?: unknown;
  [key: string]: unknown;
}

/**
 * 旧版 item_data 字段名 → 模型字段名的字段级应用（唯一不同名的是 scheme_data）。
 * id / ft_node 被跳过：id 是树身份（脚本改写会破坏 key 索引），ft_node 由
 * worker 镜像重建、线上不出现（P2-05 合同）。
 */
export function applyLegacyItemField(item: TreeItem, key: string, value: unknown): void {
  if (key === "id" || key === "ft_node") {
    return;
  }
  const target = item as unknown as Record<string, unknown>;
  if (key === "scheme_data") {
    target.schemeData = value;
    return;
  }
  Object.defineProperty(target, key, {
    value: structuredClone(value),
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

/** 批量应用旧版字段集（value===null → 删键，对齐 worker diffFields 语义）。 */
export function applyLegacyItemFields(item: TreeItem, fields: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) {
      if (key !== "id" && key !== "ft_node") {
        delete (item as unknown as Record<string, unknown>)[
          key === "scheme_data" ? "schemeData" : key
        ];
      }
    } else {
      applyLegacyItemField(item, key, value);
    }
  }
}

/** item 模型 → 旧版 item_data 载荷（schemeData→scheme_data、附 id、无 ft_node）。 */
export function toLegacyItemData(item: TreeItem): Record<string, unknown> {
  const { schemeData, ...fields } = structuredClone(item);
  return { ...fields, scheme_data: schemeData };
}

export class SessionTreeState {
  private readonly selectionTree: SelectionTree;
  private readonly itemById = new Map<number, TreeItem>();
  /** key → auto_select 活状态（data.option.auto_select，main.js:1766-1769）。 */
  private readonly optionByKey = new Map<string | number, { auto_select: boolean }>();
  private version = 1;
  private readonly matrixBlocked = new Set<string | number>();
  readonly config: ParsedConfig;

  constructor(config: ParsedConfig, initialVersion = 1) {
    this.version = initialVersion;
    this.config = config;
    const nodes = config.tree.map((node) => this.toSnapshotNode(node));
    this.selectionTree = new SelectionTree(nodes);
    // 加载期矩阵资格：multiSelected 由内容推导（main.js:1333-1340 在加载时把
    // 多输出项设为选中）；withRule ⇒ 内容必为 multi，故门内即旧版 disable 分支。
    const matrix = config.outputMatrix;
    this.applyMatrixEligibility(matrix, isMatrixMode(matrix));
  }

  get selectionVersion(): number {
    return this.version;
  }

  /** 当前选中 item（DFS 序，main.js:2003-2008 只收集 items 存在的节点）。 */
  getSelectedItems(): TreeItem[] {
    const items: TreeItem[] = [];
    for (const node of this.selectionTree.getSelectedNodes()) {
      if (typeof node.key === "number") {
        const item = this.itemById.get(node.key);
        if (item !== undefined) {
          items.push(item);
        }
      }
    }
    return items;
  }

  /**
   * 用调用方给定的 item 集合替换当前勾选（UI 勾选状态 → 树状态的同步入口，
   * 对应旧版 fancytree 复选框是唯一事实来源）。逐项走 setSelected 级联；
   * unselectable 项被忽略（fancytree 直调 no-op 语义）。有实际变化时版本 +1。
   */
  replaceSelection(items: readonly TreeItem[]): void {
    const wanted = new Set<number>();
    for (const item of items) {
      if (typeof item.id === "number") {
        wanted.add(item.id);
      }
    }
    let mutated = false;
    // 先取消不在目标集里的已选 item（folder 状态由级联自动维护）。
    for (const node of this.selectionTree.getSelectedNodes()) {
      if (typeof node.key === "number" && !wanted.has(node.key)) {
        if (this.selectionTree.applySetSelected(node.key, false).length > 0) {
          mutated = true;
        }
      }
    }
    for (const key of wanted) {
      if (this.selectionTree.applySetSelected(key, true).length > 0) {
        mutated = true;
      }
    }
    if (mutated) {
      this.version++;
    }
  }

  /** 线上快照：worker NodeMirror 的输入。状态取自 SelectionTree 活状态（不是模型，
   * 否则丢失脚本/矩阵资格造成的后续变化）；item 载荷从 TreeItem 活值重新翻译。 */
  buildSnapshot(): TreeSnapshot {
    return {
      version: this.version,
      nodes: this.selectionTree.rootNodes().map((n) => this.toLiveSnapshotNode(n)),
    };
  }

  /**
   * 矩阵资格（main.js:1034-1110 show_output_matrix）：`multiSelected` 对应旧版
   * "多输出项当前被选中"（selectedIndex==index，加载期由内容推导：规则>1 或唯一
   * 规则带限定，main.js:1333-1340）。两分支都以 output_matrix_with_rule 为门
   * （矩阵非空且每条规则带 tags/classes，main.js:1324-1331）；都只处理**不匹配**
   * 任何规则的 item：multiSelected 时记忆勾选→取消勾选→置 unselectable
   * （main.js:1072-1077），否则恢复 unselectable 并按记忆的 auto_select 勾选
   * （main.js:1103-1107）。withRule=false 时旧版两分支均不执行 → 此处 no-op。
   */
  applyMatrixEligibility(matrix: OutputMatrixRule[], multiSelected: boolean): void {
    const withRule =
      matrix.length > 0 && matrix.every((r) => r.tags.length > 0 || r.classes.length > 0);
    if (!withRule) {
      return;
    }
    this.walkItemKeys((key, item) => {
      const option = this.optionByKey.get(key);
      if (option === undefined) {
        return;
      }
      const node = this.selectionTree.getNode(key);
      if (node === undefined) {
        return;
      }
      const allowed = matrix.some((rule) => matrixRuleMatchesItem(rule, item));
      if (allowed) {
        return; // 两分支都只处理不匹配项（main.js:1072/1103）
      }
      if (multiSelected) {
        // main.js:1073-1075：先记忆当前勾选，再取消勾选并禁止。
        if (!this.matrixBlocked.has(key)) {
          option.auto_select = node.selected;
        }
        this.matrixBlocked.add(key);
        this.selectionTree.applySetSelected(key, false);
        this.selectionTree.applyUnselectable(key, true);
      } else {
        this.matrixBlocked.delete(key);
        // main.js:1104-1105：恢复可勾选并按记忆的 auto_select 勾选。
        this.selectionTree.applyUnselectable(key, false);
        this.selectionTree.applySetSelected(key, option.auto_select);
      }
    });
    this.version++;
  }

  /** Editable matrices must release restrictions imposed by the previous rules. */
  replaceMatrixEligibility(matrix: OutputMatrixRule[], multiSelected: boolean): void {
    for (const key of this.matrixBlocked) {
      this.selectionTree.applyUnselectable(key, false);
      this.selectionTree.applySetSelected(key, this.optionByKey.get(key)?.auto_select ?? false);
    }
    this.matrixBlocked.clear();
    this.applyMatrixEligibility(matrix, multiSelected);
    this.version++;
  }

  /**
   * 应用一批脚本 ops。版本失配（任何 op.v !== 当前版本）→ 整批拒绝。
   * 单个 op 的结构性问题只拒绝该 op（其余继续），并给出原因。
   *
   * ops 词汇（P2-05 worker 契约 + P4-03 UI 扩展）：
   * - set_node_states（worker 镜像盖章，绝对状态）/ set_node_expanded /
   *   set_fields / set_node_option / diagnostic：worker 脚本路径；
   * - select_node {key, selected?}（P4-03 UI）：selected 缺省 = toggle
   *   （applyToggleSelected，旧版 Space/双击语义），否则 applySetSelected；
   *   级联与 unselectable no-op 语义同 fancytree selectMode:3；
   * - select_all / select_none（P4-03 UI）：旧版按钮语义——visit 全树
   *   setSelected(true/false)（unselectable 逐项 no-op）。
   */
  applyScriptOps(rawOps: readonly unknown[]): AppliedOpsReport {
    const report: AppliedOpsReport = {
      applied: 0,
      rejected: [],
      diagnostics: [],
      version: this.version,
      stateChanges: [],
    };
    const ops = rawOps.filter((op): op is ScriptOp => typeof op === "object" && op !== null);
    const versionMismatch = ops.some((op) => op.v !== this.version);
    if (versionMismatch) {
      for (const op of ops) {
        report.rejected.push({
          op: String(op.op),
          reason: `stale tree version (op v=${String(op.v)}, current=${this.version})`,
        });
      }
      return report;
    }
    let mutated = false;
    for (const op of ops) {
      switch (op.op) {
        case "diagnostic": {
          report.diagnostics.push({
            code: typeof op.code === "string" ? op.code : "UNKNOWN",
            message: typeof op.message === "string" ? op.message : String(op.message),
          });
          break;
        }
        case "set_node_states": {
          const changes = op.changes;
          if (!Array.isArray(changes)) {
            report.rejected.push({ op: op.op, reason: "changes must be an array" });
            break;
          }
          try {
            this.selectionTree.applyNodeStates(changes as NodeStateChange[]);
            report.applied++;
            mutated = true;
          } catch (err) {
            report.rejected.push({
              op: op.op,
              reason: err instanceof Error ? err.message : String(err),
            });
          }
          break;
        }
        case "set_node_expanded": {
          const key = op.key;
          if (typeof key !== "string" && typeof key !== "number") {
            report.rejected.push({ op: op.op, reason: "key must be string|number" });
            break;
          }
          try {
            this.selectionTree.applySetExpanded(key, op.expanded === true);
            mutated = true;
            report.applied++;
          } catch (err) {
            report.rejected.push({
              op: op.op,
              reason: err instanceof Error ? err.message : String(err),
            });
          }
          break;
        }
        case "set_fields": {
          if (op.target !== "item_data") {
            report.rejected.push({ op: op.op, reason: `unsupported target ${String(op.target)}` });
            break;
          }
          const itemId = op.item_id;
          const item = typeof itemId === "number" ? this.itemById.get(itemId) : undefined;
          if (item === undefined) {
            report.rejected.push({ op: op.op, reason: `unknown item_id ${String(itemId)}` });
            break;
          }
          const fields = op.fields;
          if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
            report.rejected.push({ op: op.op, reason: "fields must be an object" });
            break;
          }
          applyLegacyItemFields(item, fields as Record<string, unknown>);
          report.applied++;
          mutated = true;
          break;
        }
        case "set_node_option": {
          const key = op.key;
          if ((typeof key !== "string" && typeof key !== "number") || !this.optionByKey.has(key)) {
            report.rejected.push({ op: op.op, reason: `unknown node key ${String(key)}` });
            break;
          }
          const fields = op.fields;
          if (typeof fields !== "object" || fields === null) {
            report.rejected.push({ op: op.op, reason: "fields must be an object" });
            break;
          }
          const option = this.optionByKey.get(key);
          if (option !== undefined && "auto_select" in fields) {
            option.auto_select = (fields as Record<string, unknown>).auto_select === true;
            report.applied++;
            mutated = true;
          }
          break;
        }
        // ---- P4-03 UI 选择 ops（级联在 SelectionTree 内完成，UI 不分叉实现）----
        case "select_node": {
          const key = op.key;
          if (typeof key !== "string" && typeof key !== "number") {
            report.rejected.push({ op: op.op, reason: "key must be string|number" });
            break;
          }
          try {
            // selected 缺省 = toggle（旧版 Space/双击）；显式 bool = set。
            const changes =
              op.selected === undefined
                ? this.selectionTree.applyToggleSelected(key)
                : this.selectionTree.applySetSelected(key, op.selected === true);
            report.stateChanges.push(...changes);
            report.applied++;
            if (changes.length > 0) {
              mutated = true;
            }
          } catch (err) {
            report.rejected.push({
              op: op.op,
              reason: err instanceof Error ? err.message : String(err),
            });
          }
          break;
        }
        case "select_all":
        case "select_none": {
          // 旧版按钮语义（main.js:678-695/2678-2695）：visit 全树 setSelected(flag)，
          // unselectable 逐项 no-op；级联使后置调用早退，变更集天然不重复。
          // 选择只改标志位、不改树结构，visit 遍历中调用安全。
          const flag = op.op === "select_all";
          this.selectionTree.visit((node) => {
            report.stateChanges.push(...this.selectionTree.applySetSelected(node.key, flag));
          });
          report.applied++;
          if (report.stateChanges.length > 0) {
            mutated = true;
          }
          break;
        }
        default:
          report.rejected.push({ op: String(op.op), reason: "unknown op" });
      }
    }
    if (mutated) {
      this.version++;
    }
    report.version = this.version;
    return report;
  }

  private walkItemKeys(fn: (key: number, item: TreeItem) => void): void {
    for (const [id, item] of this.itemById) {
      fn(id, item);
    }
  }

  /** SelectionTree 活节点 → 线上快照节点（item 节点标题/提示/载荷取 TreeItem 活值）。 */
  private toLiveSnapshotNode(
    state: ReturnType<SelectionTree["rootNodes"]>[number],
  ): TreeNodeSnapshot {
    const snapshot: TreeNodeSnapshot = {
      key: state.key,
      title: state.title,
      tooltip: state.tooltip,
      folder: state.folder,
      unselectable: state.unselectable,
      selected: state.selected,
      partsel: state.partsel,
      expanded: state.expanded,
      autoSelect: this.optionByKey.get(state.key)?.auto_select ?? state.autoSelect,
      children: state.children.map((child) => this.toLiveSnapshotNode(child)),
    };
    if (typeof state.key === "number") {
      const item = this.itemById.get(state.key);
      if (item !== undefined) {
        snapshot.title = item.name;
        snapshot.tooltip = item.desc;
        snapshot.item = toLegacyItemData(item);
      }
    }
    return snapshot;
  }

  /**
   * 模型节点 → 线上快照节点。item 载荷翻译回旧版字段形状（contract.md §6）：
   * schemeData→scheme_data；附 id；不含 ft_node（worker 镜像重建别名）。
   */
  private toSnapshotNode(node: TreeNode): TreeNodeSnapshot {
    if (node.kind === "category") {
      const key = `cat:${node.id ?? node.name}`;
      return {
        key,
        title: node.name,
        tooltip: node.name, // 旧版 folder tooltip=title（main.js:1449-1452）
        folder: true,
        unselectable: false,
        selected: false,
        partsel: false,
        expanded: false,
        autoSelect: false,
        children: node.children.map((child) => this.toSnapshotNode(child)),
      };
    }
    const item = node.item;
    const key = item.id;
    if (key === undefined) {
      throw new Error("tree item missing runtime id (load-config must assign ids first)");
    }
    this.itemById.set(key, item);
    const option = { auto_select: false };
    this.optionByKey.set(key, option);
    return {
      key,
      title: item.name,
      tooltip: item.desc,
      folder: false,
      unselectable: false,
      selected: false,
      partsel: false,
      expanded: false,
      autoSelect: option.auto_select,
      item: toLegacyItemData(item),
      children: [],
    };
  }
}
