import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createRunConcurrencyLimiterFromEnv,
  RunConcurrencyLimiter,
} from "../src/server/run-concurrency.ts";

describe("Agent run concurrency", () => {
  it("enforces global and per-user limits and releases idempotently", async () => {
    const limiter = new RunConcurrencyLimiter(2, 1);
    const first = await limiter.tryAcquire("user-1");
    assert.ok(first);
    assert.equal(await limiter.tryAcquire("user-1"), null);

    const second = await limiter.tryAcquire("user-2");
    assert.ok(second);
    assert.equal(await limiter.tryAcquire("user-3"), null);

    await first.release();
    await first.release();
    const third = await limiter.tryAcquire("user-3");
    assert.ok(third);
    await Promise.all([second.release(), third.release()]);
    await limiter.close();
  });

  it("requires explicit valid Redis configuration", () => {
    assert.equal(
      createRunConcurrencyLimiterFromEnv({
        AGENT_CONCURRENCY_STORE: "memory",
      }).store,
      "memory",
    );
    assert.throws(
      () =>
        createRunConcurrencyLimiterFromEnv({
          AGENT_CONCURRENCY_STORE: "redis",
        }),
      /REDIS_URL/u,
    );
    assert.throws(
      () =>
        createRunConcurrencyLimiterFromEnv({
          AGENT_CONCURRENCY_STORE: "unknown",
        }),
      /memory or redis/u,
    );
  });

  it("rejects per-user concurrency above the global limit", () => {
    assert.throws(() => new RunConcurrencyLimiter(1, 2), /cannot exceed/u);
  });
});
