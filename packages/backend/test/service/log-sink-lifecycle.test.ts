import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { createLog4jsSink } from "../../src/service/log-sink.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

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
  const sink = createLog4jsSink();
  const outcome = sink.shutdown(10).then(
    () => "success",
    (error: Error) => error.message,
  );
  await vi.advanceTimersByTimeAsync(2500);
  expect(await Promise.race([outcome, Promise.resolve("pending")])).toMatch(/cleanup unconfirmed/);
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  expect(child.stdin.destroyed).toBe(true);
});
