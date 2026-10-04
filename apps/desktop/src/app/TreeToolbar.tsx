import { Button, Input, SearchField } from "react-aria-components";
import type { TreeNodeKey } from "../adapters/backend";
import { translate as t, useI18n } from "../i18n";
import { collectFolderKeys } from "./ConversionTree";
import { Icon } from "./Icon";
import { useSessionStore } from "./session-store";

/**
 * 转换树工具栏：搜索过滤显示，保留祖先链并显示命中数。
 * 全选、全取消、展开和收起按钮位于右侧；搜索不改变转换选择。
 */
export function TreeToolbar({ hitCount }: { hitCount: number | null }) {
  useI18n();
  const searchTerm = useSessionStore((state) => state.searchTerm);
  const search = useSessionStore((state) => state.search);
  const snapshot = useSessionStore((state) => state.snapshot);
  const disabled = snapshot?.config == null;
  const store = useSessionStore.getState;

  return (
    <div role="toolbar" aria-label={t("tree.toolbar")} className="tree-tools">
      <div className="tree-tools-heading">
        <h2 className="panel-title">{t("tree.title")}</h2>
        <SearchField
          aria-label={t("tree.search")}
          className="tree-search"
          value={searchTerm}
          onChange={search}
        >
          <Icon name="search" />
          <Input placeholder={t("tree.searchPlaceholder")} />
        </SearchField>
      </div>
      {hitCount !== null ? (
        <span className="tree-search-count" role="status">
          {t("tree.matches", { count: hitCount })}
        </span>
      ) : null}
      <div className="tree-actions">
        <Button isDisabled={disabled} onPress={() => void store().selectAll()}>
          {t("tree.selectAll")}
        </Button>
        <Button isDisabled={disabled} onPress={() => void store().selectNone()}>
          {t("tree.selectNone")}
        </Button>
        <Button
          isDisabled={disabled}
          onPress={() => {
            const keys = new Set<TreeNodeKey>();
            collectFolderKeys(snapshot?.tree?.nodes ?? [], keys);
            store().setExpandedKeys(keys);
          }}
        >
          {t("tree.expandAll")}
        </Button>
        <Button isDisabled={disabled} onPress={() => store().setExpandedKeys(new Set())}>
          {t("tree.collapseAll")}
        </Button>
      </div>
    </div>
  );
}
