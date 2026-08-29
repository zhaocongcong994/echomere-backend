import { createHash, randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";

export interface RunLease {
  readonly signal?: AbortSignal;
  release(): Promise<void>;
}

export interface RunConcurrencyGate {
  readonly store: "memory" | "redis";
  tryAcquire(userId: string): Promise<RunLease | null>;
  healthCheck(): Promise<void>;
  close(): Promise<void>;
}

export class RunConcurrencyLimiter implements RunConcurrencyGate {
  readonly store = "memory" as const;
  private activeGlobal = 0;
  private readonly activeByUser = new Map<string, number>();
  private readonly maxGlobal: number;
  private readonly maxPerUser: number;

  constructor(maxGlobal: number, maxPerUser: number) {
    validateLimits(maxGlobal, maxPerUser);
    this.maxGlobal = maxGlobal;
    this.maxPerUser = maxPerUser;
  }

  async tryAcquire(userId: string): Promise<RunLease | null> {
    const userActive = this.activeByUser.get(userId) ?? 0;
    if (this.activeGlobal >= this.maxGlobal || userActive >= this.maxPerUser) {
      return null;
    }

    this.activeGlobal += 1;
    this.activeByUser.set(userId, userActive + 1);
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        this.activeGlobal = Math.max(0, this.activeGlobal - 1);
        const nextUserActive = Math.max(
          0,
          (this.activeByUser.get(userId) ?? 1) - 1,
        );
        if (nextUserActive === 0) this.activeByUser.delete(userId);
        else this.activeByUser.set(userId, nextUserActive);
      },
    };
  }

  async healthCheck(): Promise<void> {}

  async close(): Promise<void> {
    this.activeGlobal = 0;
    this.activeByUser.clear();
  }
}

export interface RedisRunConcurrencyOptions {
  url: string;
  maxGlobal: number;
  maxPerUser: number;
  leaseTtlMs?: number;
  keyPrefix?: string;
  connectTimeoutMs?: number;
  onError?: (error: Error) => void;
  now?: () => number;
  idFactory?: () => string;
}

const ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[1])
local expires_at = tonumber(ARGV[2])
local max_global = tonumber(ARGV[3])
local max_user = tonumber(ARGV[4])
local lease_id = ARGV[5]
local key_ttl = tonumber(ARGV[6])

redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", now)

local global_count = redis.call("ZCARD", KEYS[1])
local user_count = redis.call("ZCARD", KEYS[2])
if global_count >= max_global or user_count >= max_user then
  return { 0, global_count, user_count }
end

redis.call("ZADD", KEYS[1], expires_at, lease_id)
redis.call("ZADD", KEYS[2], expires_at, lease_id)
redis.call("PEXPIRE", KEYS[1], key_ttl)
redis.call("PEXPIRE", KEYS[2], key_ttl)
return { 1, global_count + 1, user_count + 1 }
`;

const RENEW_SCRIPT = `
local expires_at = tonumber(ARGV[1])
local lease_id = ARGV[2]
local key_ttl = tonumber(ARGV[3])
local global_score = redis.call("ZSCORE", KEYS[1], lease_id)
local user_score = redis.call("ZSCORE", KEYS[2], lease_id)
if not global_score or not user_score then
  redis.call("ZREM", KEYS[1], lease_id)
  redis.call("ZREM", KEYS[2], lease_id)
  return 0
end
redis.call("ZADD", KEYS[1], "XX", expires_at, lease_id)
redis.call("ZADD", KEYS[2], "XX", expires_at, lease_id)
redis.call("PEXPIRE", KEYS[1], key_ttl)
redis.call("PEXPIRE", KEYS[2], key_ttl)
return 1
`;

const RELEASE_SCRIPT = `
redis.call("ZREM", KEYS[1], ARGV[1])
redis.call("ZREM", KEYS[2], ARGV[1])
return 1
`;

export class RedisRunConcurrencyLimiter implements RunConcurrencyGate {
  readonly store = "redis" as const;
  private readonly client: RedisClientType;
  private readonly maxGlobal: number;
  private readonly maxPerUser: number;
  private readonly leaseTtlMs: number;
  private readonly keyPrefix: string;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly onError: ((error: Error) => void) | undefined;
  private connectPromise: Promise<void> | undefined;
  private closed = false;

  constructor(options: RedisRunConcurrencyOptions) {
    validateLimits(options.maxGlobal, options.maxPerUser);
    if (!options.url.trim()) {
      throw new Error("REDIS_URL is required for Redis Agent concurrency.");
    }
    this.maxGlobal = options.maxGlobal;
    this.maxPerUser = options.maxPerUser;
    this.leaseTtlMs = options.leaseTtlMs ?? 180_000;
    if (!Number.isInteger(this.leaseTtlMs) || this.leaseTtlMs < 3_000) {
      throw new Error("Agent concurrency lease TTL must be at least 3000ms.");
    }
    this.keyPrefix = options.keyPrefix?.trim() || "echomere:agent-runs";
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? randomUUID;
    this.onError = options.onError;
    this.client = createClient({
      url: options.url,
      socket: {
        connectTimeout: options.connectTimeoutMs ?? 2_000,
        reconnectStrategy: false,
      },
    });
    this.client.on("error", options.onError ?? (() => undefined));
  }

  async tryAcquire(userId: string): Promise<RunLease | null> {
    await this.ensureConnected();
    const leaseId = this.idFactory();
    const keys = this.keysFor(userId);
    const now = this.now();
    const result = await this.client.eval(ACQUIRE_SCRIPT, {
      keys,
      arguments: [
        String(now),
        String(now + this.leaseTtlMs),
        String(this.maxGlobal),
        String(this.maxPerUser),
        leaseId,
        String(this.leaseTtlMs * 2),
      ],
    });
    if (!Array.isArray(result) || Number(result[0]) !== 1) return null;
    return this.createLease(keys, leaseId);
  }

  async healthCheck(): Promise<void> {
    await this.ensureConnected();
    if ((await this.client.ping()) !== "PONG") {
      throw new Error("Redis Agent concurrency health check failed.");
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.client.isOpen) await this.client.close();
  }

  private createLease(keys: [string, string], leaseId: string): RunLease {
    const controller = new AbortController();
    let released = false;
    let renewalRunning = false;
    const renew = async (): Promise<void> => {
      if (released || renewalRunning) return;
      renewalRunning = true;
      try {
        const expiresAt = this.now() + this.leaseTtlMs;
        const result = await this.client.eval(RENEW_SCRIPT, {
          keys,
          arguments: [
            String(expiresAt),
            leaseId,
            String(this.leaseTtlMs * 2),
          ],
        });
        if (Number(result) !== 1) {
          throw new Error("Agent concurrency lease was lost.");
        }
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        if (!released) {
          this.onError?.(normalized);
          controller.abort(normalized);
        }
      } finally {
        renewalRunning = false;
      }
    };
    const renewalTimer = setInterval(
      () => void renew(),
      Math.max(1_000, Math.floor(this.leaseTtlMs / 3)),
    );
    renewalTimer.unref();

    return {
      signal: controller.signal,
      release: async () => {
        if (released) return;
        released = true;
        clearInterval(renewalTimer);
        if (this.closed || !this.client.isReady) return;
        await this.client.eval(RELEASE_SCRIPT, {
          keys,
          arguments: [leaseId],
        });
      },
    };
  }

  private keysFor(userId: string): [string, string] {
    const userHash = createHash("sha256").update(userId).digest("hex");
    return [
      `${this.keyPrefix}:global`,
      `${this.keyPrefix}:user:${userHash}`,
    ];
  }

  private async ensureConnected(): Promise<void> {
    if (this.closed) throw new Error("Agent concurrency limiter is closed.");
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

export interface RunConcurrencyEnvironment {
  AGENT_CONCURRENCY_STORE?: string;
  AGENT_MAX_CONCURRENT_RUNS?: string;
  AGENT_MAX_CONCURRENT_RUNS_PER_USER?: string;
  AGENT_CONCURRENCY_LEASE_TTL_MS?: string;
  AGENT_CONCURRENCY_REDIS_PREFIX?: string;
  AGENT_CONCURRENCY_REDIS_TIMEOUT_MS?: string;
  REDIS_URL?: string;
}

export function createRunConcurrencyLimiterFromEnv(
  env: RunConcurrencyEnvironment = process.env,
  onRedisError?: (error: Error) => void,
): RunConcurrencyGate {
  const maxGlobal = positiveIntegerFromEnv(env.AGENT_MAX_CONCURRENT_RUNS, 8);
  const maxPerUser = positiveIntegerFromEnv(
    env.AGENT_MAX_CONCURRENT_RUNS_PER_USER,
    2,
  );
  const store = env.AGENT_CONCURRENCY_STORE?.trim().toLowerCase() || "memory";
  if (store === "memory") {
    return new RunConcurrencyLimiter(maxGlobal, maxPerUser);
  }
  if (store !== "redis") {
    throw new Error("AGENT_CONCURRENCY_STORE must be either memory or redis.");
  }
  return new RedisRunConcurrencyLimiter({
    url: env.REDIS_URL?.trim() || "",
    maxGlobal,
    maxPerUser,
    leaseTtlMs: positiveIntegerFromEnv(
      env.AGENT_CONCURRENCY_LEASE_TTL_MS,
      180_000,
    ),
    connectTimeoutMs: positiveIntegerFromEnv(
      env.AGENT_CONCURRENCY_REDIS_TIMEOUT_MS,
      2_000,
    ),
    ...(env.AGENT_CONCURRENCY_REDIS_PREFIX
      ? { keyPrefix: env.AGENT_CONCURRENCY_REDIS_PREFIX }
      : {}),
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

function validateLimits(maxGlobal: number, maxPerUser: number): void {
  if (!Number.isInteger(maxGlobal) || maxGlobal < 1) {
    throw new Error("Global Agent concurrency must be a positive integer.");
  }
  if (!Number.isInteger(maxPerUser) || maxPerUser < 1) {
    throw new Error("Per-user Agent concurrency must be a positive integer.");
  }
  if (maxPerUser > maxGlobal) {
    throw new Error("Per-user Agent concurrency cannot exceed the global limit.");
  }
}
