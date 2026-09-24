import { Button, Input, SearchField } from "react-aria-components";
import { useSessionStore } from "./session-store";

/**
 * 转换树工具栏（F03）：全选/全不选 + 搜索。
 * 全选/全不选为旧版按钮语义（整棵有效配置树，select_all/select_none op），
 * 有配置加载后才可用；搜索仅过滤显示（保留祖先链、显示命中数），
 * 不改变真实选择（04-ui §页面和组件边界：搜索属辅助操作，
 * 不改变“全选”的原含义）。
 */
export function TreeToolbar({ hitCount }: { hitCount: number | null }) {
  const hasConfig = useSessionStore((state) => state.snapshot?.tree != null);
  const searchTerm = useSessionStore((state) => state.searchTerm);
  const search = useSessionStore((state) => state.search);
  const selectAll = useSessionStore((state) => state.selectAll);
  const selectNone = useSessionStore((state) => state.selectNone);

  return (
    <div role="toolbar" aria-label="转换树工具栏" className="toolbar">
      <Button isDisabled={!hasConfig} onPress={() => void selectAll()}>
        全部选中
      </Button>
      <Button isDisabled={!hasConfig} onPress={() => void selectNone()}>
        全部取消
      </Button>
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
