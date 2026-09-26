import { Input, SearchField } from "react-aria-components";
import { useSessionStore } from "./session-store";

/**
 * 转换树工具栏：仅搜索（布局对照旧版——全选/全取消/展开/收起按钮在旧版位于
 * 右侧按钮组，已随 RunControls 归位；搜索为新增辅助操作，只过滤显示、
 * 保留祖先链、显示命中数，不改变真实选择）。
 */
export function TreeToolbar({ hitCount }: { hitCount: number | null }) {
  const searchTerm = useSessionStore((state) => state.searchTerm);
  const search = useSessionStore((state) => state.search);

  return (
    <div role="toolbar" aria-label="转换树工具栏" className="toolbar">
      <SearchField
        aria-label="搜索转换条目"
        className="tree-search"
        value={searchTerm}
        onChange={search}
      >
        <Input placeholder="搜索转换条目…" />
      </SearchField>
      {hitCount !== null ? (
        <span className="tree-search-count" role="status">
          匹配 {hitCount} 项
        </span>
      ) : null}
    </div>
  );
}
