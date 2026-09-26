/**
 * Fancytree selectMode:3 选择/展开语义的纯数据重实现（P2-05 NodeMirror 共享层）。
 *
 * 这是 worker 内 NodeMirror 与 backend 会话树状态的**唯一**三态选择实现，
 * 两侧必须共享同一份代码，禁止各自重写（04-ui.md：React Aria 默认 selection
 * 不等于 selectMode 3）。语义逐行对齐随旧版发行的 jquery.fancytree 2.38.5
 * （node_modules/jquery.fancytree/dist/jquery.fancytree-all.js，下文行号锚点）：
 *
 * - nodeSetSelected（ft-all.js:5743-5818）：unselectable 直调 no-op；
 *   `_lastSelectIntent`；`selected===flag && !(partsel && !flag)` 早退；
 *   selectMode 3 → selected=flag + fixSelection3AfterClick。
 * - nodeToggleSelected（ft-all.js:5941-5956）：flag=!selected；
 *   partsel && !selected && _lastSelectIntent===true → flag=false 且先置
 *   selected=true 防早退。
 * - fixSelection3AfterClick（ft-all.js:1041-1058）：visit 子树全部
 *   _changeSelectStatusAttrs(flag)，再 fixSelection3FromEndNodes。
 * - fixSelection3FromEndNodes（ft-all.js:1061-1180）：先 _walk 自身（有子节点则
 *   由子状态聚合覆盖自身），再 visitParents 逐层聚合（child.selected ||
 *   child.partsel → someSelected）。
 * - _changeSelectStatusAttrs（ft-all.js:991-1032）：false→(false,false)；
 *   true→(true,true)；undefined→(false,true)。旧应用从不配置
 *   unselectableStatus / unselectableIgnore / radiogroup / lazy（main.js 未出现），
 *   这些分支不实现（BD-S15 记录）。
 * - visit（ft-all.js:2497-2518）：fn 返回 false 全停、"skip" 跳过子树。
 * - getSelectedNodes（ft-all.js:1397-1410）：DFS 收集 selected；
 *   stopOnParents=true 时命中后 skip 子树。
 *
 * 本模块不感知 item 业务字段；快照节点上的 `item` 载荷原样透传给镜像层。
 */

/** 线上快照节点（script-invoke context.tree 的元素；backend 生成、worker 消费）。 */
export interface TreeNodeSnapshot {
  /** item 节点 = item.id（number，main.js:1764）；category 节点 = 稳定字符串。 */
  key: string | number;
  title: string;
  tooltip: string;
  folder: boolean;
  unselectable: boolean;
  selected: boolean;
  partsel: boolean;
  expanded: boolean;
  /** node.data.option.auto_select（main.js:1766-1769）。 */
  autoSelect: boolean;
  /** item 节点载荷（脚本的 item_data 本体，ft_node 键由镜像层重建，线上不出现）。 */
  item?: Record<string, unknown>;
  children: TreeNodeSnapshot[];
}

/** 线上树快照（context.tree）：版本用于 ops 的代际校验。 */
export interface TreeSnapshot {
  version: number;
  nodes: TreeNodeSnapshot[];
}

/** 一次选择状态变更影响到的一个节点（ops 的 changes 元素）。 */
export interface NodeStateChange {
  key: string | number;
  selected: boolean;
  partsel: boolean;
}

/** 内部节点状态（含父链）。 */
interface NodeState {
  key: string | number;
  title: string;
  tooltip: string;
  folder: boolean;
  unselectable: boolean;
  selected: boolean;
  partsel: boolean;
  expanded: boolean;
  autoSelect: boolean;
  item?: Record<string, unknown>;
  parent: NodeState | null;
  children: NodeState[];
  /** fancytree 同名内部字段（ft-all.js:5764、5947-5953）。 */
  lastSelectIntent: boolean;
}

export interface VisitContext {
  key: string | number;
  folder: boolean;
  selected: boolean;
  partsel: boolean;
}

/**
 * 一棵树的 selectMode:3 状态机。构造时对每个顶层节点跑
 * fixSelection3FromEndNodes（等价 fancytree 加载后的聚合），随后全部
 * 读写经 apply* 方法，保证与旧 GUI 的可见状态一致。
 */
export class SelectionTree {
  private readonly byKey = new Map<string | number, NodeState>();
  private readonly roots: NodeState[] = [];

  constructor(nodes: TreeNodeSnapshot[]) {
    const build = (snap: TreeNodeSnapshot, parent: NodeState | null): NodeState => {
      const state: NodeState = {
        key: snap.key,
        title: snap.title,
        tooltip: snap.tooltip,
        folder: snap.folder,
        unselectable: snap.unselectable,
        selected: snap.selected,
        partsel: snap.partsel,
        expanded: snap.expanded,
        autoSelect: snap.autoSelect,
        parent,
        children: [],
        lastSelectIntent: snap.selected,
      };
      if (snap.item !== undefined) {
        state.item = snap.item;
      }
      state.children = snap.children.map((child) => build(child, state));
      if (this.byKey.has(state.key)) {
        throw new Error(`duplicate tree node key: ${String(state.key)}`);
      }
      this.byKey.set(state.key, state);
      return state;
    };
    this.roots = nodes.map((snap) => build(snap, null));
    // fancytree 加载后按 end-node 聚合父级状态（fixSelection3FromEndNodes）。
    for (const root of this.roots) {
      this.fixFromEndNodes(root);
    }
  }

  getNode(key: string | number): Readonly<NodeState> | undefined {
    return this.byKey.get(key);
  }

  rootNodes(): readonly NodeState[] {
    return this.roots;
  }

  /**
   * nodeSetSelected（ft-all.js:5743-5818，selectMode 3 路径）。
   * 返回 (selected,partsel) 实际发生变化的节点列表（应用顺序）；unselectable
   * 直调或状态无变化 → 空数组（fancytree 返回 undefined/flag，不产生效果）。
   */
  applySetSelected(key: string | number, flag = true): NodeStateChange[] {
    const node = this.mustGet(key);
    // ft-all.js:5755-5762：不能直接 (de)select unselectable 节点（仅级联可达）。
    if (node.unselectable) {
      return [];
    }
    const normalized = flag !== false; // ft-all.js:5752
    node.lastSelectIntent = normalized;
    if (node.selected === normalized && !(node.partsel && !normalized)) {
      return []; // ft-all.js:5767-5774 早退
    }
    const tracker = new ChangeTracker();
    // fixSelection3AfterClick（ft-all.js:1041-1058）。fancytree 的 visit 不含自身，
    // 但 clicked 节点随后被 fixSelection3FromEndNodes 的 _walk 覆盖定稿；此处直接
    // 让级联覆盖自身，终态等价且变更集能正确包含 clicked 节点（backend 盖章依据）。
    this.visitState(node, (child) => {
      // 2026-09-27：级联不改写 unselectable 节点（fancytree `unselectableIgnore`
      // 语义）——矩阵屏蔽项保持未选；旧 GUI 的 auto_select 记忆+屏蔽意图明确
      // 要求屏蔽项绝不进入选择集（官方 _changeSelectStatusAttrs 对未配置
      // unselectableStatus 的节点不做拦截，属上游潜伏行为，不沿用）。
      if (child.unselectable) {
        return;
      }
      this.changeSelectStatusAttrs(child, normalized, tracker);
    });
    this.fixFromEndNodes(node, tracker);
    return tracker.changes;
  }

  /** nodeToggleSelected（ft-all.js:5941-5956）。 */
  applyToggleSelected(key: string | number): NodeStateChange[] {
    const node = this.mustGet(key);
    let flag = !node.selected;
    if (node.partsel && !node.selected && node.lastSelectIntent === true) {
      flag = false;
      node.selected = true; // 防 nodeSetSelected 早退（ft-all.js:5953）
    }
    node.lastSelectIntent = flag;
    // 直接走 nodeSetSelected 主路径（含 unselectable 判定与早退）。
    if (node.unselectable) {
      return [];
    }
    if (node.selected === flag && !(node.partsel && !flag)) {
      return [];
    }
    const tracker = new ChangeTracker();
    this.visitState(node, (child) => {
      this.changeSelectStatusAttrs(child, flag, tracker);
    });
    this.fixFromEndNodes(node, tracker);
    return tracker.changes;
  }

  /** setExpanded（ft-all.js:2273-2276 委托 nodeSetExpanded；懒加载/动画不存在）。 */
  applySetExpanded(key: string | number, flag = true): boolean {
    const node = this.mustGet(key);
    const normalized = flag !== false;
    const changed = node.expanded !== normalized;
    node.expanded = normalized;
    return changed;
  }

  /**
   * setUnselectable 的标志部分（ft-all.js:5983-6010 的 fixSelection/render 分支
   * 不做——backend 矩阵资格已先自行取消勾选，见 main.js:1064-1076 顺序）。
   * 返回标志是否变化。
   */
  applyUnselectable(key: string | number, flag: boolean): boolean {
    const node = this.mustGet(key);
    const changed = node.unselectable !== flag;
    node.unselectable = flag;
    return changed;
  }

  /**
   * 盖章应用镜像侧已计算好的变更（backend 应用 worker ops 的路径）：
   * 两侧跑同一实现，变更集必然确定；此处只做存在性校验与盖章。
   *
   * @throws Error 变更引用了未知节点 key。
   */
  applyNodeStates(changes: readonly NodeStateChange[]): void {
    for (const change of changes) {
      if (
        change === null ||
        typeof change !== "object" ||
        typeof change.selected !== "boolean" ||
        typeof change.partsel !== "boolean"
      ) {
        throw new Error("node state requires boolean selected and partsel");
      }
      const node = this.byKey.get(change.key);
      if (node === undefined) {
        throw new Error(`unknown tree node key: ${String(change.key)}`);
      }
    }
    for (const change of changes) {
      const node = this.mustGet(change.key);
      node.selected = change.selected;
      node.partsel = change.partsel;
    }
  }

  /** node.visit / tree.visit（ft-all.js:2497-2518；fromKey 缺省从根）。 */
  visit(
    // biome-ignore lint/suspicious/noConfusingVoidType: visit 回调允许无返回（隐式 void = 继续遍历），与 fancytree 的 fn 约定一致
    fn: (node: VisitContext) => boolean | "skip" | void,
    options?: { includeSelf?: boolean; fromKey?: string | number },
  ): boolean | "skip" {
    const start = options?.fromKey === undefined ? undefined : this.mustGet(options.fromKey);
    const includeSelf = options?.includeSelf === true;
    const visitOne = (node: NodeState, self: boolean): boolean | "skip" => {
      if (self) {
        const res = fn(node);
        if (res === false || res === "skip") {
          return res;
        }
      }
      for (const child of node.children) {
        const res = visitOne(child, true);
        if (res === false) {
          return false;
        }
      }
      return true;
    };
    if (start !== undefined) {
      return visitOne(start, includeSelf);
    }
    for (const root of this.roots) {
      const res = visitOne(root, true);
      if (res === false) {
        return false;
      }
    }
    return true;
  }

  /** node/tree.getSelectedNodes（ft-all.js:1397-1410、3477-3479）。 */
  getSelectedNodes(stopOnParents?: boolean): VisitContext[] {
    const list: VisitContext[] = [];
    this.visit((node) => {
      if (node.selected) {
        list.push({ key: node.key, folder: node.folder, selected: true, partsel: node.partsel });
        if (stopOnParents === true) {
          return "skip";
        }
      }
      return undefined;
    });
    return list;
  }

  /** 整树状态导出（backend 对 UI 发快照/应用 ops 后对账用）。 */
  exportStates(): NodeStateChange[] {
    const list: NodeStateChange[] = [];
    this.visit((node) => {
      const state = this.byKey.get(node.key);
      if (state !== undefined) {
        list.push({ key: state.key, selected: state.selected, partsel: state.partsel });
      }
    });
    return list;
  }

  private mustGet(key: string | number): NodeState {
    const node = this.byKey.get(key);
    if (node === undefined) {
      throw new Error(`unknown tree node key: ${String(key)}`);
    }
    return node;
  }

  private visitState(node: NodeState, fn: (node: NodeState) => void): void {
    fn(node);
    for (const child of node.children) {
      this.visitState(child, fn);
    }
  }

  /** _changeSelectStatusAttrs（ft-all.js:991-1032；无 unselectableStatus 配置）。 */
  private changeSelectStatusAttrs(
    node: NodeState,
    state: boolean | undefined,
    tracker?: ChangeTracker,
  ): void {
    let selected: boolean;
    let partsel: boolean;
    if (state === false) {
      selected = false;
      partsel = false;
    } else if (state === true) {
      selected = true;
      partsel = true;
    } else {
      selected = false;
      partsel = true;
    }
    if (node.selected !== selected || node.partsel !== partsel) {
      node.selected = selected;
      node.partsel = partsel;
      tracker?.record(node);
    }
  }

  /**
   * fixSelection3FromEndNodes（ft-all.js:1061-1180）：先 _walk(node)（有子节点时
   * 以子状态聚合覆盖自身），再 visitParents 逐层聚合。无 lazy/radiogroup。
   */
  private fixFromEndNodes(node: NodeState, tracker?: ChangeTracker): void {
    const walk = (current: NodeState): boolean | undefined => {
      let state: boolean | undefined;
      if (current.children.length > 0) {
        let allSelected = true;
        let someSelected = false;
        let countable = 0;
        for (const child of current.children) {
          // unselectable 子节点不计入聚合（unselectableIgnore 语义）：
          // 屏蔽项既不阻碍父级全选 ✓，也不制造假半选。
          if (child.unselectable) {
            continue;
          }
          countable++;
          const s = walk(child);
          if (s !== false) {
            someSelected = true;
          }
          if (s !== true) {
            allSelected = false;
          }
        }
        // 无可计子节点（全被屏蔽）→ 维持自身状态，避免空目录被误判全选。
        state =
          countable === 0
            ? current.selected
            : allSelected
              ? true
              : someSelected
                ? undefined
                : false;
      } else {
        state = current.selected;
      }
      this.changeSelectStatusAttrs(current, state, tracker);
      return state;
    };
    walk(node);
    // visitParents（ft-all.js:1140-1179）：用 child.selected/child.partsel 聚合。
    let parent = node.parent;
    while (parent !== null) {
      let allSelected = true;
      let someSelected = false;
      let countable = 0;
      for (const child of parent.children) {
        if (child.unselectable) {
          continue; // unselectableIgnore 语义，同 _walk
        }
        countable++;
        const state = child.selected;
        if (state || child.partsel) {
          someSelected = true;
        }
        if (!state) {
          allSelected = false;
        }
      }
      if (countable > 0) {
        this.changeSelectStatusAttrs(
          parent,
          allSelected ? true : someSelected ? undefined : false,
          tracker,
        );
      }
      parent = parent.parent;
    }
  }
}

/** 按应用顺序记录 (selected,partsel) 变化的节点。 */
class ChangeTracker {
  readonly changes: NodeStateChange[] = [];
  private readonly seen = new Set<string | number>();

  record(node: NodeState): void {
    // 同一节点在一次级联中只会被 _changeSelectStatusAttrs 定稿一次
    // （子树一次 + _walk 一次取末态）；若重复则更新末态，保持顺序唯一。
    const existing = this.seen.has(node.key);
    const change: NodeStateChange = {
      key: node.key,
      selected: node.selected,
      partsel: node.partsel,
    };
    if (existing) {
      const index = this.changes.findIndex((c) => c.key === node.key);
      if (index >= 0) {
        this.changes[index] = change;
      }
      return;
    }
    this.seen.add(node.key);
    this.changes.push(change);
  }
}
