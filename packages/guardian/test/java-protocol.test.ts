import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runJavaBatch } from "../src/java-runner.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  child.stdin.resume();
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  return child;
}
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
const options = { jarPath: "fake.jar", workDir: ".", tasks: ["-t lua"] };

describe("Java pipe failure boundaries", () => {
  it("does not report success after stdin reports EPIPE even if the child exits zero", async () => {
    const child = fakeChild();
    const pending = runJavaBatch(options);
    child.stdin.emit("error", new Error("EPIPE"));
    child.emit("close", 0, null);
    await expect(pending).rejects.toThrow(/stdin|EPIPE/i);
  });

  it("still escalates and reports a deadline when SIGTERM returns false", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    child.kill.mockReturnValue(false);
    const outcome = runJavaBatch({ ...options, deadlineMs: 10 }).then(
      () => "success",
      (error: Error) => error.name,
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await Promise.race([outcome, Promise.resolve("pending")])).not.toBe("pending");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("emits bounded log fragments without waiting for a newline", async () => {
    const child = fakeChild();
    const lines: string[] = [];
    const pending = runJavaBatch({ ...options, onLog: (_stream, line) => lines.push(line) });
    const text = "x".repeat(200_000);
    child.stdout.emit("data", Buffer.from(text));
    expect(lines.length).toBeGreaterThan(0);
    child.emit("close", 0, null);
    await pending;
    expect(lines.join("")).toBe(text);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(65536);
  });
});
