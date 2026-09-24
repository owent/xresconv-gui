/**
 * BackendRpcApp 业务 RPC 面测试（P4-02）。
 *
 * 真实 ScriptWorkerPool（worker 真进程）+ 注入 fake Java runner；每个用例
 * 自建 pool（app 拥有池生命周期：start/dispose）。全部显式有界超时。
 *
 * 覆盖：loadConfig/reload/getSnapshot/applyOps（版本闸）/run/respondDialog/
 * cancel/reset 正路，与 UNKNOWN_METHOD/INVALID_PARAMS/INVALID_STATE/CONFIG_ERROR
 * 错误码路径；P4-04a：updateSettings（白名单/合并/reload 清空/矩阵资格重估/
 * 运行中拒绝）、preview（未加载/jar 缺失 XRESLOADER_NOT_FOUND/冲突检出）、
 * run 使用会话持有的 overrides。
 */

import path from "node:path";
import type { JavaBatchOptions, JavaBatchResult } from "@xresconv/guardian";
import { AbortError, ScriptWorkerPool } from "@xresconv/guardian";
import { afterAll, describe, expect, it } from "vitest";
import {
  type BackendAppEvent,
  BackendRpcApp,
  type BackendSnapshot,
  type PreviewResult,
  type RpcErrorCode,
  type SettingsView,
} from "../../src/service/rpc-app.ts";
import type { RunSummary } from "../../src/service/run.ts";
import type { AppliedOpsReport } from "../../src/service/tree-state.ts";
import { fixture, TEST_TIMEOUT_MS, waitUntil } from "./helpers.ts";

const apps: BackendRpcApp[] = [];

afterAll(async () => {
  await Promise.all(apps.splice(0).map((app) => app.dispose()));
}, TEST_TIMEOUT_MS);

function makeApp(options: { runner?: (o: JavaBatchOptions) => Promise<JavaBatchResult> } = {}) {
  const app = new BackendRpcApp({
    pool: new ScriptWorkerPool(),
    ...(options.runner === undefined ? {} : { runner: options.runner }),
  });
  apps.push(app);
  const events: BackendAppEvent[] = [];
  app.onEvent((event) => events.push(event));
  return { app, events };
}

function okRunner(calls: JavaBatchOptions[]) {
  return async (options: JavaBatchOptions): Promise<JavaBatchResult> => {
    calls.push(options);
    return { exitCode: 0, signal: null, failedTaskCount: 0, durationMs: 1 };
  };
}

function hangingRunner(calls: JavaBatchOptions[]) {
  return (options: JavaBatchOptions): Promise<JavaBatchResult> => {
    calls.push(options);
    const { promise, reject } = Promise.withResolvers<JavaBatchResult>();
    options.signal?.addEventListener("abort", () => reject(new AbortError()));
    return promise;
  };
}

async function expectRpcError(promise: Promise<unknown>, code: RpcErrorCode): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "RpcError", code });
}

async function snapshot(app: BackendRpcApp): Promise<BackendSnapshot> {
  return (await app.handleRpc("getSnapshot")) as BackendSnapshot;
}

/** 快照树里第一个 item 节点（key 为运行时数字 id）。 */
function firstItemNode(snap: BackendSnapshot) {
  const queue = [...(snap.tree?.nodes ?? [])];
  for (;;) {
    const node = queue.shift();
    if (node === undefined) return undefined;
    if (typeof node.key === "number") return node;
    queue.push(...node.children);
  }
}

describe("BackendRpcApp（P4-02）", () => {
  it("loadConfig→getSnapshot：set_name 经真实 worker 生效；reload 重载", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app, events } = makeApp({ runner: okRunner([]) });
    const loaded = (await app.handleRpc("loadConfig", {
      path: fixture("set-name.xml"),
    })) as BackendSnapshot;
    expect(loaded.state).toBe("ready");
    expect(loaded.runSeq).toBe(0);
    expect(loaded.config?.path).toBe(path.resolve(fixture("set-name.xml")));
    expect(loaded.tree?.version).toBeGreaterThanOrEqual(1);
    // set_name 真实执行：item 被改名（活值反映在树快照标题上）。
    const titles = (loaded.tree?.nodes ?? []).map((node) => node.title);
    expect(titles).toContain("alpha-renamed");
    expect(titles).toContain("beta-renamed");

    const snap = await snapshot(app);
    expect(snap.state).toBe("ready");
    expect(snap.selectedItems).toEqual([]);

    const reloaded = (await app.handleRpc("reload")) as BackendSnapshot;
    expect(reloaded.state).toBe("ready");
    expect(reloaded.config).not.toBeNull();

    // 事件面：状态迁移可见（日志事件断言在弹框用例——set-name.xml 本身不产生日志）。
    const states = events.filter((e) => e.type === "state_change").map((e) => e.state);
    expect(states).toContain("loading");
    expect(states).toContain("ready");
  });

  it("applyOps：版本失配整批拒绝；匹配版本选中 item 并推进版本", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    const loaded = (await app.handleRpc("loadConfig", {
      path: fixture("set-name.xml"),
    })) as BackendSnapshot;
    const node = firstItemNode(loaded);
    expect(node).toBeDefined();
    const version = loaded.tree?.version ?? 0;

    const stale = (await app.handleRpc("applyOps", {
      ops: [
        { v: version + 1, op: "set_node_states", changes: [{ key: node?.key, selected: true }] },
      ],
    })) as AppliedOpsReport;
    expect(stale.applied).toBe(0);
    expect(stale.rejected.length).toBe(1);
    expect(stale.rejected[0]?.reason).toContain("stale tree version");

    const applied = (await app.handleRpc("applyOps", {
      ops: [{ v: version, op: "set_node_states", changes: [{ key: node?.key, selected: true }] }],
    })) as AppliedOpsReport;
    expect(applied.applied).toBe(1);
    expect(applied.rejected).toEqual([]);

    const snap = await snapshot(app);
    expect(snap.selectedItems.length).toBe(1);
    expect(snap.selectedItems[0]?.name).toBe(node?.title);
    expect(snap.tree?.version).toBe(version + 1);
  });

  it("run/respondDialog：弹框事件 → respondDialog(yes) → run_end succeeded", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app, events } = makeApp({ runner: okRunner([]) });
    await app.handleRpc("loadConfig", { path: fixture("run-dialog.xml") });
    const started = (await app.handleRpc("run")) as { runSeq: number };
    expect(started.runSeq).toBe(1);

    await waitUntil(() => events.some((e) => e.type === "dialog_request"), "dialog_request event");
    const request = events.find((e) => e.type === "dialog_request");
    if (request?.type !== "dialog_request") throw new Error("dialog_request missing");
    expect(request.dialog.title).toBe("探针标题");
    expect(request.dialog.content).toBe("探针内容");
    expect(request.dialog.buttons).toEqual(["yes", "no"]);

    // 未知 token：迟到/来路不明应答按 SC06 丢弃，非协议错误。
    const late = (await app.handleRpc("respondDialog", {
      token: "no-such-token",
      choice: "yes",
    })) as { answered: boolean };
    expect(late.answered).toBe(false);

    const answered = (await app.handleRpc("respondDialog", {
      token: request.token,
      choice: "yes",
    })) as { answered: boolean };
    expect(answered.answered).toBe(true);

    await waitUntil(() => events.some((e) => e.type === "run_end"), "run_end event");
    const runEnd = events.find((e) => e.type === "run_end");
    if (runEnd?.type !== "run_end") throw new Error("run_end missing");
    const summary: RunSummary = runEnd.summary;
    expect(summary.state).toBe("succeeded");
    // yes 回调真实执行（worker → pool → session 管线 → app 事件）。
    await waitUntil(
      () => events.some((e) => e.type === "log" && e.entry.message === "DIALOG-YES"),
      "DIALOG-YES log event",
    );
  });

  it("cancel/reset：运行中取消到 cancelled；活动运行 reset 取消并重新武装", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const calls: JavaBatchOptions[] = [];
    let impl = hangingRunner(calls);
    const { app, events } = makeApp({ runner: (options) => impl(options) });
    const loaded = (await app.handleRpc("loadConfig", {
      path: fixture("run-hooks.xml"),
    })) as BackendSnapshot;
    // run {} 不带 selection：勾选状态经 applyOps 进会话树（UI 真实流程）。
    const node = firstItemNode(loaded);
    const select = (await app.handleRpc("applyOps", {
      ops: [
        {
          v: loaded.tree?.version,
          op: "set_node_states",
          changes: [{ key: node?.key, selected: true }],
        },
      ],
    })) as AppliedOpsReport;
    expect(select.applied).toBe(1);

    await app.handleRpc("run");
    await waitUntil(() => calls.length > 0, "java runner dispatched");
    const cancelled = (await app.handleRpc("cancel")) as { state: string };
    expect(["before_hooks", "converting", "after_hooks", "cancelled"]).toContain(cancelled.state);
    await waitUntil(
      () => events.some((e) => e.type === "state_change" && e.state === "cancelled"),
      "cancelled state",
    );
    expect(calls[0]?.signal?.aborted).toBe(true);

    // 第二轮：reset 在活动运行中 → cancelledRun=true，会话重新武装可再跑。
    impl = hangingRunner(calls);
    await app.handleRpc("run");
    await waitUntil(() => calls.length > 1, "second run dispatched");
    const reset = (await app.handleRpc("reset")) as { cancelledRun: boolean };
    expect(reset.cancelledRun).toBe(true);
    expect((await snapshot(app)).state).toBe("ready");

    impl = okRunner(calls);
    const rerun = (await app.handleRpc("run")) as { runSeq: number };
    expect(rerun.runSeq).toBe(3);
    await waitUntil(() => events.filter((e) => e.type === "run_end").length >= 3, "run_end x3");
    const last = events.filter((e) => e.type === "run_end").at(-1);
    if (last?.type !== "run_end") throw new Error("run_end missing");
    expect(last.summary.state).toBe("succeeded");
  });

  it("错误码：未知方法/坏参数/未加载即 run 或 reload/配置解析失败", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    await expectRpcError(app.handleRpc("nope"), "UNKNOWN_METHOD");
    await expectRpcError(app.handleRpc("loadConfig", {}), "INVALID_PARAMS");
    await expectRpcError(app.handleRpc("loadConfig", { path: 123 }), "INVALID_PARAMS");
    await expectRpcError(app.handleRpc("applyOps", { ops: "x" }), "INVALID_PARAMS");
    await expectRpcError(
      app.handleRpc("respondDialog", { token: "t", choice: "maybe" }),
      "INVALID_PARAMS",
    );
    await expectRpcError(app.handleRpc("run"), "INVALID_STATE");
    await expectRpcError(app.handleRpc("reload"), "INVALID_STATE");
    await expectRpcError(
      app.handleRpc("loadConfig", { path: fixture("no-such-file.xml") }),
      "CONFIG_ERROR",
    );
  });

  it("updateSettings：未加载配置 INVALID_STATE；白名单/类型校验 INVALID_PARAMS", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    // 未加载配置
    await expectRpcError(app.handleRpc("updateSettings", { fields: {} }), "INVALID_STATE");
    await expectRpcError(app.handleRpc("preview"), "INVALID_STATE");

    await app.handleRpc("loadConfig", { path: fixture("run-mirror.xml") });
    // fields 结构错误
    await expectRpcError(app.handleRpc("updateSettings", {}), "INVALID_PARAMS");
    await expectRpcError(app.handleRpc("updateSettings", { fields: [] }), "INVALID_PARAMS");
    // 未知键
    await expectRpcError(
      app.handleRpc("updateSettings", { fields: { nope: "x" } }),
      "INVALID_PARAMS",
    );
    // 标量字段错类型
    await expectRpcError(
      app.handleRpc("updateSettings", { fields: { workDir: 123 } }),
      "INVALID_PARAMS",
    );
    // 多值字段错类型（含旧版 JSON 串编码形态——不复活）
    await expectRpcError(
      app.handleRpc("updateSettings", { fields: { protoFile: '["a.pb"]' } }),
      "INVALID_PARAMS",
    );
    await expectRpcError(
      app.handleRpc("updateSettings", { fields: { dataSrcDir: [123] } }),
      "INVALID_PARAMS",
    );
    // matrix 错类型 / 规则错类型 / 规则未知键 / 规则字段错类型
    await expectRpcError(
      app.handleRpc("updateSettings", { fields: { matrix: "x" } }),
      "INVALID_PARAMS",
    );
    await expectRpcError(
      app.handleRpc("updateSettings", { fields: { matrix: ["x"] } }),
      "INVALID_PARAMS",
    );
    await expectRpcError(
      app.handleRpc("updateSettings", { fields: { matrix: [{ bogus: 1 }] } }),
      "INVALID_PARAMS",
    );
    await expectRpcError(
      app.handleRpc("updateSettings", { fields: { matrix: [{ tags: "server" }] } }),
      "INVALID_PARAMS",
    );
  });

  it("updateSettings：合并写入返回有效值；快照回填 settings；reload 后清空", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    const loaded = (await app.handleRpc("loadConfig", {
      path: fixture("run-mirror.xml"),
    })) as BackendSnapshot;
    // 快照携带 settings：无覆盖时 effective 全量回退配置默认。
    expect(loaded.settings.overrides).toEqual({});
    expect(loaded.settings.effective?.xresloaderPath).toBe("run-mirror.xml");
    expect(loaded.settings.effective?.type).toBe("bin");
    expect(loaded.settings.effective?.proto).toBe("");

    const updated = (await app.handleRpc("updateSettings", {
      fields: {
        workDir: "sub",
        outputDir: "ui-out",
        proto: "capnproto",
        protoFile: ["x.pb", "y.pb"],
        dataSrcDir: [],
      },
    })) as SettingsView;
    const configDir = path.dirname(fixture("run-mirror.xml"));
    expect(updated.overrides.outputDir).toBe("ui-out");
    expect(updated.effective?.workDir).toBe(path.resolve(configDir, "sub"));
    expect(updated.effective?.proto).toBe("capnproto");
    expect(updated.effective?.protoFile).toEqual(["x.pb", "y.pb"]);
    expect(updated.effective?.dataSrcDir).toEqual([]); // 空数组 = 清空生效
    expect(updated.effective?.matrix).toEqual([]); // 未覆盖字段回退配置

    // 合并语义：第二次只改 proto，其余覆盖保留。
    const merged = (await app.handleRpc("updateSettings", {
      fields: { proto: "protobuf" },
    })) as SettingsView;
    expect(merged.effective?.proto).toBe("protobuf");
    expect(merged.effective?.outputDir).toBe("ui-out");

    const snap = await snapshot(app);
    expect(snap.settings.overrides.proto).toBe("protobuf");
    expect(snap.settings.effective?.outputDir).toBe("ui-out");

    // reload 成功 → overrides 清空，表单随配置重填。
    const reloaded = (await app.handleRpc("reload")) as BackendSnapshot;
    expect(reloaded.settings.overrides).toEqual({});
    expect(reloaded.settings.effective?.proto).toBe("");
  });

  it("updateSettings：matrix 覆盖触发会话树矩阵资格重估（内容推导 multiSelected）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    const loaded = (await app.handleRpc("loadConfig", {
      path: fixture("run-mirror.xml"),
    })) as BackendSnapshot;
    const version = loaded.tree?.version ?? 0;
    // 先全选（两个 item 均无限定标签）。
    const selected = (await app.handleRpc("applyOps", {
      ops: [{ v: version, op: "select_all" }],
    })) as AppliedOpsReport;
    expect(selected.applied).toBe(1);
    expect((await snapshot(app)).selectedItems).toHaveLength(2);

    // 覆盖为带限定的单规则矩阵 → 矩阵模式；两个 item 均不匹配 → 取消勾选且禁止勾选。
    const updated = (await app.handleRpc("updateSettings", {
      fields: { matrix: [{ type: "lua", tags: ["server"], classes: [] }] },
    })) as SettingsView;
    expect(updated.effective?.matrix).toHaveLength(1);
    const snap = await snapshot(app);
    expect(snap.selectedItems).toEqual([]);
    const nodes = snap.tree?.nodes ?? [];
    expect(nodes).toHaveLength(2);
    expect(nodes.every((node) => node.unselectable)).toBe(true);
  });

  it("updateSettings：运行中拒绝（INVALID_STATE）", { timeout: TEST_TIMEOUT_MS }, async () => {
    const calls: JavaBatchOptions[] = [];
    const { app, events } = makeApp({ runner: hangingRunner(calls) });
    const loaded = (await app.handleRpc("loadConfig", {
      path: fixture("run-hooks.xml"),
    })) as BackendSnapshot;
    const node = firstItemNode(loaded);
    await app.handleRpc("applyOps", {
      ops: [
        {
          v: loaded.tree?.version,
          op: "set_node_states",
          changes: [{ key: node?.key, selected: true }],
        },
      ],
    });
    await app.handleRpc("run");
    await waitUntil(() => calls.length > 0, "java runner dispatched");
    await expectRpcError(
      app.handleRpc("updateSettings", { fields: { outputDir: "x" } }),
      "INVALID_STATE",
    );
    await app.handleRpc("cancel");
    await waitUntil(
      () => events.some((e) => e.type === "state_change" && e.state === "cancelled"),
      "cancelled state",
    );
  });

  it("preview：jar 缺失 → XRESLOADER_NOT_FOUND（code 透传 + details 可读串）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    await app.handleRpc("loadConfig", { path: fixture("set-name.xml") });
    await expectRpcError(app.handleRpc("preview"), "XRESLOADER_NOT_FOUND");
    const err = await app.handleRpc("preview").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain("not exists");
    expect(message).toContain("https://github.com/xresloader/xresloader/releases");
    expect(message).toContain("workDir="); // PlanBuildError details 进 message
  });

  it("preview：当前选择 + 当前覆盖出计划；单选无冲突、display 非空", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    const loaded = (await app.handleRpc("loadConfig", {
      path: fixture("run-mirror.xml"),
    })) as BackendSnapshot;
    const node = firstItemNode(loaded);
    await app.handleRpc("applyOps", {
      ops: [{ v: loaded.tree?.version, op: "select_node", key: node?.key, selected: true }],
    });
    await app.handleRpc("updateSettings", { fields: { type: "lua", outputDir: "ui-out" } });
    const preview = (await app.handleRpc("preview")) as PreviewResult;
    expect(preview.selectionCount).toBe(1);
    expect(preview.plan.taskCount).toBe(1);
    expect(preview.plan.workDir).toBe(path.dirname(fixture("run-mirror.xml")));
    expect(preview.plan.xresloaderPath).toBe("run-mirror.xml");
    const task = preview.plan.tasks[0];
    expect(task?.display.length).toBeGreaterThan(0);
    expect(task?.display).toContain('-t "lua"');
    expect(task?.display).toContain('-o "ui-out"');
    expect(task?.itemKey).toBe(node?.title);
    expect(task?.outputDir).toBe("ui-out");
    expect(preview.conflicts).toEqual([]);
  });

  it("preview：两 item 同 outputDir+rename 检出输出冲突（UI04）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const { app } = makeApp();
    const loaded = (await app.handleRpc("loadConfig", {
      path: fixture("preview-conflict.xml"),
    })) as BackendSnapshot;
    const selected = (await app.handleRpc("applyOps", {
      ops: [{ v: loaded.tree?.version, op: "select_all" }],
    })) as AppliedOpsReport;
    expect(selected.applied).toBe(1);
    const preview = (await app.handleRpc("preview")) as PreviewResult;
    expect(preview.selectionCount).toBe(2);
    expect(preview.plan.taskCount).toBe(2);
    expect(preview.conflicts).toEqual([
      { outputDir: "same-out", rename: "/(?i)\\.bin$/.lua/", items: ["one", "two"] },
    ]);
  });

  it("run：缺省使用会话持有的 overrides（fake runner 断言行内容）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const calls: JavaBatchOptions[] = [];
    const { app, events } = makeApp({ runner: okRunner(calls) });
    const loaded = (await app.handleRpc("loadConfig", {
      path: fixture("run-hooks.xml"),
    })) as BackendSnapshot;
    const node = firstItemNode(loaded);
    await app.handleRpc("applyOps", {
      ops: [{ v: loaded.tree?.version, op: "select_node", key: node?.key, selected: true }],
    });
    // 配置 proto=protobuf；覆盖为 capnproto + 其余字段。
    await app.handleRpc("updateSettings", {
      fields: { proto: "capnproto", dataVersion: "9.9.9", outputDir: "stored-out", type: "lua" },
    });
    await app.handleRpc("run");
    await waitUntil(() => events.some((e) => e.type === "run_end"), "run_end event");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.workDir).toBe(path.dirname(fixture("run-hooks.xml")));
    const line = calls[0]?.tasks[0] ?? "";
    expect(line).toContain("-p capnproto");
    expect(line).not.toContain("protobuf");
    expect(line).toContain("-a 9.9.9");
    expect(line).toContain("-t lua");
    expect(line).toContain("-o stored-out");
  });
});
