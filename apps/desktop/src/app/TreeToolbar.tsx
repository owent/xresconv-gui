import { Button, Input, SearchField } from "react-aria-components";
import type { TreeNodeKey } from "../adapters/backend";
import { collectFolderKeys } from "./ConversionTree";
import { Icon } from "./Icon";
import { useSessionStore } from "./session-store";

/**
 * 转换树工具栏：仅搜索（布局对照旧版——全选/全取消/展开/收起按钮在旧版位于
 * 右侧按钮组，已随 RunControls 归位；搜索为新增辅助操作，只过滤显示、
 * 保留祖先链、显示命中数，不改变真实选择）。
 */
export function TreeToolbar({ hitCount }: { hitCount: number | null }) {
  const searchTerm = useSessionStore((state) => state.searchTerm);
  const search = useSessionStore((state) => state.search);
  const snapshot = useSessionStore((state) => state.snapshot);
  const disabled = snapshot?.config == null;
  const store = useSessionStore.getState;

  return (
    <div role="toolbar" aria-label="转换树工具栏" className="tree-tools">
      <div className="tree-tools-heading">
        <h2 className="panel-title">转换列表</h2>
        <SearchField
          aria-label="搜索转换条目"
          className="tree-search"
          value={searchTerm}
          onChange={search}
        >
          <Icon name="search" />
          <Input placeholder="搜索转换条目…" />
        </SearchField>
      </div>
      {hitCount !== null ? (
        <span className="tree-search-count" role="status">
          匹配 {hitCount} 项
        </span>
      ) : null}
      <div className="tree-actions">
        <Button isDisabled={disabled} onPress={() => void store().selectAll()}>
          全部选中
        </Button>
        <Button isDisabled={disabled} onPress={() => void store().selectNone()}>
          全部取消
        </Button>
        <Button
          isDisabled={disabled}
          onPress={() => {
            const keys = new Set<TreeNodeKey>();
            collectFolderKeys(snapshot?.tree?.nodes ?? [], keys);
            store().setExpandedKeys(keys);
          }}
        >
          全部展开
        </Button>
        <Button isDisabled={disabled} onPress={() => store().setExpandedKeys(new Set())}>
          全部收起
        </Button>
      </div>
    </div>
  );
}
