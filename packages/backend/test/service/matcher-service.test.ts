/**
 * 隔离 matcher 服务（ 剩余，/ 匹配维度）：
 * 语义等价差分：exact/glob/regex/非法回退/空规则 × 输入，隔离结果与进程内
 *   buildMatchStringRule 逐对一致；
 * 灾难性 regex（ReDoS）：deadline 内失败（MatcherTimeoutError）、worker
 *   销毁补员、后续请求正常；挂起期间主进程事件循环与日志服务不受影响；
 * worker 中途死亡 → 在途请求确定失败 + 补员可用；
 * SelectionRuleService：by_schemes/by_sheets 与 resolveSelectorItems 逐例
 *   一致；超时规则 fail-closed + 诊断。
 *
 * 使用真实子进程；控制故障顺序的 fixture 显式确认请求已进入，外部截止只防挂起。
 */

import { buildMatchStringRule } from "@xresconv/compat-service";
import { afterAll, describe, expect, it } from "vitest";
import type { TreeItem } from "../../src/config/model.ts";
import { resolveSelectorItems } from "../../src/domain/selection.ts";
import { LogPipeline } from "../../src/service/log-pipeline.ts";
import {
  MatcherService,
  MatcherTimeoutError,
  MatcherWorkerExitError,
} from "../../src/service/matcher-service.ts";
import { resolveSelectorItemsIsolated } from "../../src/service/selection-rule-service.ts";
import { fixture, TEST_TIMEOUT_MS } from "./helpers.ts";

const services: MatcherService[] = [];

function makeService(options: ConstructorParameters<typeof MatcherService>[0] = {}) {
  const service = new MatcherService(options);
  services.push(service);
  return service;
}

afterAll(async () => {
  await Promise.all(services.splice(0).map((service) => service.shutdown()));
});

/** ReDoS 经典样本：嵌套量词 + 长非匹配输入。 */
const REDOS_RULE = "regex:^(a+)+$";
const REDOS_INPUT = `${"a".repeat(35)}!`;

function makeItem(overrides: Partial<TreeItem>): TreeItem {
  return {
    name: "item",
    desc: "",
    options: [],
    schemeData: {},
    tags: [],
    classes: [],
    ...overrides,
  };
}

describe("MatcherService 隔离求值", () => {
  it("语义等价差分：exact/glob/regex/非法回退/空规则逐对一致", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const service = makeService();
    await service.start();
    const cases: Array<{ rule: string; inputs: string[] }> = [
      { rule: "exact-name", inputs: ["exact-name", "exact-name2", ""] },
      { rule: "glob:**/*.xlsx", inputs: ["a/b/c.xlsx", "a/b/c.xls", "c.xlsx"] },
      { rule: "regex:^kind_\\d+$", inputs: ["kind_1", "kind_x", "xkind_1"] },
      { rule: "regex:([", inputs: ["regex:([", "other"] }, // 非法 → 回退精确匹配
      { rule: "", inputs: ["", "x"] }, // 空规则只中空输入
      { rule: "ReGeX:^Case$", inputs: ["Case", "case"] }, // 前缀大小写不敏感
    ];
    for (const { rule, inputs } of cases) {
      const isolated = await service.matchBatch(rule, inputs);
      const fn = buildMatchStringRule(rule);
      const expected = inputs.map((input) => fn(input));
      expect(isolated).toEqual(expected);
    }
    await service.shutdown();
  });

  it("灾难性 regex：deadline 内 MatcherTimeoutError、worker 销毁补员、后续请求正常", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const diags: string[] = [];
    const service = makeService({ deadlineMs: 800, onDiag: (m) => diags.push(m) });
    await service.start();
    const oldPid = service.stats().pid;
    await expect(service.matchBatch(REDOS_RULE, [REDOS_INPUT])).rejects.toBeInstanceOf(
      MatcherTimeoutError,
    );
    const after = await service.matchBatch("exact", ["exact", "nope"]);
    expect(after).toEqual([true, false]);
    expect(service.stats().pid).not.toBe(oldPid);
    expect(diags.some((m) => m.includes("timed out"))).toBe(true);
    await service.shutdown();
  });

  it("挂起期间主进程事件循环/日志服务不被阻塞（不能阻塞日志服务）", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const entered = Promise.withResolvers<void>();
    const service = makeService({
      workerEntry: fixture("controlled-matcher.mjs"),
      deadlineMs: TEST_TIMEOUT_MS,
      onDiag: (message) => {
        if (message.includes("MATCH_STARTED")) entered.resolve();
      },
    });
    await service.start();
    const pipeline = new LogPipeline();
    const outcome = service.matchBatch("hold", ["input"]).catch((error: unknown) => error);
    try {
      await entered.promise;
      for (let i = 0; i < 5; i++) await pipeline.info(`tick ${i}`, "TEST");
      await pipeline.drain();
      expect(pipeline.snapshot().map((entry) => entry.message)).toEqual([
        "tick 0",
        "tick 1",
        "tick 2",
        "tick 3",
        "tick 4",
      ]);
      // worker 仍在执行；日志完成由 drain 确认，不比较耗时或 tick 次数。
      expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe("pending");
    } finally {
      await service.shutdown();
    }
    expect(await outcome).toBeInstanceOf(MatcherWorkerExitError);
  });

  it("worker 中途死亡：在途请求确定失败（MatcherWorkerExitError）+ 补员可用", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const entered = Promise.withResolvers<void>();
    const service = makeService({
      workerEntry: fixture("controlled-matcher.mjs"),
      deadlineMs: TEST_TIMEOUT_MS,
      onDiag: (message) => {
        if (message.includes("MATCH_STARTED")) entered.resolve();
      },
    });
    await service.start();
    const pid = service.stats().pid;
    expect(pid).toBeDefined();
    const inFlight = service.matchBatch("hold", ["input"]).catch((error: unknown) => error);
    await entered.promise;
    process.kill(pid as number, "SIGKILL");
    expect(await inFlight).toBeInstanceOf(MatcherWorkerExitError);
    expect(await service.matchBatch("exact", ["exact", "other"])).toEqual([true, false]);
    expect(service.stats().pid).not.toBe(pid);
    await service.shutdown();
  });
});

describe("SelectionRuleService 隔离选择器", () => {
  it("by_schemes/by_sheets 与 resolveSelectorItems 逐例一致", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const service = makeService();
    await service.start();
    const items: TreeItem[] = [
      makeItem({ name: "a", file: "proto/a.pb", scheme: "DataSource" }),
      makeItem({ name: "b", file: "proto/b.pb", scheme: "Other" }),
      makeItem({ name: "c", schemeData: { DataSource: ["data/c.xlsx|Sheet1|1,1"] } }),
      makeItem({ name: "d", schemeData: { DataSource: ["data/d.xlsx|List|1,1", "x|y"] } }),
      makeItem({ name: "e" }), // 无 file/scheme/DataSource：不参与任何匹配
    ];
    const selectors = [
      { name: "s1", by_schemes: [{ file: "glob:proto/*.pb", scheme: "regex:^Data" }] },
      { name: "s2", by_schemes: [{ file: "glob:proto/*.pb" }] }, // scheme 缺省任意中
      { name: "s3", by_sheets: [{ file: "glob:**/*.xlsx", sheet: "Sheet1" }] },
      { name: "s4", by_sheets: [{ file: "glob:**/*.xlsx" }] }, // sheet 缺省任意命中
      { name: "s5", by_schemes: [{ file: "regex:([" }] }, // 非法规则回退精确匹配
      { name: "s6", by_schemes: [{ file: "never", scheme: "regex:^Data" }] }, // file 不中
    ];
    for (const selector of selectors) {
      const expected = resolveSelectorItems(selector, items);
      const isolated = await resolveSelectorItemsIsolated(service, selector, items);
      expect(isolated.map((item) => item.name)).toEqual(expected.map((item) => item.name));
    }
    await service.shutdown();
  });

  it("超时规则 fail-closed + 诊断，其余规则不受影响", {
    timeout: TEST_TIMEOUT_MS,
  }, async () => {
    const diags: string[] = [];
    const service = makeService({ deadlineMs: 800 });
    await service.start();
    const items: TreeItem[] = [
      // 长输入 + 灾难规则才会挂死求值（ReDoS 需要足够长的非匹配前缀）。
      makeItem({ name: "a", file: REDOS_INPUT, scheme: "DataSource" }),
      makeItem({ name: "b", file: "keep", scheme: "DataSource" }),
    ];
    const selector = {
      name: "mixed",
      by_schemes: [
        { file: REDOS_RULE }, // file 规则灾难 → 该规则 fail-closed
        { file: "keep" }, // 正常规则仍命中 b
      ],
    };
    const isolated = await resolveSelectorItemsIsolated(service, selector, items, {
      log: (m) => diags.push(m),
    });
    expect(isolated.map((item) => item.name)).toEqual(["b"]);
    expect(diags.some((m) => m.includes("matcher timeout"))).toBe(true);
    await service.shutdown();
  });
});
