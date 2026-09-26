import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runJavaBatch } from "../src/java-runner.ts";
import type { ProcessScope } from "../src/process-tree.ts";

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

/** 不触碰真实进程/FFI 的 scope 桩；terminate 记录调用并立即视为回收完成。 */
function fakeScope() {
  const scope: ProcessScope = {
    name: "fake",
    backend: "process-group",
    decorateSpawnOptions: <T>(options: T): T => options,
    register: vi.fn(),
    terminate: vi.fn(() =>
      Promise.resolve({ backend: "process-group" as const, reapedPids: [], unreapedPids: [] }),
    ),
    dispose: vi.fn(() => Promise.resolve()),
  };
  return scope;
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
const options = { jarPath: "fake.jar", workDir: ".", tasks: ["-t lua"] };

describe("Java pipe failure boundaries", () => {
  it("does not report success after stdin reports EPIPE even if the child exits zero", async () => {
    const child = fakeChild();
    const scope = fakeScope();
    const pending = runJavaBatch({ ...options, scope });
    child.stdin.emit("error", new Error("EPIPE"));
    child.emit("close", 0, null);
    await expect(pending).rejects.toThrow(/stdin|EPIPE/i);
    expect(scope.terminate).toHaveBeenCalled();
  });

  it("still terminates the tree and settles when the child never closes after deadline", async () => {
    vi.useFakeTimers();
    fakeChild();
    const scope = fakeScope();
    const outcome = runJavaBatch({ ...options, deadlineMs: 10, scope }).then(
      () => "success",
      (error: Error) => error.name,
    );
    await vi.advanceTimersByTimeAsync(10000);
    expect(await Promise.race([outcome, Promise.resolve("pending")])).not.toBe("pending");
    expect(scope.terminate).toHaveBeenCalled();
  });

  it("emits bounded log fragments without waiting for a newline", async () => {
    const child = fakeChild();
    const lines: string[] = [];
    const pending = runJavaBatch({
      ...options,
      scope: fakeScope(),
      onLog: (_stream, line) => lines.push(line),
    });
    const text = "x".repeat(200_000);
    child.stdout.emit("data", Buffer.from(text));
    expect(lines.length).toBeGreaterThan(0);
    child.emit("close", 0, null);
    await pending;
    expect(lines.join("")).toBe(text);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(65536);
  });
});
