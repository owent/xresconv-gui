import { useEffect, useMemo, useRef } from "react";
import type { Key } from "react-aria-components";
import {
  Button,
  Checkbox,
  Collection,
  ListLayout,
  Tree,
  TreeItem,
  TreeItemContent,
  Virtualizer,
} from "react-aria-components";
import type { TreeNodeKey, TreeNodeSnap } from "../adapters/backend";
import { HookControls } from "./HookControls";
import { useSessionStore } from "./session-store";
import { TreeToolbar } from "./TreeToolbar";

/**
 * 左侧转换树区域（F02 条目树、F03 三态勾选/级联/全选；P4-08 起虚拟化）。
 * React Aria Tree 渲染 store 中的后端树快照；勾选状态以后端为准
 * （isSelected/isIndeterminate 受控，onChange 只发 select_node op），
 * 不引入 Fancytree；React Aria 自带 selection 不等于 selectMode:3，
 * 故 selectionMode="none"，勾选语义全部走 backend ops（04-ui §树）。
 *
 * 虚拟化（P4-08，UI03）：官方模式 —— Virtualizer + ListLayout 包裹 Tree，
 * 节点经 items/childItems 动态集合提供（collapsed 子树不渲染）。10k/100k
 * 节点只渲染可见窗口；选择/三态权威在后端快照，与渲染窗口无关。
 *
 * 键盘：上下/左右/Home/End 由 React Aria 提供；Space 切换焦点节点勾选、
 * 双击切换为旧版行为；unselectable 节点可聚焦但不可勾选。
 * 注意：RAC filterDOMProps 只透传指针/鼠标事件（onFocus/onKeyDown 会被剥掉），
 * 焦点跟踪与 Space 处理挂在本组件自有 wrapper 上，经行元素 data-key 还原节点
 * 身份（RAC useSelectableItem 无条件渲染 data-key）。
 */

interface FilteredTree {
  nodes: TreeNodeSnap[];
  hits: number;
}

/** 搜索过滤：匹配 title（大小写不敏感子串），保留祖先链可见；不改真实选择。 */
export function filterTreeNodes(nodes: readonly TreeNodeSnap[], term: string): FilteredTree {
  if (term === "") {
    return { nodes: nodes as TreeNodeSnap[], hits: 0 };
  }
  let hits = 0;
  const walk = (list: readonly TreeNodeSnap[]): TreeNodeSnap[] => {
    const out: TreeNodeSnap[] = [];
    for (const node of list) {
      const children = walk(node.children);
      const matched = node.title.toLowerCase().includes(term);
      if (matched || children.length > 0) {
        if (matched) {
          hits++;
        }
        out.push(
          children.length === node.children.length &&
            children.every((child, index) => child === node.children[index])
            ? node
            : { ...node, children },
        );
      }
    }
    return out;
  };
  return { nodes: walk(nodes), hits };
}

/** 收集全部 folder key（RunControls 全部展开用；搜索态强展亦用）。 */
export function collectFolderKeys(nodes: readonly TreeNodeSnap[], out: Set<TreeNodeKey>): void {
  for (const node of nodes) {
    if (node.children.length > 0) {
      out.add(node.key);
      collectFolderKeys(node.children, out);
    }
  }
}

/** 虚拟行高估计（ListLayout rowHeight；单行文本行）。 */
const TREE_ROW_HEIGHT = 26;

/** 单个树行（动态集合 render item）：子级经嵌套 Collection 延迟提供。 */
function TreeNodeRow({ node }: { node: TreeNodeSnap }) {
  const store = useSessionStore.getState;
  return (
    <TreeItem
      id={node.key}
      textValue={node.title}
      hasChildItems={node.children.length > 0}
      className="tree-node"
      onDoubleClick={(event) => {
        // 双击切换（旧版行为）；落在复选框/展开按钮上的双击由各自控件处理。
        if ((event.target as HTMLElement).closest("input, button") === null) {
          void store().toggleNode(node.key);
        }
      }}
    >
      <TreeItemContent>
        {({ isExpanded }) => (
          <span className="tree-node-row">
            {node.children.length > 0 ? (
              <Button slot="chevron" className="tree-chevron">
                {isExpanded ? "▾" : "▸"}
              </Button>
            ) : (
              <span className="tree-chevron-spacer" aria-hidden="true" />
            )}
            <Checkbox
              className="tree-checkbox"
              aria-label={
                node.unselectable ? `选择 ${node.title}（不可勾选）` : `选择 ${node.title}`
              }
              isSelected={node.selected}
              isIndeterminate={node.partsel}
              isDisabled={node.unselectable}
              onChange={() => void store().toggleNode(node.key)}
            />
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: 键盘切换由行级 Space 处理（scope keydown） */}
            {/* biome-ignore lint/a11y/useSemanticElements: RAC TreeItem 内不嵌套 button（破坏树角色），标题 role=button 标记位 */}
            <span
              className="tree-node-title"
              title={node.tooltip}
              role="button"
              tabIndex={-1}
              onClick={() => {
                // 旧版点行即切换（fancytree checkbox 模式）；标题点击=切换勾选。
                // role=button 仅为可访问性标记（键盘切换由行级 Space 处理，
                // tabIndex=-1 不进 Tab 序）。
                if (!node.unselectable) {
                  void store().toggleNode(node.key);
                }
              }}
            >
              {node.title}
            </span>
            {node.unselectable ? <span className="tree-node-hint">不可勾选</span> : null}
          </span>
        )}
      </TreeItemContent>
      {node.children.length > 0 && (
        <Collection items={node.children}>{(child) => <TreeNodeRow node={child} />}</Collection>
      )}
    </TreeItem>
  );
}

export function ConversionTree() {
  const tree = useSessionStore((state) => state.snapshot?.tree ?? null);
  const lastError = useSessionStore((state) => state.lastError);
  const searchTerm = useSessionStore((state) => state.searchTerm);
  const expandedKeys = useSessionStore((state) => state.expandedKeys);

  const term = searchTerm.trim().toLowerCase();
  const searching = term !== "";
  const filtered = useMemo(
    () => (tree == null ? null : filterTreeNodes(tree.nodes, term)),
    [tree, term],
  );

  /** data-key（DOM 字符串）→ 节点原始 key（item 为 number，category 为 "cat:*"）。 */
  const keyByDataKey = useMemo(() => {
    const map = new Map<string, TreeNodeKey>();
    const walk = (list: readonly TreeNodeSnap[]) => {
      for (const node of list) {
        map.set(String(node.key), node.key);
        walk(node.children);
      }
    };
    walk(tree?.nodes ?? []);
    return map;
  }, [tree]);

  const keyFromTarget = (target: EventTarget | null): TreeNodeKey | null => {
    if (!(target instanceof HTMLElement)) {
      return null;
    }
    const dataKey = target.closest('[role="row"]')?.getAttribute("data-key");
    return dataKey != null ? (keyByDataKey.get(dataKey) ?? null) : null;
  };

  // 焦点跟踪与 Space 切换：RAC filterDOMProps 不透传 onFocus/onKeyDown，
  // 故在 wrapper 上挂原生监听（focusin 捕获焦点落行；keydown 拦 Space）。
  const scopeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scope = scopeRef.current;
    if (scope === null) {
      return;
    }
    const onFocusIn = (event: Event) => {
      const key = keyFromTarget(event.target);
      if (key !== null) {
        useSessionStore.getState().setFocusedKey(key);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // Space 切换焦点节点勾选（旧版语义）；焦点在复选框/按钮上时由控件原生处理。
      if (event.key !== " ") {
        return;
      }
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.getAttribute("role") !== "row") {
        return;
      }
      event.preventDefault();
      const key = keyFromTarget(target);
      if (key !== null) {
        void useSessionStore.getState().toggleNode(key);
      }
    };
    scope.addEventListener("focusin", onFocusIn);
    scope.addEventListener("keydown", onKeyDown);
    return () => {
      scope.removeEventListener("focusin", onFocusIn);
      scope.removeEventListener("keydown", onKeyDown);
    };
  });

  let effectiveExpanded: Iterable<Key> = expandedKeys;
  if (searching && filtered !== null) {
    const folders = new Set<TreeNodeKey>();
    collectFolderKeys(filtered.nodes, folders);
    effectiveExpanded = folders;
  }

  return (
    <aside className="panel conversion-tree" aria-label="转换列表">
      <h2 className="panel-title">转换列表</h2>
      <TreeToolbar hitCount={searching && filtered !== null ? filtered.hits : null} />
      {lastError !== null ? (
        <p role="alert" className="tree-error">
          {lastError}
        </p>
      ) : null}
      {filtered === null ? (
        <>
          <div role="tree" aria-label="转换条目" aria-busy="true" className="tree-placeholder" />
          <p className="empty-state">尚未加载配置；加载后在此显示分类与转换条目树。</p>
        </>
      ) : (
        <div ref={scopeRef} className="tree-keyboard-scope">
          <Virtualizer
            layout={ListLayout}
            layoutOptions={{ rowHeight: TREE_ROW_HEIGHT }}
            shouldObserveItemSize
          >
            <Tree
              aria-label="转换条目"
              className="conversion-tree-view"
              selectionMode="none"
              items={filtered.nodes}
              expandedKeys={effectiveExpanded}
              onExpandedChange={(keys) => {
                if (!searching) {
                  useSessionStore.getState().setExpandedKeys(keys);
                }
              }}
            >
              {(node) => <TreeNodeRow key={String(node.key)} node={node} />}
            </Tree>
          </Virtualizer>
        </div>
      )}
      {/* 树 footer：转换事件开关（布局对照旧版 conv_list_event_group_wrapper；
          无 hook 时不渲染，不占位）。 */}
      <HookControls />
    </aside>
  );
}
