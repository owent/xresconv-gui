import { Input, Label, TextField } from "react-aria-components";
import type { TreeNodeKey, TreeNodeSnap } from "../adapters/backend";
import { useSessionStore } from "./session-store";

function findNode(nodes: readonly TreeNodeSnap[], key: TreeNodeKey): TreeNodeSnap | null {
  for (const node of nodes) {
    if (node.key === key) {
      return node;
    }
    const found = findNode(node.children, key);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function asList(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(", ") : "";
}

/**
 * 条目详情（F02）：当前聚焦节点的名称/描述/来源/scheme/tag/class 只读视图
 * （编辑属 P4-04）。数据来源为 store 的 focusedKey + 树快照；
 * 聚焦变化绝不改变转换选择（04-ui §页面和组件边界验收原文）。
 */
export function ItemDetails() {
  const focusedKey = useSessionStore((state) => state.focusedKey);
  const nodes = useSessionStore((state) => state.snapshot?.tree?.nodes ?? null);

  const node = focusedKey !== null && nodes !== null ? findNode(nodes, focusedKey) : null;
  const item = node?.item;

  const values: Record<string, string> = {
    name: node?.title ?? "",
    desc: node?.tooltip ?? "",
    source: typeof item?.file === "string" ? item.file : "",
    scheme: typeof item?.scheme === "string" ? item.scheme : "",
    tags: asList(item?.tags),
    classes: asList(item?.classes),
  };

  const fields = [
    { id: "name", label: "名称" },
    { id: "desc", label: "描述" },
    { id: "source", label: "来源（file / sheet）" },
    { id: "scheme", label: "scheme" },
    { id: "tags", label: "tag" },
    { id: "classes", label: "class" },
  ] as const;

  return (
    <section className="panel item-details" aria-label="条目详情">
      <h2 className="panel-title">条目详情</h2>
      {node === null ? (
        <p className="empty-state">在左侧树中聚焦条目后显示详情。</p>
      ) : (
        <p className="empty-state">
          {node.folder ? "分类" : "条目"}
          {node.unselectable ? " · 不可勾选" : ""}
        </p>
      )}
      <div className="form-grid">
        {fields.map((field) => (
          <TextField key={field.id} isReadOnly value={values[field.id]}>
            <Label>{field.label}</Label>
            <Input placeholder="—" />
          </TextField>
        ))}
      </div>
    </section>
  );
}
