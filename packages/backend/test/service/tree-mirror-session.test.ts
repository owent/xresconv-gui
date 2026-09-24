/**
 * P2-05 端到端：事件 hook 经 NodeMirror 改动选择/字段，ops 回流会话树状态，
 * 后续 hook 看到更新后的选择；计划仍按 run 开始时的选择冻结（旧版 conv_start
 * 快照语义），但 item 字段改写对计划可见（活引用语义）。
 */

import type { JavaBatchOptions, JavaBatchResult, ScriptWorkerPool } from "@xresconv/guardian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flattenTreeItems } from "../../src/domain/selection.ts";
import { ConversionSession } from "../../src/service/session.ts";
import { fixture, startPool, TEST_TIMEOUT_MS } from "./helpers.ts";

function okRunner(calls: JavaBatchOptions[]) {
  return async (options: JavaBatchOptions): Promise<JavaBatchResult> => {
    calls.push(options);
    return { exitCode: 0, signal: null, failedTaskCount: 0, durationMs: 1 };
  };
}

function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${label} to be present`);
  }
  return value;
}

describe("session tree mirror (P2-05)", () => {
  let pool: ScriptWorkerPool;

  beforeAll(async () => {
    pool = await startPool();
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await pool.shutdown();
  }, TEST_TIMEOUT_MS);

  it("hook1 的镜像 ops 回流后 hook2 看到新选择；计划在 run 开始冻结、字段改写可见", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const calls: JavaBatchOptions[] = [];
    const session = new ConversionSession({ pool, runner: okRunner(calls) });
    const config = await session.loadConfig(fixture("run-mirror.xml"));
    const items = flattenTreeItems(config.tree);

    // 加载后默认无勾选；缺省 selection 从树状态派生 → 空选择、0 任务、不 spawn java
    expect(session.getSelectedItems()).toEqual([]);
    const emptyRun = await session.runConversion(undefined);
    expect(emptyRun.taskCount).toBe(0);
    expect(calls.length).toBe(0);

    // 模拟 UI 勾选 one 后运行：hook1 改 desc + 取消勾选 → hook2 应看到空选择
    const logBaseline = session.pipeline.snapshot().length;
    const first = must(items[0], "first item");
    const summary = await session.runConversion({ items: [first] });
    await session.pipeline.drain();
    expect(summary.state).toBe("succeeded");
    // 计划按 run 开始的选择冻结：hook1 取消勾选不影响本次任务数（旧版快照语义）
    expect(summary.taskCount).toBe(1);
    expect(calls.length).toBe(1);
    // hook2 经由回流后的树快照看到空选择
    const messages = session.pipeline
      .snapshot()
      .slice(logBaseline)
      .map((entry) => entry.message);
    expect(messages).toContain("SECOND items=0 nodes=0");
    // ops 回流会话树：one 已不再选中；desc 改写落到共享 TreeItem（活引用语义）
    expect(session.getSelectedItems()).toEqual([]);
    expect(first.desc).toBe("patched-by-hook");
    // 下一份快照携带改动后的标题/状态与递增版本
    const snapshot = must(session.getTreeSnapshot(), "tree snapshot");
    expect(snapshot.version).toBeGreaterThan(1);
    expect(snapshot.nodes[0]?.selected).toBe(false);
    await session.dispose();
  });
});
