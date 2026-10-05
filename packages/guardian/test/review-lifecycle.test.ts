import { type ChildProcess, fork } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { PROTOCOL_VERSION } from "@xresconv/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BackendSupervisor } from "../src/backend-supervisor.ts";
import type { ProcessScope } from "../src/process-tree.ts";

vi.mock("node:child_process", () => ({ fork: vi.fn() }));
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function harness() {
  const registered = Promise.withResolvers<void>();
  const cleanupStarted = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  const disposed = Promise.withResolvers<void>();
  const events: string[] = [];
  const child = Object.assign(new EventEmitter(), {
    pid: 1234,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null,
    send: vi.fn((frame: { kind: string }) => {
      if (frame.kind === "shutdown") {
        child.exitCode = 0;
        child.emit("exit", 0, null);
      }
      return true;
    }),
  });
  vi.mocked(fork).mockReturnValue(child as unknown as ChildProcess);
  const scope: ProcessScope = {
    name: "lifecycle-test",
    backend: "process-group",
    decorateSpawnOptions: (options) => options,
    register: () => registered.resolve(),
    terminate: vi.fn(async () => {
      cleanupStarted.resolve();
      await cleanup.promise;
      return { backend: "process-group" as const, reapedPids: [], unreapedPids: [] };
    }),
    dispose: vi.fn(async () => {
      disposed.resolve();
    }),
  };
  const supervisor = new BackendSupervisor({
    backendEntry: "controlled-backend",
    createScope: () => scope,
    onEvent: (event) => events.push(event.type),
  });
  const health = (payload: unknown = { ok: true, pid: child.pid }) =>
    child.emit("message", {
      protocol_version: PROTOCOL_VERSION,
      role: "backend",
      kind: "health",
      id: "ready",
      payload,
    });
  return {
    supervisor,
    child,
    scope,
    events,
    health,
    registered,
    cleanupStarted,
    cleanup,
    disposed,
  };
}

it("concurrent starts both wait for the backend handshake", async () => {
  const h = harness();
  const first = h.supervisor.start();
  const second = h.supervisor.start();
  try {
    await h.registered.promise;
    expect(h.supervisor.stats().state).toBe("starting");
    expect(fork).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(await Promise.race([first, Promise.resolve("pending")])).toBe("pending");
    expect(await Promise.race([second, Promise.resolve("pending")])).toBe("pending");
    h.health();
    await Promise.all([first, second]);
    expect(h.supervisor.stats().state).toBe("ready");
  } finally {
    h.cleanup.resolve();
    await h.supervisor.shutdown();
  }
});

it("shutdown during startup rejects startup and ignores a handshake during cleanup", async () => {
  const h = harness();
  const started = h.supervisor.start().then(
    () => "ready",
    () => "rejected",
  );
  await h.registered.promise;
  const stopped = h.supervisor.shutdown();
  try {
    await h.cleanupStarted.promise;
    h.health();
    expect(await started).toBe("rejected");
    expect(h.supervisor.stats().state).toBe("shutdown");
    expect(h.events).not.toContain("ready");
    expect(h.scope.dispose).not.toHaveBeenCalled();
  } finally {
    h.cleanup.resolve();
    await stopped;
  }
});

it("malformed health payload fails startup without escaping the message handler", async () => {
  const h = harness();
  const rejected = expect(h.supervisor.start()).rejects.toThrow();
  try {
    await h.registered.promise;
    h.health(null);
    await rejected;
    expect(h.events).not.toContain("ready");
  } finally {
    h.cleanup.resolve();
    await h.supervisor.shutdown();
  }
});

it("concurrent shutdown callers await the same cleanup", async () => {
  const h = harness();
  const started = h.supervisor.start();
  await h.registered.promise;
  h.health();
  await started;
  const first = h.supervisor.shutdown();
  const second = h.supervisor.shutdown();
  try {
    await h.cleanupStarted.promise;
    expect(second).toBe(first);
    expect(h.scope.dispose).not.toHaveBeenCalled();
    expect(h.scope.terminate).toHaveBeenCalledTimes(1);
  } finally {
    h.cleanup.resolve();
    await Promise.all([first, second]);
  }
  expect(h.scope.dispose).toHaveBeenCalledTimes(1);
});

it("an expired handshake fails once and cannot be revived by a late ready event", async () => {
  const h = harness();
  const rejected = expect(h.supervisor.start()).rejects.toThrow();
  try {
    await h.registered.promise;
    await vi.advanceTimersByTimeAsync(4999);
    expect(h.supervisor.stats().state).toBe("starting");
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    h.health();
    expect(h.supervisor.stats().state).toBe("dead");
    expect(h.events.filter((event) => event === "died")).toHaveLength(1);
    expect(h.events).not.toContain("ready");
  } finally {
    h.cleanup.resolve();
    await h.supervisor.shutdown();
  }
});

it("a dead backend is not restarted by subsequent timer turns", async () => {
  const h = harness();
  const started = h.supervisor.start();
  await h.registered.promise;
  h.health();
  await started;
  try {
    h.cleanup.resolve();
    h.child.exitCode = 1;
    h.child.emit("exit", 1, null);
    await h.disposed.promise;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.supervisor.stats().state).toBe("dead");
    expect(fork).toHaveBeenCalledTimes(1);
    expect(h.events.filter((event) => event === "ready")).toHaveLength(1);
  } finally {
    h.cleanup.resolve();
    await h.supervisor.shutdown();
  }
});
