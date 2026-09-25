import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { LogEntryLike } from "../src/adapters/backend";
import { LogPanel } from "../src/app/LogPanel";
import { resetSessionStore, useSessionStore } from "../src/app/session-store";

// jsdom 无布局：offsetHeight/offsetWidth 恒 0 会让虚拟器算出空范围
// （virtual-core：outerSize === 0 → range=null）。本文件给元素补种子尺寸，
// afterAll 恢复原型。
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 320,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 800,
  });
});

afterAll(() => {
  delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
  delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
});

// jsdom 无 WebView 桥接；mock Tauri 层。
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
  save: vi.fn(async () => null),
}));

const mockedInvoke = invoke as unknown as Mock<
  (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
>;
const mockedSave = save as unknown as Mock<(options?: unknown) => Promise<string | null>>;

function entry(partial: Partial<LogEntryLike> & { message: string }): LogEntryLike {
  return {
    rawMessage: partial.message,
    moduleName: "CONV",
    style: "alert-secondary",
    level: "info",
    text: partial.text ?? `[CONV]: ${partial.message}`,
    ...partial,
  };
}

function routeRpc(handlers: Record<string, (params: unknown) => unknown>) {
  mockedInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "export_text_file") {
      return Promise.resolve(undefined);
    }
    if (cmd !== "backend_rpc") {
      return Promise.reject(new Error(`unexpected command: ${cmd}`));
    }
    const method = String(args?.method);
    const handler = handlers[method];
    if (handler === undefined) {
      return Promise.reject(`INVALID_STATE: unexpected method ${method}`);
    }
    try {
      return Promise.resolve(handler(args?.params));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error.message : String(error));
    }
  });
}

function recordLog(entryLike: LogEntryLike): void {
  useSessionStore.getState().recordBackendEvent({
    kind: "event",
    payload: { source: "backend", type: "log", entry: entryLike },
  });
}

function logRow_texts(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".log-row")]
    .map((row) => row.textContent ?? "")
    .filter((text) => text.length > 0);
}

describe("LogPanel 日志窗口（P4-07，UI07）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    mockedInvoke.mockReset();
    mockedSave.mockReset();
  });

  it("挂载初始填充 getLogs；事件按 seq 追加且幂等去重", async () => {
    routeRpc({
      getLogs: () => ({
        entries: [entry({ message: "first", seq: 1 }), entry({ message: "second", seq: 2 })],
        droppedCount: 0,
        capacity: 10000,
      }),
    });
    render(<LogPanel />);

    await waitFor(() => expect(logRow_texts().join("|")).toContain("first"));
    expect(logRow_texts().join("|")).toContain("second");
    expect(mockedInvoke).toHaveBeenCalledWith("backend_rpc", {
      method: "getLogs",
      params: { limit: 1000 },
    });

    // 事件追加（新 seq）与重复事件（旧 seq）。
    recordLog(entry({ message: "third", seq: 3 }));
    recordLog(entry({ message: "second", seq: 2 }));
    await waitFor(() => expect(logRow_texts().join("|")).toContain("third"));
    expect(logRow_texts().filter((text) => text.includes("second"))).toHaveLength(1);
  });

  it("级别筛选与文本筛选只影响显示，不改日志缓冲", async () => {
    routeRpc({
      getLogs: () => ({
        entries: [
          entry({ message: "startup ok", seq: 1, level: "info" }),
          entry({ message: "convert failed", seq: 2, level: "error" }),
        ],
        droppedCount: 0,
        capacity: 10000,
      }),
    });
    render(<LogPanel />);
    await waitFor(() => expect(logRow_texts().length).toBe(2));
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("日志级别筛选"), "error");
    expect(logRow_texts().join("|")).toContain("convert failed");
    expect(logRow_texts().join("|")).not.toContain("startup ok");

    await user.type(screen.getByLabelText("日志文本筛选"), "failed");
    expect(logRow_texts().length).toBe(1);

    // 清空筛选恢复显示；缓冲本身未变。
    await user.clear(screen.getByLabelText("日志文本筛选"));
    await user.selectOptions(screen.getByLabelText("日志级别筛选"), "all");
    await waitFor(() => expect(logRow_texts().length).toBe(2));
    expect(useSessionStore.getState().logs.entries.length).toBe(2);
  });

  it("ANSI 颜色安全渲染：SGR → 固定色表 span；标签/事件属性/危险 URL 不执行", async () => {
    routeRpc({
      getLogs: () => ({
        entries: [
          entry({
            message: "\x1b[31m红字\x1b[0m 正常 \x1b[1;4m粗下划\x1b[0m",
            seq: 1,
            level: "notice",
          }),
          entry({
            message: "<script>alert(1)</script><img src=x onerror=alert(2)> javascript:alert(3)",
            seq: 2,
          }),
        ],
        droppedCount: 0,
        capacity: 10000,
      }),
    });
    render(<LogPanel />);
    await waitFor(() => expect(logRow_texts().length).toBe(2));

    // ANSI 段落：固定色表（darkred）经 style 呈现，文本完整保留。
    const colored = screen.getByText("红字");
    expect(colored).toHaveProperty("tagName", "SPAN");
    expect((colored as HTMLElement).style.color).toBe("darkred");
    const bold = screen.getByText("粗下划");
    expect((bold as HTMLElement).style.fontWeight).not.toBe("");

    // XSS：无 script/img/a 元素，载荷按字面文本展示（React 转义）。
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("a")).toBeNull();
    expect(logRow_texts().join("|")).toContain("javascript:alert(3)");
  });

  it("有界窗口：超出容量丢弃最老并显示丢弃计数", async () => {
    routeRpc({ getLogs: () => ({ entries: [], droppedCount: 0, capacity: 10000 }) });
    render(<LogPanel />);
    await waitFor(() => expect(useSessionStore.getState().logs.initialized).toBe(true));

    const capacity = useSessionStore.getState().logs.windowCapacity;
    for (let i = 0; i < capacity + 25; i++) {
      recordLog(entry({ message: `line${i}`, seq: i + 1 }));
    }
    await waitFor(() => expect(useSessionStore.getState().logs.entries.length).toBe(capacity));
    expect(useSessionStore.getState().logs.entries[0]?.message).toBe("line25");
    expect(useSessionStore.getState().logs.localDroppedCount).toBe(25);
    await waitFor(() => expect(screen.getByTestId("log-window-info").textContent).toContain("25"));
  });

  it("复制：写入剪贴板的内容为筛选后条目文本行", async () => {
    routeRpc({
      getLogs: () => ({
        entries: [
          entry({ message: "keep-a", seq: 1, level: "info" }),
          entry({ message: "drop-b", seq: 2, level: "error" }),
        ],
        droppedCount: 0,
        capacity: 10000,
      }),
    });
    render(<LogPanel />);
    await waitFor(() => expect(logRow_texts().length).toBe(2));
    const user = userEvent.setup();
    // userEvent.setup() 会安装自带 Clipboard 桩覆盖可配置的 navigator.clipboard，
    // 因此在 setup 之后再注入 mock。
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await user.selectOptions(screen.getByLabelText("日志级别筛选"), "info");
    await user.click(screen.getByRole("button", { name: "复制日志" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(copied).toContain("[CONV]: keep-a");
    expect(copied).not.toContain("drop-b");
  });

  it("导出：save 对话框选路径后写 export_text_file；取消不调用", async () => {
    routeRpc({
      getLogs: () => ({
        entries: [entry({ message: "export-me", seq: 1 })],
        droppedCount: 0,
        capacity: 10000,
      }),
    });
    render(<LogPanel />);
    await waitFor(() => expect(logRow_texts().length).toBe(1));
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    // 取消：不触发写入。
    mockedSave.mockResolvedValueOnce(null);
    await user.click(screen.getByRole("button", { name: "导出日志" }));
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
    expect(mockedInvoke.mock.calls.filter(([cmd]) => cmd === "export_text_file")).toHaveLength(0);

    // 确认路径：写入文件内容为日志文本。
    mockedSave.mockResolvedValueOnce("D:/out/中文 日志.log");
    await user.click(screen.getByRole("button", { name: "导出日志" }));
    await waitFor(() =>
      expect(mockedInvoke.mock.calls.filter(([cmd]) => cmd === "export_text_file")).toHaveLength(1),
    );
    const call = mockedInvoke.mock.calls.find(([cmd]) => cmd === "export_text_file");
    expect(call?.[1]).toMatchObject({ path: "D:/out/中文 日志.log" });
    expect(String(call?.[1]?.content)).toContain("[CONV]: export-me");
  });

  it("虚拟列表：大量条目只渲染窗口内行", async () => {
    const entries = Array.from({ length: 3000 }, (_, i) =>
      entry({ message: `vline${i}`, seq: i + 1 }),
    );
    routeRpc({ getLogs: () => ({ entries, droppedCount: 0, capacity: 10000 }) });
    render(<LogPanel />);
    await waitFor(() => expect(useSessionStore.getState().logs.entries.length).toBe(3000));
    await waitFor(() => {
      const rows = [...document.querySelectorAll<HTMLElement>(".log-row")];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(300);
    });
  });

  it("加载更早：beforeSeq 取历史并前插；无更早时按钮禁用", async () => {
    routeRpc({
      getLogs: (params) => {
        const beforeSeq = (params as { beforeSeq?: number } | undefined)?.beforeSeq;
        if (beforeSeq === undefined) {
          return {
            entries: [entry({ message: "new-head", seq: 11 })],
            droppedCount: 0,
            capacity: 10000,
          };
        }
        expect(beforeSeq).toBe(11);
        return {
          entries: [entry({ message: "old-9", seq: 9 }), entry({ message: "old-10", seq: 10 })],
          droppedCount: 0,
          capacity: 10000,
        };
      },
    });
    render(<LogPanel />);
    await waitFor(() => expect(logRow_texts().join("|")).toContain("new-head"));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "加载更早" }));

    await waitFor(() => expect(logRow_texts().join("|")).toContain("old-9"));
    const texts = logRow_texts();
    expect(texts.findIndex((t) => t.includes("old-9"))).toBeLessThan(
      texts.findIndex((t) => t.includes("new-head")),
    );
  });

  it("guardian 死亡复位日志初始化标记（重启后重新拉取，seq 重开不去重误杀）", async () => {
    routeRpc({ getLogs: () => ({ entries: [], droppedCount: 0, capacity: 10000 }) });
    render(<LogPanel />);
    await waitFor(() => expect(useSessionStore.getState().logs.initialized).toBe(true));

    useSessionStore.getState().markGuardianDead({ reason: "EOF" });
    expect(useSessionStore.getState().logs.initialized).toBe(false);

    // 新一代 backend seq 从 1 重新开始：复位后不被 maxSeq 误杀。
    recordLog(entry({ message: "fresh-gen", seq: 1 }));
    expect(useSessionStore.getState().logs.entries.at(-1)?.message).toBe("fresh-gen");
  });

  it("空态与后端丢弃提示：backend droppedCount > 0 可见", async () => {
    routeRpc({ getLogs: () => ({ entries: [], droppedCount: 7, capacity: 10000 }) });
    render(<LogPanel />);
    await waitFor(() => expect(screen.getByTestId("log-window-info").textContent).toContain("7"));
    expect(screen.getByRole("log", { name: "日志列表" }).textContent).toContain("暂无日志");
  });
});
