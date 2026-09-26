import { invoke } from "@tauri-apps/api/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type {
  BackendSnapshot,
  EffectiveSettingsLike,
  OutputMatrixRuleLike,
} from "../src/adapters/backend";
import { OutputMatrixEditor } from "../src/app/OutputMatrixEditor";
import { resetSessionStore, useSessionStore } from "../src/app/session-store";

// jsdom 无 WebView 桥接；mock Tauri 层。
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

const mockedInvoke = invoke as unknown as Mock<
  (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
>;

function makeEffective(partial: Partial<EffectiveSettingsLike> = {}): EffectiveSettingsLike {
  return {
    workDir: "D:/conf",
    xresloaderPath: "xresloader.jar",
    proto: "protobuf",
    dataVersion: "",
    outputDir: "out",
    rename: "",
    type: "bin",
    protoFile: [],
    dataSrcDir: [],
    matrix: [],
    ...partial,
  };
}

function makeSnapshot(effective: EffectiveSettingsLike | null = makeEffective()): BackendSnapshot {
  return {
    state: "ready",
    runSeq: 0,
    config: { path: "D:/conf/convert_list.xml" },
    tree: null,
    selectedItems: [],
    settings: { overrides: {}, effective, parallelism: 2 },
    customSelectors: null,
  };
}

function routeRpc(handlers: Record<string, (params: unknown) => unknown>) {
  mockedInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
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

async function loadFixture(snapshot: BackendSnapshot = makeSnapshot()): Promise<void> {
  routeRpc({ loadConfig: () => snapshot });
  await expect(useSessionStore.getState().loadConfig("D:/conf/convert_list.xml")).resolves.toBe(
    true,
  );
}

function updateSettingsFields(): { matrix?: OutputMatrixRuleLike[]; type?: string }[] {
  return mockedInvoke.mock.calls
    .filter(([cmd, args]) => cmd === "backend_rpc" && args?.method === "updateSettings")
    .map(
      ([, args]) =>
        (
          args?.params as
            | { fields?: { matrix?: OutputMatrixRuleLike[]; type?: string } }
            | undefined
        )?.fields ?? {},
    );
}

/** 应答 updateSettings：合并出新的 SettingsView（fresh 对象，模拟后端 structuredClone）。 */
function answerUpdateSettings(snapshot: BackendSnapshot) {
  return (params: unknown) => {
    const fields = (params as { fields: Record<string, unknown> }).fields;
    const current = snapshot.settings;
    const next = {
      overrides: current.overrides,
      effective: current.effective === null ? null : { ...current.effective },
      parallelism: current.parallelism,
    };
    for (const [key, value] of Object.entries(fields)) {
      if (key !== "parallelism" && next.effective !== null) {
        (next.effective as unknown as Record<string, unknown>)[key] = value;
      }
    }
    snapshot.settings = next;
    return next;
  };
}

describe("OutputMatrixEditor（P4-04b，UI04）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    mockedInvoke.mockReset();
  });

  it("单类型模式：格式/重命名/输出目录编辑分别提交", async () => {
    const snapshot = makeSnapshot();
    await loadFixture(snapshot);
    routeRpc({ updateSettings: answerUpdateSettings(snapshot) });
    render(<OutputMatrixEditor />);
    const user = userEvent.setup();

    const format = screen.getByLabelText("输出格式");
    expect(format).toHaveProperty("value", "bin");
    await user.selectOptions(format, "lua");
    await waitFor(() => expect(updateSettingsFields()).toHaveLength(1));
    expect(updateSettingsFields()[0]).toEqual({ type: "lua" });

    const rename = screen.getByLabelText("重命名（正则）");
    await user.click(rename);
    await user.type(rename, "/(?i)\\.bin$/.lua/");
    await user.tab();
    await waitFor(() => expect(updateSettingsFields()).toHaveLength(2));
    expect(updateSettingsFields()[1]).toEqual({ rename: "/(?i)\\.bin$/.lua/" });

    const outputDir = screen.getByLabelText("输出目录（output_dir）");
    await user.click(outputDir);
    await user.clear(outputDir);
    await user.type(outputDir, "ui-out");
    await user.tab();
    await waitFor(() => expect(updateSettingsFields()).toHaveLength(3));
    expect(updateSettingsFields()[2]).toEqual({ outputDir: "ui-out" });
  });

  it("未知格式不静默丢弃：追加“未知格式: X”选项并选中", async () => {
    await loadFixture(makeSnapshot(makeEffective({ type: "excel" })));
    render(<OutputMatrixEditor />);
    const format = screen.getByLabelText("输出格式");
    expect(format).toHaveProperty("value", "excel");
    expect(screen.getByRole("option", { name: "未知格式: excel" })).toHaveProperty(
      "value",
      "excel",
    );
  });

  it("添加输出规则：以当前有效值生成两条规则进入矩阵模式", async () => {
    const snapshot = makeSnapshot(makeEffective({ type: "lua", outputDir: "out" }));
    await loadFixture(snapshot);
    routeRpc({ updateSettings: answerUpdateSettings(snapshot) });
    render(<OutputMatrixEditor />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "添加输出规则" }));
    await waitFor(() => expect(updateSettingsFields()).toHaveLength(1));
    const matrix = updateSettingsFields()[0]?.matrix;
    expect(matrix).toHaveLength(2);
    expect(matrix?.[0]).toEqual({ type: "lua", outputDir: "out", tags: [], classes: [] });
    expect(matrix?.[1]).toEqual({ type: "lua", outputDir: "out", tags: [], classes: [] });

    // 受控回写后进入矩阵模式（逐规则编辑区出现）
    await screen.findByLabelText("输出规则 1");
    expect(screen.getByLabelText("输出规则 2")).toBeTruthy();
  });

  it("矩阵模式：逐规则编辑 tags/classes（空白分隔 ↔ string[]）、删除规则、清空矩阵", async () => {
    const snapshot = makeSnapshot(
      makeEffective({
        matrix: [
          { type: "lua", tags: [], classes: [] },
          { type: "json", rename: "/x/y/", tags: ["server"], classes: [] },
        ],
      }),
    );
    await loadFixture(snapshot);
    routeRpc({ updateSettings: answerUpdateSettings(snapshot) });
    render(<OutputMatrixEditor />);
    const user = userEvent.setup();

    // 矩阵模式不出现全局单类型编辑区，只有逐规则的“输出格式”下拉
    expect(screen.getAllByLabelText("输出格式")).toHaveLength(2);

    const rule1 = screen.getByLabelText("输出规则 1");
    const rule2 = screen.getByLabelText("输出规则 2");
    expect(within(rule1).getByLabelText("输出格式")).toHaveProperty("value", "lua");
    expect(within(rule2).getByLabelText("tag 限定（空白分隔）")).toHaveProperty("value", "server");

    // 编辑规则 1 的 tag 限定 → 整体提交 matrix
    const tags = within(rule1).getByLabelText("tag 限定（空白分隔）");
    await user.click(tags);
    await user.type(tags, "server hot");
    await user.tab();
    await waitFor(() => expect(updateSettingsFields()).toHaveLength(1));
    expect(updateSettingsFields()[0]?.matrix?.[0]?.tags).toEqual(["server", "hot"]);
    expect(updateSettingsFields()[0]?.matrix?.[1]?.tags).toEqual(["server"]);

    // 删除规则 2 → 剩 1 条
    await user.click(screen.getByRole("button", { name: "删除规则 2" }));
    await waitFor(() => expect(updateSettingsFields()).toHaveLength(2));
    expect(updateSettingsFields()[1]?.matrix).toHaveLength(1);

    // 清空矩阵 → matrix: []
    await user.click(screen.getByRole("button", { name: "清空矩阵" }));
    await waitFor(() => expect(updateSettingsFields()).toHaveLength(3));
    expect(updateSettingsFields()[2]).toEqual({ matrix: [] });
  });

  it("禁用态：未加载配置时全部控件禁用", () => {
    render(<OutputMatrixEditor />);
    expect(screen.getByRole("button", { name: "添加输出规则" })).toHaveProperty("disabled", true);
    expect(screen.getByText("加载配置后可编辑输出矩阵。")).toBeTruthy();
  });

  it("矩阵模式下加载中/运行中禁用编辑", async () => {
    const snapshot = makeSnapshot(
      makeEffective({ matrix: [{ type: "lua", tags: ["s"], classes: [] }] }),
    );
    snapshot.state = "converting";
    await loadFixture(snapshot);
    render(<OutputMatrixEditor />);
    const rule1 = screen.getByLabelText("输出规则 1");
    expect(within(rule1).getByLabelText("输出格式")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "删除规则 1" })).toHaveProperty("disabled", true);
  });
});
