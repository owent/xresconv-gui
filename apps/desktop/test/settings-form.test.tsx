import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type {
  BackendSnapshot,
  EffectiveSettingsLike,
  PreviewResult,
} from "../src/adapters/backend";
import { ConversionSettings } from "../src/app/ConversionSettings";
import { resetSessionStore, useSessionStore } from "../src/app/session-store";

// jsdom 无 WebView 桥接；mock Tauri 层（isTauri=false → 事件订阅降级为空订阅）。
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
    dataVersion: "1.0.0",
    outputDir: "out",
    rename: "",
    type: "bin",
    protoFile: ["a.pb", "b.pb"],
    dataSrcDir: ["data"],
    matrix: [],
    ...partial,
  };
}

function makeSnapshot(
  effective: EffectiveSettingsLike | null = makeEffective(),
  parallelism = 2,
  state = "ready",
): BackendSnapshot {
  return {
    state,
    runSeq: 0,
    config: { path: "D:/conf/convert_list.xml" },
    tree: null,
    selectedItems: [],
    settings: { overrides: {}, effective, parallelism },
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

function updateSettingsFields(): unknown[] {
  return mockedInvoke.mock.calls
    .filter(([cmd, args]) => cmd === "backend_rpc" && args?.method === "updateSettings")
    .map(([, args]) => (args?.params as { fields?: unknown } | undefined)?.fields);
}

/** 应答 updateSettings：把 fields 合并出新的 SettingsView（fresh 对象，模拟后端 structuredClone）。 */
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
      if (key === "parallelism") {
        next.parallelism = value as number;
      } else if (next.effective !== null) {
        (next.effective as unknown as Record<string, unknown>)[key] = value;
      }
    }
    snapshot.settings = next;
    return next;
  };
}

describe("ConversionSettings（P4-04b，UI04）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    mockedInvoke.mockReset();
  });

  it("加载后按 effective 渲染全部字段", async () => {
    await loadFixture();
    render(<ConversionSettings />);
    fireEvent.click(screen.getByRole("button", { name: "详情…" }));
    expect(screen.getByLabelText("执行目录（work_dir）")).toHaveProperty("value", "D:/conf");
    expect(screen.getByLabelText("转表工具（xresloader.jar）")).toHaveProperty(
      "value",
      "xresloader.jar",
    );
    expect(screen.getByLabelText("协议描述文件（一行一个）")).toHaveProperty("value", "a.pb\nb.pb");
    expect(screen.getByLabelText("数据目录（一行一个）")).toHaveProperty("value", "data");
    expect(screen.getByLabelText("数据版本")).toHaveProperty("value", "1.0.0");
    expect(screen.getByLabelText("协议类型")).toHaveProperty("value", "protobuf");
    expect(screen.getByLabelText("并发数")).toHaveProperty("value", "2");
  });

  it("多值字段往返：protoFile 多行 ↔ string[]（去空行），提交后受控回写", async () => {
    const snapshot = makeSnapshot();
    await loadFixture(snapshot);
    routeRpc({ updateSettings: answerUpdateSettings(snapshot) });
    render(<ConversionSettings />);
    fireEvent.click(screen.getByRole("button", { name: "详情…" }));
    const user = userEvent.setup();

    const textarea = screen.getByLabelText("协议描述文件（一行一个）");
    await user.click(textarea);
    await user.clear(textarea);
    await user.type(textarea, "a.pb{Enter}{Enter}b.pb{Enter}c.pb");
    await user.tab(); // blur 提交

    await waitFor(() => expect(updateSettingsFields()).toHaveLength(1));
    expect(updateSettingsFields()[0]).toEqual({ protoFile: ["a.pb", "b.pb", "c.pb"] });
    // 受控回写：textarea 显示后端返回的有效值
    await waitFor(() => expect(textarea).toHaveProperty("value", "a.pb\nb.pb\nc.pb"));
  });

  it("空字段语义：清空 workDir 提交空串（后端回退入口目录）", async () => {
    const snapshot = makeSnapshot();
    await loadFixture(snapshot);
    routeRpc({ updateSettings: answerUpdateSettings(snapshot) });
    render(<ConversionSettings />);
    fireEvent.click(screen.getByRole("button", { name: "详情…" }));
    const user = userEvent.setup();

    const input = screen.getByLabelText("执行目录（work_dir）");
    await user.click(input);
    await user.clear(input);
    await user.tab();

    await waitFor(() => expect(updateSettingsFields()).toHaveLength(1));
    expect(updateSettingsFields()[0]).toEqual({ workDir: "" });
  });

  it("未知协议保留为追加选项并选中；改回内置协议提交", async () => {
    const snapshot = makeSnapshot(makeEffective({ proto: "capnproto" }));
    await loadFixture(snapshot);
    routeRpc({ updateSettings: answerUpdateSettings(snapshot) });
    render(<ConversionSettings />);
    fireEvent.click(screen.getByRole("button", { name: "详情…" }));
    const user = userEvent.setup();

    const select = screen.getByLabelText("协议类型");
    expect(select).toHaveProperty("value", "capnproto");
    const unknown = [...select.querySelectorAll("option")].find(
      (option) => option.value === "capnproto",
    );
    expect(unknown?.textContent).toBe("未知协议: capnproto");

    await user.selectOptions(select, "protobuf");
    await waitFor(() => expect(updateSettingsFields()).toHaveLength(1));
    expect(updateSettingsFields()[0]).toEqual({ proto: "protobuf" });
  });

  it("运行中整体禁用；后端 INVALID_STATE 经 lastError 可见", async () => {
    await loadFixture(makeSnapshot(makeEffective(), 2, "converting"));
    render(<ConversionSettings />);
    fireEvent.click(screen.getByRole("button", { name: "详情…" }));
    expect(screen.getByLabelText("执行目录（work_dir）")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("并发数")).toHaveProperty("disabled", true);
  });

  it("后端拒绝（INVALID_STATE）写入 lastError，表单值回退为 effective", async () => {
    const snapshot = makeSnapshot();
    await loadFixture(snapshot);
    routeRpc({
      updateSettings: () => {
        throw new Error("INVALID_STATE: cannot update settings while session is converting");
      },
    });
    render(<ConversionSettings />);
    fireEvent.click(screen.getByRole("button", { name: "详情…" }));
    const user = userEvent.setup();

    const input = screen.getByLabelText("数据版本");
    await user.click(input);
    await user.clear(input);
    await user.type(input, "9.9.9");
    await user.tab();

    await waitFor(() => expect(useSessionStore.getState().lastError).toContain("INVALID_STATE"));
    // 拒绝后显示值回退为后端 effective（未变更）
    await waitFor(() => expect(input).toHaveProperty("value", "1.0.0"));
  });

  it("世代：加载新配置后旧表单值不残留，preview 重置为 idle", async () => {
    const snapshotA = makeSnapshot(makeEffective({ xresloaderPath: "a.jar" }));
    const previewResult: PreviewResult = {
      plan: { workDir: "D:/conf", xresloaderPath: "a.jar", taskCount: 1, tasks: [] },
      selectionCount: 1,
      conflicts: [],
    };
    await loadFixture(snapshotA);
    routeRpc({ preview: () => previewResult });
    render(<ConversionSettings />);
    fireEvent.click(screen.getByRole("button", { name: "详情…" }));
    expect(screen.getByLabelText("转表工具（xresloader.jar）")).toHaveProperty("value", "a.jar");
    await act(async () => {
      await expect(useSessionStore.getState().runPreview()).resolves.toBe(true);
    });
    expect(useSessionStore.getState().preview.status).toBe("ok");

    const snapshotB = makeSnapshot(makeEffective({ xresloaderPath: "b.jar" }));
    routeRpc({ loadConfig: () => snapshotB });
    await act(async () => {
      await expect(useSessionStore.getState().loadConfig("D:/conf/other.xml")).resolves.toBe(true);
    });

    await waitFor(() =>
      expect(screen.getByLabelText("转表工具（xresloader.jar）")).toHaveProperty("value", "b.jar"),
    );
    expect(useSessionStore.getState().preview).toEqual({
      status: "idle",
      result: null,
      error: null,
    });
  });

  it("并发数 >6 弹本地确认：确认才提交，取消不提交且显示值回退", async () => {
    const snapshot = makeSnapshot();
    await loadFixture(snapshot);
    routeRpc({ updateSettings: answerUpdateSettings(snapshot) });
    render(<ConversionSettings />);
    fireEvent.click(screen.getByRole("button", { name: "详情…" }));
    const user = userEvent.setup();

    const select = screen.getByLabelText("并发数");
    // 选择 8 → 弹确认，未发 RPC
    await user.selectOptions(select, "8");
    const dialog = await screen.findByRole("dialog", { name: "确认高并发数" });
    expect(dialog.textContent).toContain("8");
    expect(updateSettingsFields()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(updateSettingsFields()).toHaveLength(1));
    expect(updateSettingsFields()[0]).toEqual({ parallelism: 8 });
    await waitFor(() => expect(select).toHaveProperty("value", "8"));

    // 再选 16 → 取消：不发 RPC，显示值保持 8
    await user.selectOptions(select, "16");
    await screen.findByRole("dialog", { name: "确认高并发数" });
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(updateSettingsFields()).toHaveLength(1);
    expect(select).toHaveProperty("value", "8");
  });

  it("并发数 ≤6 直接提交不弹确认", async () => {
    const snapshot = makeSnapshot();
    await loadFixture(snapshot);
    routeRpc({ updateSettings: answerUpdateSettings(snapshot) });
    render(<ConversionSettings />);
    fireEvent.click(screen.getByRole("button", { name: "详情…" }));
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("并发数"), "4");
    await waitFor(() => expect(updateSettingsFields()).toHaveLength(1));
    expect(updateSettingsFields()[0]).toEqual({ parallelism: 4 });
    expect(screen.queryByRole("dialog", { name: "确认高并发数" })).toBeNull();
  });

  it("未加载配置时整体禁用（详情按钮不可开，弹窗不出现）", () => {
    render(<ConversionSettings />);
    const detail = screen.getByRole("button", { name: "详情…" }) as HTMLButtonElement;
    expect(detail.disabled).toBe(true);
    expect(screen.getByLabelText("并发数")).toHaveProperty("disabled", true);
    expect(screen.getByText("加载配置后可编辑转换参数。")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "详细配置" })).toBeNull();
  });
});
