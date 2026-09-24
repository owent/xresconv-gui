/**
 * Framed byte channel: 4-byte big-endian length + UTF-8 JSON payload.
 * Used for shell<->guardian (stdio pipes) and guardian<->script-worker.
 * Trusted Node roles (backend) use child_process.fork IPC instead (Plan 02).
 *
 * Budgets: frames larger than the limit are rejected BEFORE allocation on
 * receive, and before write on send. A malformed frame poisons the channel:
 * the decoder reports the error once and ignores all further input, letting
 * the owner terminate the peer (Plan 02 §传输和握手).
 */

export const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;

export class FrameCodecError extends Error {
  readonly code: "TOO_LARGE" | "BAD_JSON";

  constructor(message: string, code: "TOO_LARGE" | "BAD_JSON") {
    super(message);
    this.name = "FrameCodecError";
    this.code = code;
  }
}

/** Serializes a value into one length-prefixed frame. */
export function encodeFrame(value: unknown, maxBytes = DEFAULT_MAX_FRAME_BYTES): Buffer {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  if (body.length > maxBytes) {
    throw new FrameCodecError(
      `frame payload ${body.length}B exceeds limit ${maxBytes}B`,
      "TOO_LARGE",
    );
  }
  const head = Buffer.allocUnsafe(4);
  head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

/** Writes one frame, respecting stream backpressure. */
export async function writeFrame(
  stream: NodeJS.WritableStream,
  value: unknown,
  maxBytes = DEFAULT_MAX_FRAME_BYTES,
): Promise<void> {
  const frame = encodeFrame(value, maxBytes);
  await new Promise<void>((resolve, reject) => {
    let written = false;
    let drained = false;
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled || (!error && (!written || !drained))) return;
      settled = true;
      stream.removeListener("error", onError);
      stream.removeListener("close", onClose);
      stream.removeListener("drain", onDrain);
      if (error) reject(error);
      else resolve();
    };
    const onError = (error: Error): void => finish(error);
    const onClose = (): void => finish(new Error("frame stream closed before write completed"));
    const onDrain = (): void => {
      drained = true;
      finish();
    };
    stream.once("error", onError);
    stream.once("close", onClose);
    stream.once("drain", onDrain);
    if (!stream.writable) {
      onClose();
      return;
    }
    try {
      drained = stream.write(frame, (error?: Error | null) => {
        if (error) {
          // Node emits 'error' after the write callback. Keep the listener
          // until that emission; the microtask also covers custom streams.
          queueMicrotask(() => finish(error));
          return;
        }
        written = true;
        finish();
      });
      finish();
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Incremental decoder. Feed arbitrary chunks; complete frames are delivered
 * to onFrame in order. After an error the decoder is permanently poisoned.
 */
export class FrameDecoder {
  private chunks: Buffer[] = [];
  private buffered = 0;
  private poisoned = false;
  private readonly onFrame: (value: unknown) => void;
  private readonly onError: (error: FrameCodecError) => void;
  private readonly maxBytes: number;

  constructor(
    onFrame: (value: unknown) => void,
    onError: (error: FrameCodecError) => void,
    maxBytes = DEFAULT_MAX_FRAME_BYTES,
  ) {
    this.onFrame = onFrame;
    this.onError = onError;
    this.maxBytes = maxBytes;
  }

  push(chunk: Buffer): void {
    if (this.poisoned) return;
    this.chunks.push(chunk);
    this.buffered += chunk.length;
    this.drain();
  }

  private poison(error: FrameCodecError): void {
    this.poisoned = true;
    this.chunks = [];
    this.buffered = 0;
    this.onError(error);
  }

  private drain(): void {
    for (;;) {
      if (this.buffered < 4) return;
      const head = this.peek(4);
      const len = head.readUInt32BE(0);
      if (len > this.maxBytes) {
        this.poison(
          new FrameCodecError(
            `declared frame ${len}B exceeds limit ${this.maxBytes}B`,
            "TOO_LARGE",
          ),
        );
        return;
      }
      if (this.buffered < 4 + len) return;
      const body = this.take(len);
      let value: unknown;
      try {
        value = JSON.parse(body.toString("utf8"));
      } catch (err) {
        this.poison(
          new FrameCodecError(`invalid JSON frame: ${(err as Error).message}`, "BAD_JSON"),
        );
        return;
      }
      this.onFrame(value);
    }
  }

  /** Reads the first n bytes without consuming (n <= buffered). */
  private peek(n: number): Buffer {
    const parts: Buffer[] = [];
    let need = n;
    for (const chunk of this.chunks) {
      parts.push(chunk.subarray(0, need));
      need -= Math.min(need, chunk.length);
      if (need === 0) break;
    }
    return Buffer.concat(parts);
  }

  /** Consumes exactly n bytes AFTER the 4-byte header. */
  private take(n: number): Buffer {
    // drop header
    this.consume(4);
    const parts: Buffer[] = [];
    let need = n;
    while (need > 0) {
      const chunk = this.chunks[0];
      if (chunk === undefined) break;
      const takeBytes = Math.min(need, chunk.length);
      parts.push(chunk.subarray(0, takeBytes));
      need -= takeBytes;
      this.consume(takeBytes);
    }
    return Buffer.concat(parts);
  }

  private consume(n: number): void {
    let need = n;
    while (need > 0) {
      const chunk = this.chunks[0];
      if (chunk === undefined) return;
      if (chunk.length <= need) {
        this.chunks.shift();
        need -= chunk.length;
        this.buffered -= chunk.length;
      } else {
        this.chunks[0] = chunk.subarray(need);
        this.buffered -= need;
        need = 0;
      }
    }
  }
}
