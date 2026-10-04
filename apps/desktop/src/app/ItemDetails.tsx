import { Input, Label, TextField } from "react-aria-components";
import type { TreeNodeKey, TreeNodeSnap } from "../adapters/backend";
import { translate as t, useI18n } from "../i18n";
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
 * 条目详情：当前聚焦节点的名称/描述/来源/scheme/tag/class 只读视图
 * 数据来源为 store 的 focusedKey 和树快照；聚焦变化不改变转换选择。
 */
export function ItemDetails() {
  useI18n();
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
    { id: "name", label: t("item.name") },
    { id: "desc", label: t("item.description") },
    { id: "source", label: t("item.source") },
    { id: "scheme", label: "scheme" },
    { id: "tags", label: "tag" },
    { id: "classes", label: "class" },
  ] as const;

  return (
    <details className="panel item-details collapsible" aria-label={t("item.title")}>
      <summary className="panel-title collapsible-summary">{t("item.title")}</summary>
      {node === null ? (
        <p className="empty-state">{t("item.empty")}</p>
      ) : (
        <p className="empty-state">
          {node.folder ? t("item.category") : t("item.entry")}
          {node.unselectable ? ` · ${t("tree.unselectable")}` : ""}
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
    </details>
  );
}
