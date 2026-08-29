import { createClient, type RedisClientType } from "redis";

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  readonly store: "memory" | "redis";
  consume(key: string, now?: number): Promise<RateLimitDecision>;
  healthCheck(): Promise<void>;
  close(): Promise<void>;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export class FixedWindowRateLimiter implements RateLimiter {
  readonly store = "memory" as const;
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    validateLimit(limit, windowMs);
  }

  async consume(key: string, now = Date.now()): Promise<RateLimitDecision> {
    const existing = this.buckets.get(key);
    const bucket =
      !existing || now >= existing.resetAt
        ? { count: 0, resetAt: now + this.windowMs }
        : existing;
    bucket.count += 1;
    this.buckets.set(key, bucket);

    if (this.buckets.size > 10_000) this.prune(now);
    return decisionFor(bucket.count, this.limit, bucket.resetAt, now);
  }

  async healthCheck(): Promise<void> {}

  async close(): Promise<void> {
    this.buckets.clear();
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }
}

export interface RedisRateLimiterOptions {
  url: string;
  limit: number;
  windowMs: number;
  keyPrefix?: string;
  connectTimeoutMs?: number;
  onError?: (error: Error) => void;
}

const REDIS_FIXED_WINDOW_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if count == 1 or ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

export class RedisFixedWindowRateLimiter implements RateLimiter {
  readonly store = "redis" as const;
  private readonly client: RedisClientType;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly keyPrefix: string;
  private connectPromise?: Promise<void>;

  constructor(options: RedisRateLimiterOptions) {
    validateLimit(options.limit, options.windowMs);
    if (!options.url.trim()) throw new Error("REDIS_URL is required for Redis rate limiting.");
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.keyPrefix = options.keyPrefix?.trim() || "echomere:chat-rate";
    this.client = createClient({
      url: options.url,
      socket: {
        connectTimeout: options.connectTimeoutMs ?? 2_000,
        reconnectStrategy: false,
      },
    });
    this.client.on("error", options.onError ?? (() => undefined));
  }

  async consume(key: string, now = Date.now()): Promise<RateLimitDecision> {
    await this.ensureConnected();
    const result = await this.client.eval(REDIS_FIXED_WINDOW_SCRIPT, {
      keys: [`${this.keyPrefix}:${key}`],
      arguments: [String(this.windowMs)],
    });
    if (!Array.isArray(result) || result.length < 2) {
      throw new Error("Redis rate limiter returned an invalid result.");
    }
    const count = Number(result[0]);
    const ttlMs = Number(result[1]);
    if (!Number.isFinite(count) || !Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new Error("Redis rate limiter returned invalid counter values.");
    }
    return decisionFor(count, this.limit, now + ttlMs, now);
  }

  async healthCheck(): Promise<void> {
    await this.ensureConnected();
    const result = await this.client.ping();
    if (result !== "PONG") throw new Error("Redis health check failed.");
  }

  async close(): Promise<void> {
    if (this.client.isOpen) await this.client.close();
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isReady) return;
    this.connectPromise ??= this.client
      .connect()
      .then(() => undefined)
      .finally(() => {
        this.connectPromise = undefined;
      });
    await this.connectPromise;
  }
}

export interface RateLimiterEnvironment {
  CHAT_RATE_LIMIT_STORE?: string;
  CHAT_RATE_LIMIT_MAX?: string;
  CHAT_RATE_LIMIT_WINDOW_MS?: string;
  CHAT_RATE_LIMIT_REDIS_PREFIX?: string;
  CHAT_RATE_LIMIT_REDIS_TIMEOUT_MS?: string;
  REDIS_URL?: string;
}

export function createRateLimiterFromEnv(
  env: RateLimiterEnvironment = process.env,
  onRedisError?: (error: Error) => void,
): RateLimiter {
  const limit = positiveIntegerFromEnv(env.CHAT_RATE_LIMIT_MAX, 20);
  const windowMs = positiveIntegerFromEnv(env.CHAT_RATE_LIMIT_WINDOW_MS, 60_000);
  const store = env.CHAT_RATE_LIMIT_STORE?.trim().toLowerCase() || "memory";
  if (store === "memory") return new FixedWindowRateLimiter(limit, windowMs);
  if (store !== "redis") {
    throw new Error("CHAT_RATE_LIMIT_STORE must be either memory or redis.");
  }
  return new RedisFixedWindowRateLimiter({
    url: env.REDIS_URL?.trim() || "",
    limit,
    windowMs,
    ...(env.CHAT_RATE_LIMIT_REDIS_PREFIX
      ? { keyPrefix: env.CHAT_RATE_LIMIT_REDIS_PREFIX }
      : {}),
    connectTimeoutMs: positiveIntegerFromEnv(
      env.CHAT_RATE_LIMIT_REDIS_TIMEOUT_MS,
      2_000,
    ),
    ...(onRedisError ? { onError: onRedisError } : {}),
  });
}

export function positiveIntegerFromEnv(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function validateLimit(limit: number, windowMs: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Rate limit must be a positive integer.");
  }
  if (!Number.isInteger(windowMs) || windowMs < 1) {
    throw new Error("Rate limit window must be a positive integer.");
  }
}

function decisionFor(
  count: number,
  limit: number,
  resetAt: number,
  now: number,
): RateLimitDecision {
  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1_000)),
  };
}
