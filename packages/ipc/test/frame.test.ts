import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { encodeFrame, FrameCodecError, FrameDecoder, writeFrame } from "../src/index.ts";

describe("encodeFrame", () => {
  it("round-trips a JSON value with the length prefix", () => {
    const frame = encodeFrame({ hello: "世界" });
    expect(frame.readUInt32BE(0)).toBe(frame.length - 4);
    expect(JSON.parse(frame.subarray(4).toString("utf8"))).toEqual({ hello: "世界" });
  });

  it("rejects payloads over the byte budget", () => {
    const big = { data: "x".repeat(2048) };
    expect(() => encodeFrame(big, 1024)).toThrowError(FrameCodecError);
  });
});

describe("FrameDecoder", () => {
  function collect(maxBytes?: number) {
    const frames: unknown[] = [];
    const errors: FrameCodecError[] = [];
    const decoder = new FrameDecoder(
      (v) => frames.push(v),
      (e) => errors.push(e),
      ...(maxBytes === undefined ? [] : [maxBytes]),
    );
    return { frames, errors, decoder };
  }

  it("decodes multiple frames delivered in one chunk", () => {
    const { frames, errors, decoder } = collect();
    decoder.push(Buffer.concat([encodeFrame({ a: 1 }), encodeFrame({ b: 2 })]));
    expect(errors).toEqual([]);
    expect(frames).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("decodes a frame delivered byte by byte", () => {
    const { frames, errors, decoder } = collect();
    const frame = encodeFrame({ split: "across chunks", n: 42 });
    for (const byte of frame) {
      decoder.push(Buffer.from([byte]));
    }
    expect(errors).toEqual([]);
    expect(frames).toEqual([{ split: "across chunks", n: 42 }]);
  });

  it("rejects an oversized declared length before the body arrives", () => {
    const { frames, errors, decoder } = collect(16);
    const head = Buffer.allocUnsafe(4);
    head.writeUInt32BE(17, 0);
    decoder.push(head); // only the header; body never sent
    expect(frames).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("TOO_LARGE");
  });

  it("poisons the channel on invalid JSON and ignores later frames", () => {
    const { frames, errors, decoder } = collect();
    const bad = Buffer.allocUnsafe(4);
    bad.writeUInt32BE(3, 0);
    decoder.push(Buffer.concat([bad, Buffer.from("not", "utf8")]));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("BAD_JSON");
    decoder.push(encodeFrame({ after: "error" }));
    expect(frames).toEqual([]);
  });
});

describe("writeFrame", () => {
  it("awaits drain when the stream applies backpressure", async () => {
    // Real-backpressure integration: fake timers cannot drive stream drain.
    const stream = new PassThrough({ highWaterMark: 64 });
    const received: Buffer[] = [];
    const frame = encodeFrame({ blob: "y".repeat(1024) });

    let drained = false;
    const writeDone = writeFrame(stream, { blob: "y".repeat(1024) }).then(() => {
      drained = true;
    });

    // Let the write attempt settle, then confirm it is still pending.
    await new Promise((r) => setImmediate(r));
    expect(drained).toBe(false);

    stream.on("data", (chunk: Buffer) => received.push(chunk));
    await writeDone;
    expect(drained).toBe(true);
    expect(Buffer.concat(received).equals(frame)).toBe(true);
  });
});
