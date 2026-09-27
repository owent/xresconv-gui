import { expect, it, vi } from "vitest";
import { MatcherService } from "../../src/service/matcher-service.ts";
import { ConversionSession } from "../../src/service/session.ts";
import { fixture, startPool, TEST_TIMEOUT_MS } from "./helpers.ts";

it(
  "a selector matching an old configuration cannot select replacement items",
  async () => {
    const pool = await startPool();
    const matcher = new MatcherService();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    vi.spyOn(matcher, "start").mockImplementation(async () => {
      entered.resolve();
      await release.promise;
    });
    vi.spyOn(matcher, "matchBatch").mockImplementation(async (_rule, inputs) =>
      inputs.map(() => true),
    );
    const session = new ConversionSession({ pool, matcherFactory: () => matcher });
    try {
      await session.loadConfig(fixture("custom-button.xml"));
      await session.setCustomSelectors([fixture("custom-selectors-single.json")]);
      const oldRequest = session.invokeCustomButton("单对象");
      await entered.promise;
      await session.loadConfig(fixture("custom-button.xml"));
      release.resolve();
      await expect(oldRequest).rejects.toThrow(/configuration.*changed/i);
      expect(session.getSelectedItems()).toHaveLength(0);
    } finally {
      release.resolve();
      await session.dispose();
      await pool.shutdown();
    }
  },
  TEST_TIMEOUT_MS,
);

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
