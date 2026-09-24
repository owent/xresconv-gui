import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ProcessScope } from "@xresconv/guardian";
import { afterEach, expect, it, vi } from "vitest";
import { createLog4jsSink } from "../../src/service/log-sink.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

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

it("reports unconfirmed cleanup when a killed log worker never closes", async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => false),
    unref: vi.fn(),
  });
  child.stdin.resume();
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  const scope = fakeScope();
  const sink = createLog4jsSink({ scope });
  const outcome = sink.shutdown(10).then(
    () => "success",
    (error: Error) => error.message,
  );
  await vi.advanceTimersByTimeAsync(2500);
  expect(await Promise.race([outcome, Promise.resolve("pending")])).toMatch(/cleanup unconfirmed/);
  // 终止走进程树作用域（P2-02），不再对单个进程裸发 SIGKILL。
  expect(scope.terminate).toHaveBeenCalled();
  expect(child.stdin.destroyed).toBe(true);
});
