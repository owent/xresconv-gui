import { useEffect, useMemo, useRef, useState } from "react";
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
import { translate as t, useI18n } from "../i18n";
import { HookControls } from "./HookControls";
import { useSessionStore } from "./session-store";
import { TreeToolbar } from "./TreeToolbar";

/**
 * 左侧转换树：虚拟化条目和三态级联勾选。
 * React Aria Tree 渲染 store 中的后端树快照；勾选状态以后端为准
 * （isSelected/isIndeterminate 受控，onChange 只发 select_node op），
 * React Aria selection 与转换选择独立，selectionMode="none"，勾选走 backend ops。
 *
 * 虚拟化：官方模式 —— Virtualizer + ListLayout 包裹 Tree，
 * 节点经 items/childItems 动态集合提供（collapsed 子树不渲染）。10k/100k
 * 节点只渲染可见窗口；选择/三态权威在后端快照，与渲染窗口无关。
 *
 * 键盘：上下/左右/Home/End 由 React Aria 提供；Space 切换焦点节点勾选、
 * 双击切换为行为；unselectable 节点可聚焦但不可勾选。
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

/** 每层级进缩进（px）；虚拟化树 DOM 是平铺行（实测无嵌套），层级只能渲染时传入。 */
const TREE_LEVEL_INDENT_PX = 18;

/** 单个树行（动态集合 render item）：子级经嵌套 Collection 延迟提供。 */
function TreeNodeRow({ node, level }: { node: TreeNodeSnap; level: number }) {
  useI18n();
  const store = useSessionStore.getState;
  return (
    <TreeItem
      id={node.key}
      textValue={node.title}
      hasChildItems={node.children.length > 0}
      className={node.children.length > 0 ? "tree-node tree-node--folder" : "tree-node"}
      style={{ paddingLeft: `calc(var(--space-1) + ${String(level * TREE_LEVEL_INDENT_PX)}px)` }}
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
            {/*
             *  fancytree 三态语义：全选目录 partsel 也为 true（“有牵连”）——
             *                 半选（mixed）仅当 partsel 且未全选；全选目录与条目一律 ✓。
             */}
            <Checkbox
              className="tree-checkbox"
              aria-label={
                node.unselectable
                  ? t("tree.selectDisabled", { title: node.title })
                  : t("tree.select", { title: node.title })
              }
              isSelected={node.selected}
              isIndeterminate={node.partsel && !node.selected}
              isDisabled={node.unselectable}
              onChange={() => void store().toggleNode(node.key)}
            >
              {/*
               *  可见方框（RAC 把原生 input 藏进 VisuallyHidden；自定义 className
               *                   还会替换默认 react-aria-Checkbox 类——方框必须是真实子元素，
               *                   否则 label 零尺寸不可点击）。
               */}
              <span className="checkbox-mark" aria-hidden="true" />
            </Checkbox>
            <span className="tree-node-title" title={node.tooltip}>
              {node.title}
            </span>
            {node.unselectable ? (
              <span className="tree-node-hint">{t("tree.unselectable")}</span>
            ) : null}
          </span>
        )}
      </TreeItemContent>
      {node.children.length > 0 && (
        <Collection items={node.children}>
          {(child) => <TreeNodeRow node={child} level={level + 1} />}
        </Collection>
      )}
    </TreeItem>
  );
}

export function ConversionTree() {
  useI18n();
  const [rowHeight, setRowHeight] = useState(TREE_ROW_HEIGHT);
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
  const hasTree = tree !== null;
  useEffect(() => {
    if (!hasTree) return;
    const scope = scopeRef.current;
    if (scope === null) return;
    const measure = () => {
      const size = Number.parseFloat(getComputedStyle(scope).fontSize);
      setRowHeight(
        Number.isFinite(size) ? Math.max(TREE_ROW_HEIGHT, Math.ceil(size * 2.2)) : TREE_ROW_HEIGHT,
      );
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, [hasTree]);
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
      // Space 切换焦点节点勾选（语义）；焦点在复选框/按钮上时由控件原生处理。
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
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      // A double click is one selection gesture. Controls handle their own clicks.
      if (
        !(target instanceof HTMLElement) ||
        event.detail > 1 ||
        target.closest("label, input, button")
      )
        return;
      const key = keyFromTarget(target);
      if (key !== null) {
        useSessionStore.getState().setFocusedKey(key);
        void useSessionStore.getState().toggleNode(key);
      }
    };
    scope.addEventListener("focusin", onFocusIn);
    scope.addEventListener("keydown", onKeyDown);
    scope.addEventListener("click", onClick);
    return () => {
      scope.removeEventListener("focusin", onFocusIn);
      scope.removeEventListener("keydown", onKeyDown);
      scope.removeEventListener("click", onClick);
    };
  });

  let effectiveExpanded: Iterable<Key> = expandedKeys;
  if (searching && filtered !== null) {
    const folders = new Set<TreeNodeKey>();
    collectFolderKeys(filtered.nodes, folders);
    effectiveExpanded = folders;
  }

  return (
    <aside className="panel conversion-tree" aria-label={t("tree.title")}>
      <TreeToolbar hitCount={searching && filtered !== null ? filtered.hits : null} />
      {lastError !== null ? (
        <p role="alert" className="tree-error">
          {lastError}
        </p>
      ) : null}
      {filtered === null ? (
        <>
          <div
            role="tree"
            aria-label={t("tree.items")}
            aria-busy="true"
            className="tree-placeholder"
          />
          <p className="empty-state">{t("tree.empty")}</p>
        </>
      ) : (
        <div ref={scopeRef} className="tree-keyboard-scope">
          <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight }} shouldObserveItemSize>
            <Tree
              aria-label={t("tree.items")}
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
              {(node) => <TreeNodeRow key={String(node.key)} node={node} level={0} />}
            </Tree>
          </Virtualizer>
        </div>
      )}
      {/*
       *  树 footer：转换事件开关（布局对照 conv_list_event_group_wrapper；
       *           无 hook 时不渲染，不占位）。
       */}
      <HookControls />
    </aside>
  );
}
