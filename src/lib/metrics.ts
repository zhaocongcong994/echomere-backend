import type { NextFunction, Request, Response } from "express";
import type { StructuredLogger } from "./logger.js";

interface HttpBucket {
  count: number;
  durationMs: number;
}

export class ServiceMetrics {
  private readonly startedAt = Date.now();
  private readonly httpBuckets = new Map<string, HttpBucket>();
  private activeRequests = 0;
  private rateLimitedRequests = 0;
  private internalErrors = 0;
  private readonly runtimeModelSwitches = new Map<string, number>();

  requestStarted(): void {
    this.activeRequests += 1;
  }

  requestFinished(method: string, statusCode: number, durationMs: number): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    const statusClass = `${Math.floor(statusCode / 100)}xx`;
    const key = `${method.toUpperCase()}:${statusClass}`;
    const current = this.httpBuckets.get(key) ?? { count: 0, durationMs: 0 };
    current.count += 1;
    current.durationMs += durationMs;
    this.httpBuckets.set(key, current);
  }

  rateLimited(): void {
    this.rateLimitedRequests += 1;
  }

  internalError(): void {
    this.internalErrors += 1;
  }

  runtimeModelSwitch(outcome: "succeeded" | "denied" | "failed"): void {
    this.runtimeModelSwitches.set(
      outcome,
      (this.runtimeModelSwitches.get(outcome) ?? 0) + 1,
    );
  }

  toPrometheus(): string {
    const lines = [
      "# HELP echomere_backend_uptime_seconds Process uptime in seconds.",
      "# TYPE echomere_backend_uptime_seconds gauge",
      `echomere_backend_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1_000)}`,
      "# HELP echomere_backend_http_requests_active Active HTTP requests.",
      "# TYPE echomere_backend_http_requests_active gauge",
      `echomere_backend_http_requests_active ${this.activeRequests}`,
      "# HELP echomere_backend_http_requests_total Completed HTTP requests.",
      "# TYPE echomere_backend_http_requests_total counter",
    ];
    for (const [key, bucket] of [...this.httpBuckets].sort()) {
      const [method, statusClass] = key.split(":");
      lines.push(
        `echomere_backend_http_requests_total{method="${method}",status_class="${statusClass}"} ${bucket.count}`,
      );
    }
    lines.push(
      "# HELP echomere_backend_http_request_duration_milliseconds_sum Total request duration.",
      "# TYPE echomere_backend_http_request_duration_milliseconds_sum counter",
    );
    for (const [key, bucket] of [...this.httpBuckets].sort()) {
      const [method, statusClass] = key.split(":");
      lines.push(
        `echomere_backend_http_request_duration_milliseconds_sum{method="${method}",status_class="${statusClass}"} ${bucket.durationMs.toFixed(3)}`,
      );
    }
    lines.push(
      "# HELP echomere_backend_chat_rate_limited_total Rejected chat requests.",
      "# TYPE echomere_backend_chat_rate_limited_total counter",
      `echomere_backend_chat_rate_limited_total ${this.rateLimitedRequests}`,
      "# HELP echomere_backend_internal_errors_total Unhandled server errors.",
      "# TYPE echomere_backend_internal_errors_total counter",
      `echomere_backend_internal_errors_total ${this.internalErrors}`,
    );
    lines.push(
      "# HELP echomere_backend_runtime_model_switches_total Runtime model switch attempts by outcome.",
      "# TYPE echomere_backend_runtime_model_switches_total counter",
    );
    for (const outcome of ["succeeded", "denied", "failed"] as const) {
      lines.push(
        `echomere_backend_runtime_model_switches_total{outcome="${outcome}"} ${this.runtimeModelSwitches.get(outcome) ?? 0}`,
      );
    }
    lines.push("");
    return lines.join("\n");
  }
}

export function observabilityMiddleware(
  metrics: ServiceMetrics,
  logger: StructuredLogger,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = performance.now();
    metrics.requestStarted();
    let recorded = false;
    const record = (): void => {
      if (recorded) return;
      recorded = true;
      const durationMs = performance.now() - startedAt;
      metrics.requestFinished(req.method, res.statusCode, durationMs);
      logger.info("http_request_completed", {
        requestId: res.getHeader("X-Request-Id"),
        method: req.method,
        path: normalizedPath(req),
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(3)),
      });
    };
    res.once("finish", record);
    res.once("close", record);
    next();
  };
}

export function metricsAuthorization(token: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!token) {
      next();
      return;
    }
    if (req.headers.authorization === `Bearer ${token}`) {
      next();
      return;
    }
    res.status(401).json({ error: "metrics_unauthorized" });
  };
}

function normalizedPath(req: Request): string {
  const routePath = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof routePath === "string") return `${req.baseUrl}${routePath}`;
  return req.path.replace(/\/[0-9a-f]{8,}(?=\/|$)/giu, "/:id");
}
