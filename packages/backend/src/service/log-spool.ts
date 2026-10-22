import {
  closeSync,
  ftruncateSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LogEntry } from "./log-pipeline.ts";

/** A private disk queue keeps synchronous log producers from retaining an unbounded promise chain. */
export class LogSpool {
  readonly directory = mkdtempSync(path.join(tmpdir(), "xresconv-log-spool-"));
  readonly file = path.join(this.directory, "pending.frames");
  private readonly fd: number;
  private written = 0;
  private consumed = 0;
  private closed = false;

  constructor() {
    try {
      this.fd = openSync(this.file, "wx+", 0o600);
    } catch (error) {
      rmSync(this.directory, { recursive: true, force: true });
      throw error;
    }
  }

  get empty(): boolean {
    return this.written === this.consumed;
  }

  append(frame: Buffer): void {
    let offset = 0;
    while (offset < frame.length) {
      const count = writeSync(this.fd, frame, offset, frame.length - offset, this.written + offset);
      if (count === 0) throw new Error("log spool write made no progress");
      offset += count;
    }
    this.written += frame.length;
  }

  takeBatch(): LogEntry[] {
    const records: LogEntry[] = [];
    let bytes = 0;
    const read = (buffer: Buffer, position: number): void => {
      let offset = 0;
      while (offset < buffer.length) {
        const count = readSync(this.fd, buffer, offset, buffer.length - offset, position + offset);
        if (count === 0) throw new Error("log spool is truncated");
        offset += count;
      }
    };
    while (!this.empty && records.length < 64) {
      const header = Buffer.allocUnsafe(4);
      read(header, this.consumed);
      const size = header.readUInt32BE(0);
      if (size > 256 * 1024 || this.consumed + size + 4 > this.written)
        throw new Error("invalid log spool frame");
      if (records.length > 0 && bytes + size > 1024 * 1024) break;
      const body = Buffer.allocUnsafe(size);
      read(body, this.consumed + 4);
      records.push(JSON.parse(body.toString("utf8")) as LogEntry);
      this.consumed += size + 4;
      bytes += size;
    }
    return records;
  }

  /** Only reclaim the file after the worker has acknowledged the batch. */
  resetIfEmpty(): void {
    if (!this.empty) return;
    ftruncateSync(this.fd, 0);
    this.written = 0;
    this.consumed = 0;
  }

  close(preserve: boolean): void {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.fd);
    if (!preserve) rmSync(this.directory, { recursive: true, force: true });
  }
}
