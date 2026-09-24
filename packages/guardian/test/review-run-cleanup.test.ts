import { expect, it } from "vitest";
import type { ProcessScope } from "../src/process-tree.ts";
import { runWithDeadline } from "../src/run-with-deadline.ts";

it("does not report a completed command until its scope cleanup completes", async () => {
  const cleanup = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const scope: ProcessScope = {
    name: "cleanup",
    backend: "process-group",
    decorateSpawnOptions: (options) => options,
    register: () => {},
    terminate: async () => ({ backend: "process-group", reapedPids: [], unreapedPids: [] }),
    dispose: () => {
      entered.resolve();
      return cleanup.promise;
    },
  };
  let settled = false;
  const result = runWithDeadline(process.execPath, {
    args: ["-e", "process.exit(0)"],
    deadlineMs: 2000,
    scope,
  }).then(() => {
    settled = true;
  });
  await entered.promise;
  await Promise.resolve();
  try {
    expect(settled).toBe(false);
  } finally {
    cleanup.resolve();
    await result;
  }
});
