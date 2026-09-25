/**
 * LogPipeline 单元测试（P2-08 backend 侧）+ log4js 落盘用例。
 *
 * 语义锚点：main.js:166-330（级别→样式、`[module]: message` 渲染、Error 重路由）、
 * main.js:841-859（log4js 配置与回退）、BD-O10（有界队列溢出策略）。
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createLog4jsSink, type LogEntry, LogPipeline } from "../../src/service/log-pipeline.ts";

const tmpRoots: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xresconv-log-"));
  tmpRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("LogPipeline", () => {
  it("级别→样式映射与 [module]: message 渲染（main.js:245/263/283/304、216-226）", async () => {
    const pipeline = new LogPipeline();
    const info = await pipeline.info("i", "M");
    const notice = await pipeline.notice("n", "M");
    const warning = await pipeline.warning("w", "M");
    const error = await pipeline.error("e", "M");
    expect(info.style).toBe("alert-secondary");
    expect(notice.style).toBe("alert-primary");
    expect(warning.style).toBe("alert-warning");
    expect(error.style).toBe("alert-danger");
    expect(info.text).toBe("[M]: i");
    const noModule = await pipeline.info("plain");
    expect(noModule.text).toBe("plain");
  });

  it("Error 实例一律重路由 error 并取 stack（main.js:238-244）", async () => {
    const pipeline = new LogPipeline();
    const entry = await pipeline.notice(new Error("boom"), "M");
    expect(entry.level).toBe("error");
    expect(entry.style).toBe("alert-danger");
    expect(entry.message).toContain("boom");
  });

  it("有界队列：溢出丢弃最老、droppedCount 累计、直发 LOG 诊断（BD-O10）", async () => {
    const pipeline = new LogPipeline({ capacity: 3 });
    const seen: LogEntry[] = [];
    pipeline.subscribe((entry) => seen.push(entry));
    for (let i = 0; i < 5; i++) {
      await pipeline.info(`m${i}`, "T");
    }
    expect(pipeline.snapshot().map((entry) => entry.message)).toEqual(["m2", "m3", "m4"]);
    expect(pipeline.droppedCount).toBe(2);
    // 监听器看到 5 条业务 + 2 条溢出诊断；诊断不进队列。
    expect(seen.length).toBe(7);
    const diagnostics = seen.filter((entry) => entry.moduleName === "LOG");
    expect(diagnostics.length).toBe(2);
    expect(diagnostics[0]?.level).toBe("warning");
  });

  it("队列条目带单调 seq；订阅事件与 getRecent 一致（P4-07 UI 游标去重依据）", async () => {
    const pipeline = new LogPipeline({ capacity: 4 });
    const seen: LogEntry[] = [];
    pipeline.subscribe((entry) => seen.push(entry));
    for (let i = 0; i < 6; i++) {
      await pipeline.info(`m${i}`, "T");
    }
    const queued = pipeline.snapshot();
    expect(queued.map((entry) => entry.seq)).toEqual([3, 4, 5, 6]);
    // 订阅侧业务条目（非 LOG 诊断）的 seq 与队列一致。
    const business = seen.filter((entry) => entry.moduleName === "T");
    expect(business.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    // 直发溢出诊断不占 seq（不进队列，无从游标）。
    const diagnostics = seen.filter((entry) => entry.moduleName === "LOG");
    expect(diagnostics.every((entry) => entry.seq === undefined)).toBe(true);
  });

  it("getRecent(limit)：返回最新 limit 条；limit 缺省全量、越界夹取（P4-07）", async () => {
    const pipeline = new LogPipeline({ capacity: 5 });
    for (let i = 0; i < 5; i++) {
      await pipeline.info(`m${i}`, "T");
    }
    expect(pipeline.getRecent(2).map((entry) => entry.message)).toEqual(["m3", "m4"]);
    expect(pipeline.getRecent()).toHaveLength(5);
    expect(pipeline.getRecent(100).map((entry) => entry.message)).toEqual([
      "m0",
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
    expect(pipeline.getRecent(0)).toEqual([]);
  });

  it("getRecentBefore(beforeSeq, limit)：返回 seq < beforeSeq 的最新 limit 条（滚动加载历史）", async () => {
    const pipeline = new LogPipeline({ capacity: 10 });
    for (let i = 0; i < 10; i++) {
      await pipeline.info(`m${i}`, "T");
    }
    // seq 1..10；before=8 → 候选 seq 1..7，取最新 3 条 = seq 5..7。
    expect(pipeline.getRecentBefore(8, 3).map((entry) => entry.seq)).toEqual([5, 6, 7]);
    // limit 超过候选数 → 全部候选。
    expect(pipeline.getRecentBefore(4, 100).map((entry) => entry.seq)).toEqual([1, 2, 3]);
    // before <= 最早 seq → 空。
    expect(pipeline.getRecentBefore(1, 3)).toEqual([]);
  });
});

describe("log4js sink", () => {
  it("keeps concurrent session configurations and shutdowns independent", async () => {
    const dir = makeTmpDir();
    const entries = await Promise.all([
      new LogPipeline().info("first-session"),
      new LogPipeline().info("second-session"),
    ]);
    const sinks = ["first", "second"].map((name) => {
      const file = path.join(dir, `${name}.log`);
      const config = path.join(dir, `${name}.json`);
      writeFileSync(
        config,
        JSON.stringify({
          appenders: { file: { type: "file", filename: file } },
          categories: { default: { appenders: ["file"], level: "debug" } },
        }),
      );
      return { file, sink: createLog4jsSink({ configurePath: config }) };
    });
    const first = sinks[0];
    const second = sinks[1];
    const entry1 = entries[0];
    const entry2 = entries[1];
    if (!first || !second || !entry1 || !entry2) throw new Error("missing fixture");
    try {
      first.sink.append(entry1);
      await first.sink.shutdown();
      second.sink.append(entry2);
      await second.sink.shutdown();
      expect(readFileSync(first.file, "utf8")).toContain("first-session");
      expect(readFileSync(first.file, "utf8")).not.toContain("second-session");
      expect(readFileSync(second.file, "utf8")).toContain("second-session");
      expect(readFileSync(second.file, "utf8")).not.toContain("first-session");
    } finally {
      await Promise.allSettled(sinks.map(({ sink }) => sink.shutdown()));
    }
  });

  it("a stuck custom appender cannot block the caller event loop", () => {
    const dir = makeTmpDir();
    const appender = path.join(dir, "stuck.cjs");
    writeFileSync(appender, "exports.configure = () => { while (true) {} };\n");
    const configPath = path.join(dir, "log4js.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        appenders: { custom: { type: appender } },
        categories: { default: { appenders: ["custom"], level: "debug" } },
      }),
    );
    const code = `import { createLog4jsSink } from '@xresconv/backend';
      const sink = createLog4jsSink({ configurePath: ${JSON.stringify(configPath)} });
      setTimeout(() => console.log('responsive'), 20);
      await sink.shutdown(500).catch(() => {});`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
      timeout: 3000,
    });
    expect(result.stdout).toContain("responsive");
    expect(result.status, result.stderr).toBe(0);
  }, 10000);
  it("文件 appender 落盘：级别映射与 [module]: message 文本，shutdown 前 flush", async () => {
    const dir = makeTmpDir();
    const logFile = path.join(dir, "app.log");
    const configPath = path.join(dir, "log4js.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        appenders: { file: { type: "file", filename: logFile } },
        categories: { default: { appenders: ["file"], level: "debug" } },
      }),
    );
    const sink = createLog4jsSink({ configurePath: configPath });
    expect(sink.diagnostic).toBeNull();

    const pipeline = new LogPipeline();
    pipeline.addSink((entry) => sink.append(entry));
    await pipeline.info("hello-log4js", "M");
    await pipeline.warning("warn-log4js", "M");
    await sink.shutdown();

    const content = readFileSync(logFile, "utf8");
    expect(content).toContain("[M]: hello-log4js");
    expect(content).toContain("[M]: warn-log4js");
    expect(content).toContain("WARN");
  });

  it("自定义配置失败 → 回退默认 src/log4js.json 并记诊断（main.js:844-854）", async () => {
    const dir = makeTmpDir();
    const sink = createLog4jsSink({ configurePath: path.join(dir, "missing.json") });
    expect(sink.diagnostic).not.toBeNull();
    expect(sink.diagnostic).toContain("falling back");
    // 回退成功 → sink 可用（默认配置写 cwd 文件，此处只验证不抛，不 append 避免落文件）。
    await sink.shutdown();
  });
});
