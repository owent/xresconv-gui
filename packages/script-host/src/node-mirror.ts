/**
 * NodeMirror（P2-05）：worker 内的 Fancytree 兼容镜像。
 *
 * 合同来源：tests/fixtures/scripts/contract.md §6、docs/plan/records/P0-08.md §8、
 * README 脚本小节。语义核心（三态级联）来自 @xresconv/compat-service 的
 * SelectionTree（与 backend 共享同一实现，禁止分叉）。
 *
 * 支持面（P0-08 §8 证据清单 + 只读导航扩展）：key/title/tooltip/data.item/
 * data.option.auto_select/unselectable(读)、isFolder/isSelected/isPartsel/
 * isExpanded/isRootNode、setSelected/toggleSelected/setExpanded、visit/
 * getSelectedNodes/getTree/getRootNode/getParent/getChildren、render
 * （no-op，见 BD-S15）、toString。其余 Fancytree 成员：调用时抛出带迁移指引
 * 的诊断错误并记录 diagnostic op（D3 排除接口）；DOM/jQuery 属性
 * （li/span/$span/...）读取返回 undefined 并记诊断。
 *
 * 别名恒等（旧版同引用语义，P0-08 §8）：
 *   item.ft_node === node；node.data.item === item；node.key === item.id；
 *   selected_items[k] 与树内 item 是同一对象。folder 节点无 data 字段
 *   （main.js:1447-1454 未设置）。
 *
 * 状态变更语义：方法调用在本地镜像同步生效（read-your-writes），同时按调用
 * 顺序追加 ops；item 字段与 data.option.auto_select 的修改在调用结束时做
 * diff 追加（与节点 ops 操作不同状态切片，可交换，不破坏因果序）。ops 携带
 * 快照版本 `v`，backend 只在版本匹配时应用（失配整批拒绝并记诊断）。
 *
 * readonly 模式（on_append_log，BD-S16）：读取/导航可用，修改方法调用记
 * D3_READ_ONLY 诊断并 no-op，避免逐日志行的 ops 风暴。
 */

import { SelectionTree, type TreeNodeSnapshot, type TreeSnapshot } from "@xresconv/compat-service";
import { deepEqual, diffFields, safeClone } from "./diff.ts";

/** 参与 diff 时排除的键：ft_node 是别名、id 是身份（P0-08 §8）。 */
const ITEM_DIFF_SKIP_KEYS: ReadonlySet<string> = new Set(["ft_node", "id"]);

/**
 * 已知但被 D3 排除的 Fancytree 方法：调用时抛诊断错误。
 * 划分依据：P0-08 §8 证据清单之外、且不属于只读导航的成员。
 */
const EXCLUDED_METHODS: ReadonlySet<string> = new Set([
  "activate",
  "addChildren",
  "addNode",
  "addNodeCached",
  "applyPatch",
  "clearStatus",
  "collapseSiblings",
  "copyTo",
  "debug",
  "discardMarkup",
  "error",
  "findAll",
  "findFirst",
  "fromDict",
  "getKeyPath",
  "info",
  "load",
  "log",
  "makeVisible",
  "markDirty",
  "moveTo",
  "navigate",
  "remove",
  "removeChild",
  "removeChildren",
  "renderTitle",
  "renderStatus",
  "resetLazy",
  "scheduleRefresh",
  "scrollIntoView",
  "setActive",
  "setFocus",
  "setStatus",
  "setTitle",
  "sortChildren",
  "toDict",
  "toggleExpanded",
  "trigger",
  "triggerModify",
  "triggerModifyChild",
  "visitAndLoad",
  "visitParents",
  "visitRows",
  "warn",
]);

/** 已知但依赖 DOM/jQuery 的属性：读取返回 undefined 并记诊断。 */
const EXCLUDED_PROPS: ReadonlySet<string> = new Set([
  "$li",
  "$span",
  "li",
  "span",
  "tr",
  "ul",
  "jQuery",
  "$",
]);

/** 直接写节点核心字段（绕过 item 数据）记一次诊断并忽略。 */
const CORE_WRITE_PROPS: ReadonlySet<string> = new Set([
  "key",
  "title",
  "tooltip",
  "folder",
  "unselectable",
  "selected",
  "partsel",
  "expanded",
  "data",
]);

export interface MirrorOptions {
  /** on_append_log 传入 true：只读镜像（BD-S16）。 */
  readonly?: boolean;
}

interface MirrorNodeState {
  readonly key: string | number;
  readonly title: string;
  readonly tooltip: string;
  readonly folder: boolean;
  unselectable: boolean;
  parent: MirrorNodeState | null;
  readonly children: MirrorNodeState[];
  /** 仅 item 节点存在（main.js:1761-1770 的 data.item）。 */
  readonly item?: Record<string, unknown>;
  /** 仅 item 节点存在（main.js:1766-1769 的 data.option）。 */
  readonly option?: { auto_select: boolean };
}

export interface MirrorHandle {
  /** selected_nodes（DFS 序，含 folder 节点，main.js:1952/511）。 */
  readonly selectedNodes: unknown[];
  /** selected_items（DFS 序的 item 对象，main.js:2003-2008）。 */
  readonly selectedItems: Record<string, unknown>[];
  /** 快照版本（context.tree.version）。 */
  readonly version: number;
  /** 收集全部 ops：实时节点 ops/诊断（调用序）+ 退出期 item/option diff。 */
  collectOps(): Record<string, unknown>[];
}

export function buildMirror(snapshot: TreeSnapshot, options?: MirrorOptions): MirrorHandle {
  return new MirrorBuilder(snapshot, options?.readonly === true).handle;
}

class MirrorBuilder {
  readonly handle: MirrorHandle;
  private readonly tree: SelectionTree;
  private readonly version: number;
  private readonly readonly: boolean;
  private readonly liveOps: Record<string, unknown>[] = [];
  private readonly diagnosed = new Set<string>();
  private readonly items: {
    id: unknown;
    original: Record<string, unknown>;
    live: Record<string, unknown>;
  }[] = [];
  private readonly optionStates: {
    key: string | number;
    original: { auto_select: boolean };
    live: { auto_select: boolean };
  }[] = [];
  private readonly nodeStates = new Map<string | number, MirrorNodeState>();
  private readonly proxies = new Map<MirrorNodeState, unknown>();
  private readonly rootState: MirrorNodeState;
  private readonly rootProxy: unknown;
  private readonly treeProxy: unknown;

  constructor(snapshot: TreeSnapshot, readonlyMode: boolean) {
    this.version = snapshot.version;
    this.readonly = readonlyMode;
    this.tree = new SelectionTree(snapshot.nodes);

    const buildState = (
      snap: TreeNodeSnapshot,
      parent: MirrorNodeState | null,
    ): MirrorNodeState => {
      let liveItem: Record<string, unknown> | undefined;
      let option: { auto_select: boolean } | undefined;
      if (snap.item !== undefined) {
        // 快照 item 克隆为活对象；ft_node 别名在建 Proxy 时回填。
        liveItem = safeClone(snap.item) as Record<string, unknown>;
        this.items.push({ id: snap.item.id, original: snap.item, live: liveItem });
        option = { auto_select: snap.autoSelect };
        this.optionStates.push({
          key: snap.key,
          original: { auto_select: snap.autoSelect },
          live: option,
        });
      }
      const state: MirrorNodeState = {
        key: snap.key,
        title: snap.title,
        tooltip: snap.tooltip,
        folder: snap.folder,
        unselectable: snap.unselectable,
        parent,
        children: snap.children.map((child) => buildState(child, null)),
        item: liveItem,
        option,
      };
      for (const child of state.children) {
        child.parent = state;
      }
      this.nodeStates.set(state.key, state);
      return state;
    };
    // 根节点镜像（fancytree rootNode：title "root"、key "root_<id>"、expanded，
    // ft-all.js:2718-2723）；旧版 key 含自增树 id 本就不稳定，固定为 "root_1"。
    this.rootState = {
      key: "root_1",
      title: "root",
      tooltip: "",
      folder: true,
      unselectable: true,
      parent: null,
      children: snapshot.nodes.map((snap) => buildState(snap, null)),
    };
    for (const child of this.rootState.children) {
      child.parent = this.rootState;
    }
    this.rootProxy = this.wrapNode(this.rootState);
    this.treeProxy = this.makeTree();

    const selectedKeys = new Set(this.tree.getSelectedNodes().map((n) => n.key));
    const selectedNodes: unknown[] = [];
    const selectedItems: Record<string, unknown>[] = [];
    this.visitStateChildren(this.rootState, (state) => {
      if (selectedKeys.has(state.key)) {
        selectedNodes.push(this.wrapNode(state));
        if (state.item !== undefined) {
          selectedItems.push(state.item);
        }
      }
    });

    this.handle = {
      selectedNodes,
      selectedItems,
      version: this.version,
      collectOps: () => this.collectOps(),
    };
  }

  private pushOp(op: Record<string, unknown>): void {
    this.liveOps.push({ v: this.version, ...op });
  }

  private diagnose(code: string, message: string): void {
    const dedupeKey = `${code}:${message}`;
    if (this.diagnosed.has(dedupeKey)) {
      return;
    }
    this.diagnosed.add(dedupeKey);
    this.pushOp({ op: "diagnostic", code, message });
  }

  private requireWritable(feature: string): boolean {
    if (!this.readonly) {
      return true;
    }
    this.diagnose(
      "D3_READ_ONLY",
      `${feature} 在 on_append_log 上下文中不可用：日志 hook 的树镜像是只读的（BD-S16）`,
    );
    return false;
  }

  /** DFS 访问子树（不含 start 自身），仅内部使用。 */
  private visitStateChildren(start: MirrorNodeState, fn: (state: MirrorNodeState) => void): void {
    const walk = (state: MirrorNodeState): void => {
      fn(state);
      state.children.forEach(walk);
    };
    start.children.forEach(walk);
  }

  private wrapNode(state: MirrorNodeState): unknown {
    const cached = this.proxies.get(state);
    if (cached !== undefined) {
      return cached;
    }
    const self = this;
    const target: Record<string, unknown> = {
      // 数据属性（fancytree 同名）；folder 节点无 data（main.js:1447-1454）。
      key: state.key,
      title: state.title,
      tooltip: state.tooltip,
      folder: state.folder,
      unselectable: state.unselectable,
      isFolder: () => state.folder,
      isSelected: () => self.tree.getNode(state.key)?.selected ?? false,
      isPartsel: () => {
        const n = self.tree.getNode(state.key);
        return n !== undefined && !n.selected && n.partsel;
      },
      isExpanded: () => self.tree.getNode(state.key)?.expanded ?? false,
      isRootNode: () => state.parent === null,
      getParent: () => (state.parent === null ? null : self.wrapNode(state.parent)),
      getChildren: () =>
        state.children.length === 0 ? null : state.children.map((c) => self.wrapNode(c)),
      setSelected: (flag?: boolean) => {
        if (state.parent === null) {
          return undefined; // 根节点不在 SelectionTree 内（旧版只静默置位不可见标志）
        }
        if (!self.requireWritable("setSelected")) {
          return undefined;
        }
        const changes = self.tree.applySetSelected(state.key, flag);
        if (changes.length > 0) {
          self.pushOp({ op: "set_node_states", changes });
        }
        return undefined;
      },
      toggleSelected: () => {
        if (state.parent === null) {
          return undefined;
        }
        if (!self.requireWritable("toggleSelected")) {
          return undefined;
        }
        const changes = self.tree.applyToggleSelected(state.key);
        if (changes.length > 0) {
          self.pushOp({ op: "set_node_states", changes });
        }
        return undefined;
      },
      setExpanded: (flag?: boolean) => {
        if (state.parent === null) {
          return undefined;
        }
        if (!self.requireWritable("setExpanded")) {
          return undefined;
        }
        if (self.tree.applySetExpanded(state.key, flag)) {
          self.pushOp({ op: "set_node_expanded", key: state.key, expanded: flag !== false });
        }
        return undefined;
      },
      visit: (fn: (node: unknown) => unknown, includeSelf?: boolean) => {
        // ft-all.js:2497-2518：false 全停、"skip" 跳过该节点子树（兄弟继续）。
        const visitOne = (s: MirrorNodeState): boolean | "skip" => {
          const res = fn(self.wrapNode(s));
          if (res === false || res === "skip") {
            return res;
          }
          for (const child of s.children) {
            if (visitOne(child) === false) {
              return false;
            }
          }
          return true;
        };
        if (includeSelf === true) {
          const res = fn(self.wrapNode(state));
          if (res === false || res === "skip") {
            return res;
          }
        }
        for (const child of state.children) {
          if (visitOne(child) === false) {
            return false;
          }
        }
        return true;
      },
      getSelectedNodes: (stopOnParents?: boolean) => {
        // ft-all.js:1397-1410：this.visit(fn) 不含自身；stopOnParents 命中后 skip。
        const selected = new Set(self.tree.getSelectedNodes().map((n) => n.key));
        const out: unknown[] = [];
        const walk = (s: MirrorNodeState): void => {
          if (selected.has(s.key)) {
            out.push(self.wrapNode(s));
            if (stopOnParents === true) {
              return;
            }
          }
          s.children.forEach(walk);
        };
        state.children.forEach(walk);
        return out;
      },
      getTree: () => self.treeProxy,
      getRootNode: () => self.rootProxy,
      // render：旧版触发 DOM 重绘（main.js:1058-1100）；新版 UI 由状态驱动自动
      // 重渲染，render 为语义等价的 no-op（BD-S15）。
      render: () => undefined,
      toString: () => `FancytreeNode@${String(state.key)}[title='${state.title}']`,
      toJSON: () => ({
        key: state.key,
        title: state.title,
        folder: state.folder,
        selected: self.tree.getNode(state.key)?.selected ?? false,
        partsel: self.tree.getNode(state.key)?.partsel ?? false,
        expanded: self.tree.getNode(state.key)?.expanded ?? false,
        unselectable: state.unselectable,
      }),
    };
    // data 仅 item 节点（旧版 folder 无 data 字段）。
    if (state.item !== undefined) {
      target.data = { item: state.item, option: state.option };
    }
    const proxy = new Proxy(target, {
      get(obj, prop) {
        if (typeof prop !== "string") {
          return Reflect.get(obj, prop);
        }
        if (prop in obj) {
          return Reflect.get(obj, prop);
        }
        if (EXCLUDED_METHODS.has(prop)) {
          return () => {
            self.diagnose(
              "D3_EXCLUDED",
              `ft_node.${prop}() 不在脚本兼容范围（D3）：属于未公开的 Fancytree 内部/DOM 接口，` +
                "请改用 README 记录的脚本接口（详见 tests/fixtures/scripts/contract.md）",
            );
            throw new Error(`ft_node.${prop} is not part of the supported script interface (D3)`);
          };
        }
        if (EXCLUDED_PROPS.has(prop)) {
          self.diagnose(
            "D3_EXCLUDED",
            `ft_node.${prop} 是 DOM/jQuery 属性，不在脚本兼容范围（D3），读取为 undefined`,
          );
          return undefined;
        }
        return undefined;
      },
      set(obj, prop, value) {
        if (typeof prop === "string" && CORE_WRITE_PROPS.has(prop)) {
          self.diagnose(
            "D3_DIRECT_NODE_WRITE",
            `直接写 ft_node.${prop} 不生效：请改 node.data.item 字段或调用节点方法（P2-05）`,
          );
          return true;
        }
        return Reflect.set(obj, prop, value);
      },
      has(obj, prop) {
        return Reflect.has(obj, prop);
      },
    });
    // 别名恒等：item.ft_node === 节点 Proxy（P0-08 §8），同一节点 Proxy 唯一。
    if (state.item !== undefined) {
      state.item.ft_node = proxy;
    }
    this.proxies.set(state, proxy);
    return proxy;
  }

  private makeTree(): unknown {
    return {
      // ft-all.js:3477-3479：tree.getSelectedNodes = rootNode.getSelectedNodes。
      getSelectedNodes: (stopOnParents?: boolean) =>
        (this.rootProxy as { getSelectedNodes: (s?: boolean) => unknown[] }).getSelectedNodes(
          stopOnParents,
        ),
      getRootNode: () => this.rootProxy,
      visit: (fn: (node: unknown) => unknown) =>
        (
          this.rootProxy as {
            visit: (f: (node: unknown) => unknown, includeSelf?: boolean) => unknown;
          }
        ).visit(fn, false),
    };
  }

  private collectOps(): Record<string, unknown>[] {
    const ops = [...this.liveOps];
    // item 字段 diff（ft_node/id 除外）；含脚本新增自定义字段。
    for (const { id, original, live } of this.items) {
      const fields = diffFields(original, live, ITEM_DIFF_SKIP_KEYS);
      if (Object.keys(fields).length > 0) {
        ops.push({
          v: this.version,
          op: "set_fields",
          target: "item_data",
          item_id: id,
          fields,
        });
      }
    }
    // node.data.option.auto_select diff（仅 item 节点有 option）。
    for (const { key, original, live } of this.optionStates) {
      if (!deepEqual(original, live)) {
        ops.push({
          v: this.version,
          op: "set_node_option",
          key,
          fields: { auto_select: live.auto_select },
        });
      }
    }
    return ops;
  }
}
