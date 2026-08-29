import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { verifyToken, isTokenBlacklisted, type JwtPayload } from "./lib/auth.js";
import { serializeError } from "./lib/logger.js";
import { backendLogger, backendMetrics } from "./lib/observability.js";
import type { RateLimiter } from "./lib/rate-limit.js";

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  requestId?: string;
}

export function requestIdMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers["x-request-id"];
  const requestId =
    typeof incoming === "string" && /^[A-Za-z0-9._:-]{1,128}$/u.test(incoming)
      ? incoming
      : randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    req.user = verifyToken(token);
    if (await isTokenBlacklisted(token)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

export function userRateLimitMiddleware(limiter: RateLimiter) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    let decision;
    try {
      decision = await limiter.consume(userId);
    } catch (error) {
      backendLogger.error("chat_rate_limit_unavailable", {
        requestId: req.requestId,
        store: limiter.store,
        ...serializeError(error),
      });
      res.setHeader("Retry-After", "1");
      res.status(503).json({
        error: "CHAT_RATE_LIMIT_UNAVAILABLE",
        message: "Chat protection is temporarily unavailable.",
        retryAfterSeconds: 1,
        requestId: req.requestId,
      });
      return;
    }
    res.setHeader("X-RateLimit-Limit", String(decision.limit));
    res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(decision.resetAt / 1_000)));
    if (!decision.allowed) {
      backendMetrics.rateLimited();
      res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      res.status(429).json({
        error: "CHAT_RATE_LIMITED",
        message: "Too many chat requests. Please retry later.",
        retryAfterSeconds: decision.retryAfterSeconds,
        requestId: req.requestId,
      });
      return;
    }
    next();
  };
}

export function errorHandler(
  err: Error,
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction
): void {
  backendMetrics.internalError();
  backendLogger.error("unhandled_request_error", {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    ...serializeError(err),
  });
  res.status(500).json({
    error: "Internal server error",
    requestId: req.requestId,
  });
}
