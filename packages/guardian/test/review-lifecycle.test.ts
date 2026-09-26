import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { BackendSupervisor } from "../src/backend-supervisor.ts";
import { createProcessScope, type ProcessScope } from "../src/process-tree.ts";

const backendEntry = fileURLToPath(new URL("./fixtures/delayed-backend.mjs", import.meta.url));

it("concurrent starts both wait for the backend handshake", async () => {
  const supervisor = new BackendSupervisor({ backendEntry });
  try {
    const first = supervisor.start();
    await supervisor.start();
    expect(supervisor.stats().state).toBe("ready");
    await first;
  } finally {
    await supervisor.shutdown();
  }
});

it("shutdown during startup rejects startup and cannot revive the supervisor", async () => {
  const events: string[] = [];
  const supervisor = new BackendSupervisor({
    backendEntry,
    onEvent: (event) => events.push(event.type),
    createScope: () => {
      const scope = createProcessScope();
      return {
        name: scope.name,
        backend: scope.backend,
        decorateSpawnOptions: (options) => scope.decorateSpawnOptions(options),
        register: (child) => scope.register(child),
        terminate: async () => {
          await new Promise((resolve) => setTimeout(resolve, 350));
          return scope.terminate(0);
        },
        dispose: () => scope.dispose(),
      };
    },
  });
  const started = supervisor.start().then(
    () => "ready",
    () => "rejected",
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
  await supervisor.shutdown();
  expect(await started).toBe("rejected");
  expect(supervisor.stats().state).toBe("shutdown");
  expect(events).not.toContain("ready");
});

it("malformed health payload fails startup without escaping the message handler", async () => {
  const supervisor = new BackendSupervisor({
    backendEntry,
    backendEnv: { REVIEW_BAD_HEALTH: "1" },
  });
  try {
    await expect(supervisor.start()).rejects.toThrow();
  } finally {
    await supervisor.shutdown();
  }
});

it("concurrent shutdown callers await the same cleanup", async () => {
  const cleanup = Promise.withResolvers<void>();
  let disposed = 0;
  let child: import("node:child_process").ChildProcess | undefined;
  const scope: ProcessScope = {
    name: "review",
    backend: "process-group",
    decorateSpawnOptions: (value) => value,
    register: (value) => {
      child = value;
    },
    terminate: async () => {
      await cleanup.promise;
      child?.kill();
      return { backend: "process-group", reapedPids: [], unreapedPids: [] };
    },
    dispose: async () => {
      disposed++;
    },
  };
  const supervisor = new BackendSupervisor({ backendEntry, createScope: () => scope });
  await supervisor.start();
  const first = supervisor.shutdown();
  let done = false;
  const second = supervisor.shutdown().then(() => {
    done = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  try {
    expect(done).toBe(false);
  } finally {
    cleanup.resolve();
    await Promise.all([first, second]);
  }
  expect(disposed).toBe(1);
});
