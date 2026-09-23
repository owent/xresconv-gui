import { describe, expect, it } from "vitest";
import { HardDeadlineError, runWithDeadline } from "../src/run-with-deadline.js";

const node = process.execPath;

describe("runWithDeadline", () => {
  it("resolves with exit code for a process that finishes in time", async () => {
    const result = await runWithDeadline(node, {
      args: ["-e", "process.exit(0)"],
      deadlineMs: 10_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.elapsedMs).toBeLessThan(10_000);
  });

  it("propagates a non-zero exit code", async () => {
    const result = await runWithDeadline(node, {
      args: ["-e", "process.exit(3)"],
      deadlineMs: 10_000,
    });
    expect(result.exitCode).toBe(3);
  });

  it("enforces the hard deadline and reaps the child", async () => {
    const started = Date.now();
    await expect(
      runWithDeadline(node, {
        args: ["-e", "setInterval(() => {}, 1000)"],
        deadlineMs: 500,
      }),
    ).rejects.toBeInstanceOf(HardDeadlineError);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("reports spawn failures", async () => {
    await expect(
      runWithDeadline("definitely-not-a-real-binary-xresconv", { deadlineMs: 1000 }),
    ).rejects.toThrow(/failed to spawn/);
  });
});
