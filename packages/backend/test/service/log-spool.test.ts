import { existsSync, readFileSync, rmSync } from "node:fs";
import { encodeFrame, FrameDecoder } from "@xresconv/ipc";
import { expect, it } from "vitest";
import { LogPipeline } from "../../src/service/log-pipeline.ts";
import { LogSpool } from "../../src/service/log-spool.ts";

it("bounds batches by count and bytes, preserving appends made before acknowledgement", async () => {
  const spool = new LogSpool();
  const pipeline = new LogPipeline();
  const small = await pipeline.info("small");
  const large = await pipeline.info("汉".repeat(25000));
  try {
    for (let i = 0; i < 130; i++) spool.append(encodeFrame({ ...small, seq: i }));
    expect(spool.takeBatch().map((e) => e.seq)).toEqual(Array.from({ length: 64 }, (_, i) => i));
    expect(spool.takeBatch()).toHaveLength(64);
    expect(spool.takeBatch()).toHaveLength(2);
    spool.append(encodeFrame(large));
    spool.resetIfEmpty(); // An append during an in-flight request must prevent truncation.
    expect(spool.takeBatch()).toEqual([large]);
    spool.resetIfEmpty();
    expect(readFileSync(spool.file)).toHaveLength(0);
    for (let i = 0; i < 20; i++) spool.append(encodeFrame({ ...large, seq: i }));
    const received = [];
    while (!spool.empty) {
      const batch = spool.takeBatch();
      expect(batch.length).toBeLessThan(64);
      expect(batch.reduce((n, entry) => n + encodeFrame(entry).length - 4, 0)).toBeLessThanOrEqual(
        1024 * 1024,
      );
      received.push(...batch.map((e) => e.seq));
    }
    expect(received).toEqual(Array.from({ length: 20 }, (_, i) => i));
  } finally {
    spool.close(false);
  }
  expect(existsSync(spool.directory)).toBe(false);
});

it("preserves unconfirmed frames on failure and closes idempotently", async () => {
  const spool = new LogSpool();
  const entry = await new LogPipeline().error("recover me");
  spool.append(encodeFrame(entry));
  spool.takeBatch(); // No worker acknowledgement.
  spool.close(true);
  spool.close(false);
  try {
    const records: unknown[] = [];
    new FrameDecoder(
      (value) => records.push(value),
      (error) => {
        throw error;
      },
    ).push(readFileSync(spool.file));
    expect(records).toEqual([entry]);
  } finally {
    rmSync(spool.directory, { recursive: true, force: true });
  }
});
