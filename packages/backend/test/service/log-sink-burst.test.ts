import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createLog4jsSink, LogPipeline } from "../../src/service/log-pipeline.ts";

it.each([1, 2, 3])(
  "persists startup burst %i larger than 128 records, in exact order",
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xresconv-burst-"));
    const file = path.join(dir, "burst.log");
    const config = path.join(dir, "log4js.json");
    writeFileSync(
      config,
      JSON.stringify({
        appenders: {
          file: { type: "file", filename: file, layout: { type: "pattern", pattern: "%m" } },
        },
        categories: { default: { appenders: ["file"], level: "debug" } },
      }),
    );
    const diagnostics: string[] = [];
    const sink = createLog4jsSink({
      configurePath: config,
      onDiagnostic: (m) => diagnostics.push(m),
    });
    const pipeline = new LogPipeline({ capacity: 10000 });
    pipeline.addSink((entry) => sink.append(entry));
    const expected = Array.from({ length: 5000 }, (_, i) => `[BURST]: 消息-${i}`);
    try {
      await Promise.all(expected.map((_, i) => pipeline.info(`消息-${i}`, "BURST")));
      await pipeline.drain();
      await sink.shutdown(10000);
      expect(diagnostics).toEqual([]);
      expect(readFileSync(file, "utf8").trimEnd().split(/\r?\n/)).toEqual(expected);
    } finally {
      await sink.shutdown().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  },
  15000,
);
