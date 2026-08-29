import { createJsonLogger, serializeError } from "./logger.js";
import { createRateLimiterFromEnv, type RateLimiter } from "./rate-limit.js";

const logger = createJsonLogger();
let limiter: RateLimiter | undefined;

export function getChatRateLimiter(): RateLimiter {
  limiter ??= createRateLimiterFromEnv(process.env, (error) => {
    logger.error("redis_client_error", serializeError(error));
  });
  return limiter;
}

export async function checkChatRateLimiter(): Promise<void> {
  await getChatRateLimiter().healthCheck();
}

export async function closeChatRateLimiter(): Promise<void> {
  if (!limiter) return;
  await limiter.close();
  limiter = undefined;
}

export function chatRateLimitStore(): "memory" | "redis" {
  return getChatRateLimiter().store;
}
