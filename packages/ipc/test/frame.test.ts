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

  it("rejects a body that is not valid UTF-8 without decoding mojibake (SC01)", () => {
    const { frames, errors, decoder } = collect();
    const body = Buffer.from([0xff, 0xfe, 0x28]); // 孤立代理字节序列，非法 UTF-8
    const head = Buffer.allocUnsafe(4);
    head.writeUInt32BE(body.length, 0);
    decoder.push(Buffer.concat([head, body]));
    expect(frames).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("BAD_JSON");
  });

  it("parses a __proto__ key with own-property semantics: no prototype pollution (SC01/R12)", () => {
    const { frames, errors, decoder } = collect();
    // JSON.parse 规范把 "__proto__" 当 own property；即使解析成功，也不能把它
    // 当成原型赋值通道。envelope 层另有 additionalProperties:false 拒绝未知键。
    // 注意：对象字面量 { __proto__: ... } 是原型赋值语法，必须经 JSON 构造自有键。
    const payload = JSON.parse('{"__proto__": {"polluted": true}, "kind": "rpc"}');
    decoder.push(encodeFrame(payload));
    if (errors.length > 0) {
      // schema 拒绝路径：非法 envelope 直接拒绝，同样视为通过。
      expect(errors[0]).toBeInstanceOf(FrameCodecError);
      return;
    }
    expect(frames).toHaveLength(1);
    const parsed = frames[0] as Record<string, unknown>;
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    const own = Object.getOwnPropertyDescriptor(parsed, "__proto__")?.value as object;
    expect(own).toEqual({ polluted: true });
    // 关键断言：全局原型未被污染。
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
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
