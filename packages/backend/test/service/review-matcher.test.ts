import { expect, it } from "vitest";
import { MatcherService } from "../../src/service/matcher-service.ts";

it("all matcher startup callers wait for readiness", async () => {
  const service = new MatcherService();
  const first = service.start();
  try {
    await service.start();
    expect(service.stats().ready).toBe(true);
  } finally {
    await first.catch(() => {});
    await service.shutdown();
  }
});

it("queued match input is a snapshot at submission", async () => {
  const service = new MatcherService();
  try {
    await service.start();
    const input = ["original"];
    const result = service.matchBatch("original", input);
    input[0] = "changed";
    expect(await result).toEqual([true]);
  } finally {
    await service.shutdown();
  }
});
