import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { writeFrame } from "../src/index.ts";

describe("frame write lifecycle", () => {
  it("reports asynchronous write errors even below the high water mark", async () => {
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        setImmediate(() => callback(new Error("broken pipe")));
      },
    });
    stream.on("error", () => {});
    await expect(writeFrame(stream, { small: true })).rejects.toThrow("broken pipe");
  });

  it("rejects a closed backpressured stream and removes temporary listeners", async () => {
    const stream = new PassThrough({ highWaterMark: 1 });
    const pending = writeFrame(stream, { value: "pending" });
    const outcome = pending.then(
      () => "resolved",
      () => "rejected",
    );
    stream.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    expect(await Promise.race([outcome, Promise.resolve("still pending")])).toBe("rejected");
    expect(stream.listenerCount("drain")).toBe(0);
    expect(stream.listenerCount("error")).toBe(0);
    expect(stream.listenerCount("close")).toBe(0);
  });

  it("does not accumulate error listeners over repeated backpressured writes", async () => {
    const stream = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        setImmediate(callback);
      },
    });
    for (let i = 0; i < 20; i++) await writeFrame(stream, { i });
    expect(stream.listenerCount("error")).toBe(0);
    expect(stream.listenerCount("drain")).toBe(0);
    stream.end();
  });
});
