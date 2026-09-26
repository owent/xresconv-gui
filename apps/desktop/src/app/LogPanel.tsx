import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { parseAnsi } from "./ansi";
import {
  filterLogEntries,
  type LogLevelFilter,
  type UiLogEntry,
  useSessionStore,
} from "./session-store";

/** 虚拟行高（等高行；estimateSize 固定，无需逐行测量）。 */
const LOG_ROW_HEIGHT = 22;
/** 视口高度（CSS 已定 flex:1；虚拟器需要显式滚动元素，此处兜底 min-height）。 */
const LOG_VIEWPORT_MIN_HEIGHT = 160;
/** 追尾判定阈值（px）：距底部小于该值视为钉住底部。 */
const PIN_THRESHOLD_PX = 48;

const LEVEL_FILTERS: { value: LogLevelFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "info", label: "信息" },
  { value: "notice", label: "通知" },
  { value: "warning", label: "警告" },
  { value: "error", label: "错误" },
];

/** 单条日志消息渲染：ANSI SGR → 固定色表 span（BD-04；文本节点，无 HTML 通道）。 */
function AnsiText({ message }: { message: string }) {
  const segments = useMemo(() => parseAnsi(message), [message]);
  return (
    <>
      {segments.map((segment) => {
        const { color, background, bold, underline } = segment.style;
        if (color === undefined && background === undefined && !bold && !underline) {
          return <span key={segment.key}>{segment.text}</span>;
        }
        return (
          <span
            key={segment.key}
            style={{
              ...(color === undefined ? {} : { color }),
              ...(background === undefined ? {} : { backgroundColor: background }),
              ...(bold ? { fontWeight: "bold" } : {}),
              ...(underline ? { textDecoration: "underline" } : {}),
            }}
          >
            {segment.text}
          </span>
        );
      })}
    </>
  );
}

function LogRow({ entry }: { entry: UiLogEntry }) {
  return (
    <div className={`log-row log-level--${entry.level}`}>
      {entry.moduleName !== "" && <span className="log-module">[{entry.moduleName}]</span>}
      <AnsiText message={entry.message} />
    </div>
  );
}

/**
 * 日志面板（F08/F10，P4-07 UI07）：虚拟列表（TanStack Virtual）、级别/文本筛选、
 * 复制/导出（纯文本，entry.text 行）、加载更早（getLogs beforeSeq 游标）。
 * 富文本仅 ANSI SGR 固定色表（BD-04）；标签/事件属性/URL 一律按字面文本渲染，
 * 不进任何 HTML 通道（R12）。筛选只影响显示与复制/导出范围，不影响落盘日志
 * 与脚本 hook。有界窗口淘汰最老并显示丢弃计数（无业务日志静默丢失：backend
 * 队列/落盘与 UI 丢弃量均可见）。
 */
export function LogPanel() {
  const logs = useSessionStore((state) => state.logs);
  const filter = useSessionStore((state) => state.logFilter);
  const connection = useSessionStore((state) => state.connection);
  const initLogs = useSessionStore((state) => state.initLogs);
  const loadOlderLogs = useSessionStore((state) => state.loadOlderLogs);
  const copyLogs = useSessionStore((state) => state.copyLogs);
  const exportLogs = useSessionStore((state) => state.exportLogs);
  const setLogFilter = useSessionStore((state) => state.setLogFilter);

  const [copyHint, setCopyHint] = useState<string | null>(null);
  // 溢出查看方式（2026-09-26 用户需求）：false=横向滚动（默认，虚拟行等高）；
  // true=自动换行（虚拟行高度按换行后行数估算）。
  const [wrap, setWrap] = useState(false);

  // 初始拉取（含 guardian 重启后的重新拉取；initLogs 自身幂等）。
  useEffect(() => {
    if (connection !== "degraded") {
      void initLogs();
    }
  }, [connection, initLogs]);

  const entries = logs.entries;
  const filtered = useMemo(() => filterLogEntries(entries, filter), [entries, filter]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => LOG_ROW_HEIGHT,
    overscan: 16,
    // 换行模式按容器宽度估算行高（每行~44 个等宽字符）。
    ...(wrap ? { estimateSize: () => LOG_ROW_HEIGHT * 2 } : {}),
    // 首帧/无 ResizeObserver 环境（SSR、jsdom）的种子视口；真实 WebView 由
    // ResizeObserver 立即校正。
    initialRect: { width: 800, height: LOG_VIEWPORT_MIN_HEIGHT + 140 },
  });
  const pinnedRef = useRef(true);

  // 追尾：钉住底部时新日志自动滚到底（用户上滚查看历史则不打扰）。
  useEffect(() => {
    if (pinnedRef.current && filtered.length > 0) {
      virtualizer.scrollToIndex(filtered.length - 1, { align: "end" });
    }
  }, [filtered.length, virtualizer]);

  const firstSeq = entries.find((entry) => entry.seq !== undefined)?.seq;
  const canLoadOlder =
    firstSeq !== undefined && firstSeq > 1 && !logs.noMoreOlder && !logs.loadingOlder;

  const onCopy = async () => {
    const ok = await copyLogs();
    setCopyHint(ok ? `已复制 ${filtered.length} 条` : null);
    if (ok) {
      window.setTimeout(() => setCopyHint(null), 2000);
    }
  };

  return (
    <section className="panel log-panel" aria-label="运行日志">
      <div className="log-toolbar">
        <span className="log-title">运行日志</span>
        <label className="log-filter-label">
          级别
          <select
            aria-label="日志级别筛选"
            value={filter.level}
            onChange={(event) => setLogFilter({ level: event.target.value as LogLevelFilter })}
          >
            {LEVEL_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          aria-label="日志文本筛选"
          placeholder="筛选文本…"
          value={filter.text}
          onChange={(event) => setLogFilter({ text: event.target.value })}
        />
        <span className="log-count">
          日志 {filtered.length}/{entries.length} 条
        </span>
        <Button
          className={wrap ? "" : "btn-ghost"}
          aria-pressed={wrap}
          onPress={() => setWrap((value) => !value)}
        >
          {wrap ? "换行" : "横向滚动"}
        </Button>
        <Button onPress={() => void onCopy()}>复制日志</Button>
        <Button onPress={() => void exportLogs()}>导出日志</Button>
        {copyHint !== null && (
          <span role="status" className="log-copy-hint">
            {copyHint}
          </span>
        )}
      </div>
      <p className="log-window-info" data-testid="log-window-info">
        {logs.localDroppedCount > 0 && <>窗口已淘汰最老 {logs.localDroppedCount} 条；</>}
        {logs.backendDroppedCount > 0 && <>后端队列已丢弃 {logs.backendDroppedCount} 条；</>}
        完整日志见磁盘
      </p>
      {canLoadOlder && (
        <div className="log-load-older">
          <Button onPress={() => void loadOlderLogs()}>
            {logs.loadingOlder ? "加载中…" : "加载更早"}
          </Button>
        </div>
      )}
      {logs.noMoreOlder && <p className="log-window-info">已到最早日志</p>}
      <div
        ref={parentRef}
        role="log"
        aria-label="日志列表"
        className={`log-list${wrap ? " log-list--wrap" : ""}`}
        style={{ minHeight: LOG_VIEWPORT_MIN_HEIGHT }}
        onScroll={() => {
          const el = parentRef.current;
          if (el === null) return;
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD_PX;
        }}
      >
        {filtered.length === 0 ? (
          <p className="empty-state">暂无日志</p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const entry = filtered[item.index];
              return (
                <div
                  key={entry?.localId ?? item.index}
                  data-index={item.index}
                  className="log-row-wrapper"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  {entry !== undefined && <LogRow entry={entry} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
