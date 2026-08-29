import assert from "node:assert/strict";
import test from "node:test";
import {
  createRateLimiterFromEnv,
  FixedWindowRateLimiter,
  positiveIntegerFromEnv,
} from "./rate-limit.js";

test("fixed-window limiter rejects overflow and resets deterministically", async () => {
  const limiter = new FixedWindowRateLimiter(2, 1_000);
  assert.deepEqual(await limiter.consume("user-1", 1_000), {
    allowed: true,
    limit: 2,
    remaining: 1,
    resetAt: 2_000,
    retryAfterSeconds: 1,
  });
  assert.equal((await limiter.consume("user-1", 1_500)).allowed, true);
  assert.equal((await limiter.consume("user-1", 1_600)).allowed, false);
  assert.equal((await limiter.consume("user-2", 1_600)).allowed, true);
  assert.equal((await limiter.consume("user-1", 2_000)).allowed, true);
});

test("rate-limit store is explicit and Redis requires a URL", () => {
  assert.equal(
    createRateLimiterFromEnv({ CHAT_RATE_LIMIT_STORE: "memory" }).store,
    "memory",
  );
  assert.throws(
    () => createRateLimiterFromEnv({ CHAT_RATE_LIMIT_STORE: "redis" }),
    /REDIS_URL/u,
  );
  assert.throws(
    () => createRateLimiterFromEnv({ CHAT_RATE_LIMIT_STORE: "unknown" }),
    /memory or redis/u,
  );
});

test("rate-limit environment values use safe positive defaults", () => {
  assert.equal(positiveIntegerFromEnv("12", 20), 12);
  assert.equal(positiveIntegerFromEnv("0", 20), 20);
  assert.equal(positiveIntegerFromEnv("invalid", 20), 20);
});
