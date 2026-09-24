import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterAll, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  close: vi.fn(),
  assign: vi.fn(() => true),
  terminate: vi.fn(() => true),
}));
vi.mock("node:module", () => ({
  createRequire: () => () => ({
    load: () => ({
      func: (signature: string) => {
        if (signature.includes("CloseHandle")) return api.close;
        if (signature.includes("AssignProcess")) return api.assign;
        if (signature.includes("TerminateJob")) return api.terminate;
        if (signature.includes("SetInformation")) return () => true;
        return () => ({});
      },
    }),
  }),
}));

import { createProcessScope } from "../src/process-tree.ts";

const platform = Object.getOwnPropertyDescriptor(process, "platform");
Object.defineProperty(process, "platform", { value: "win32" });
afterAll(() => {
  if (platform) Object.defineProperty(process, "platform", platform);
});

it("closes a Job handle exactly once across concurrent and repeated dispose", async () => {
  api.close.mockClear();
  const scope = createProcessScope();
  await Promise.all([scope.dispose(), scope.dispose()]);
  await scope.dispose();
  expect(api.close).toHaveBeenCalledTimes(1);
});

it("does not accept a new process into an already terminated scope", async () => {
  const scope = createProcessScope();
  await scope.terminate();
  const child = Object.assign(new EventEmitter(), {
    pid: 12345,
    kill: vi.fn(),
  }) as unknown as ChildProcess;
  try {
    expect(() => scope.register(child)).toThrow(/closed|terminat/i);
    expect(child.kill).toHaveBeenCalled();
  } finally {
    child.emit("close", 1);
    await scope.dispose();
  }
});

it("reports failed assignment instead of claiming the child is job-contained", async () => {
  api.assign.mockReturnValueOnce(false);
  const scope = createProcessScope();
  const child = Object.assign(new EventEmitter(), {
    pid: 12346,
    kill: vi.fn(),
    exitCode: null,
    signalCode: null,
  }) as unknown as ChildProcess;
  try {
    expect(() => scope.register(child)).toThrow(/assign/i);
  } finally {
    child.emit("close", 1);
    await scope.dispose();
  }
});
