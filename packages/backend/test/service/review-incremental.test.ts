import { type JavaBatchResult, ScriptWorkerPool } from "@xresconv/guardian";
import { expect, it } from "vitest";
import {
  BackendRpcApp,
  type BackendSnapshot,
  type PreviewResult,
} from "../../src/service/rpc-app.ts";
import { ConversionSession } from "../../src/service/session.ts";
import type { AppliedOpsReport } from "../../src/service/tree-state.ts";
import { fixture } from "./helpers.ts";

it("rejects a new run until terminal log cleanup actually completes", async () => {
  const app = new BackendRpcApp({ pool: new ScriptWorkerPool() });
  const done = Promise.withResolvers<void>();
  let attempted: Promise<unknown> | undefined;
  app.onEvent((event) => {
    if (event.type === "state_change" && event.state === "succeeded" && attempted === undefined) {
      attempted = app.handleRpc("run").then(
        () => "accepted",
        (error: unknown) => error,
      );
    }
    if (event.type === "run_end") done.resolve();
  });
  try {
    await app.handleRpc("loadConfig", { path: fixture("run-mirror.xml") });
    await app.handleRpc("run");
    await done.promise;
    expect(await attempted).toMatchObject({ code: "INVALID_STATE" });
  } finally {
    await app.dispose();
  }
});

it("versions field edits and preserves custom script fields in detached snapshots", async () => {
  const pool = new ScriptWorkerPool();
  const session = new ConversionSession({ pool });
  try {
    await session.loadConfig(fixture("run-mirror.xml"));
    const version = session.getTreeSnapshot()?.version;
    const report = session.applyScriptOps([
      {
        v: version,
        op: "set_fields",
        target: "item_data",
        item_id: 1,
        fields: { custom: { value: "original" } },
      },
    ]);
    expect(report.version).toBeGreaterThan(version ?? 0);
    const item = session.getTreeSnapshot()?.nodes[0]?.item;
    expect(item?.custom).toEqual({ value: "original" });
    (item?.custom as { value: string }).value = "modified";
    expect(session.getTreeSnapshot()?.nodes[0]?.item?.custom).toEqual({ value: "original" });
  } finally {
    await session.dispose();
    await pool.shutdown();
  }
});

it("admits exactly one concurrent run RPC", async () => {
  const app = new BackendRpcApp({
    pool: new ScriptWorkerPool(),
    runner: (o) =>
      new Promise<JavaBatchResult>((resolve) => {
        o.signal?.addEventListener(
          "abort",
          () => resolve({ exitCode: 0, signal: null, failedTaskCount: 0, durationMs: 0 }),
          { once: true },
        );
      }),
  });
  try {
    await app.handleRpc("loadConfig", { path: fixture("run-mirror.xml") });
    const tree = app.snapshot().tree;
    await app.handleRpc("applyOps", { ops: [{ v: tree?.version, op: "select_all" }] });
    const results = await Promise.allSettled([app.handleRpc("run"), app.handleRpc("run")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "INVALID_STATE" },
    });
  } finally {
    await app.dispose();
  }
}, 15000);

it("rejects tree ops captured before reload even when keys are reused", async () => {
  const app = new BackendRpcApp({ pool: new ScriptWorkerPool() });
  try {
    const first = (await app.handleRpc("loadConfig", {
      path: fixture("run-mirror.xml"),
    })) as BackendSnapshot;
    await app.handleRpc("reload");
    const report = (await app.handleRpc("applyOps", {
      ops: [{ v: first.tree?.version, op: "select_all" }],
    })) as AppliedOpsReport;
    expect(report.applied).toBe(0);
    expect(report.rejected).toHaveLength(1);
    expect(app.snapshot().selectedItems).toEqual([]);
  } finally {
    await app.dispose();
  }
}, 15000);

it("rejected state patches do not partially mutate the tree", async () => {
  const app = new BackendRpcApp({ pool: new ScriptWorkerPool() });
  try {
    await app.handleRpc("loadConfig", { path: fixture("run-mirror.xml") });
    const tree = app.snapshot().tree;
    const report = (await app.handleRpc("applyOps", {
      ops: [
        {
          v: tree?.version,
          op: "set_node_states",
          changes: [
            { key: 1, selected: true, partsel: false },
            { key: "missing", selected: true, partsel: false },
          ],
        },
      ],
    })) as AppliedOpsReport;
    expect(report.rejected).toHaveLength(1);
    expect(app.snapshot().tree).toEqual(tree);
  } finally {
    await app.dispose();
  }
}, 15000);

it("releases matrix-disabled items when restrictions are removed", async () => {
  const app = new BackendRpcApp({ pool: new ScriptWorkerPool() });
  try {
    await app.handleRpc("loadConfig", { path: fixture("run-mirror.xml") });
    await app.handleRpc("updateSettings", {
      fields: { matrix: [{ type: "lua", tags: ["absent"], classes: [] }] },
    });
    expect(app.snapshot().tree?.nodes[0]?.unselectable).toBe(true);
    await app.handleRpc("updateSettings", { fields: { matrix: [] } });
    expect(app.snapshot().tree?.nodes[0]?.unselectable).toBe(false);
  } finally {
    await app.dispose();
  }
}, 15000);

it("does not expose mutable nested settings through input or output aliases", async () => {
  const pool = new ScriptWorkerPool();
  const session = new ConversionSession({ pool });
  try {
    await session.loadConfig(fixture("run-mirror.xml"));
    const input = { protoFile: ["fixed.pb"] };
    const effective = session.updateSettings(input);
    input.protoFile[0] = "changed-input.pb";
    effective.protoFile[0] = "changed-output.pb";
    session.getOverrides().protoFile?.push("extra.pb");
    expect(session.getEffectiveSettings()?.protoFile).toEqual(["fixed.pb"]);
  } finally {
    await session.dispose();
    await pool.shutdown();
  }
});

it("does not merge distinct preview conflict tuples containing spaces", async () => {
  const app = new BackendRpcApp({ pool: new ScriptWorkerPool() });
  try {
    await app.handleRpc("loadConfig", { path: fixture("run-mirror.xml") });
    await app.handleRpc("applyOps", {
      ops: [{ op: "select_all", v: app.snapshot().tree?.version }],
    });
    await app.handleRpc("updateSettings", {
      fields: {
        matrix: [
          { type: "lua", outputDir: "a b", rename: "c" },
          { type: "json", outputDir: "a", rename: "b c" },
        ],
      },
    });
    const preview = (await app.handleRpc("preview")) as PreviewResult;
    expect(preview.conflicts).toHaveLength(2);
  } finally {
    await app.dispose();
  }
}, 15000);
