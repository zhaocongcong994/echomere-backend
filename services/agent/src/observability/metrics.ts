export type AgentRunOutcome =
  | "completed"
  | "failed"
  | "interrupted"
  | "waiting_input"
  | "rate_limited"
  | "concurrency_unavailable";

interface HttpBucket {
  count: number;
  durationMs: number;
}

export class AgentMetrics {
  private readonly startedAt = Date.now();
  private readonly httpBuckets = new Map<string, HttpBucket>();
  private readonly runOutcomes = new Map<AgentRunOutcome, number>();
  private activeRequests = 0;
  private activeRuns = 0;
  private providerRetries = 0;
  private qualityRewrites = 0;
  private lowQualityCompletions = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  requestStarted(): void {
    this.activeRequests += 1;
  }

  requestFinished(method: string, statusCode: number, durationMs: number): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    const statusClass = `${Math.floor(statusCode / 100)}xx`;
    const key = `${method.toUpperCase()}:${statusClass}`;
    const bucket = this.httpBuckets.get(key) ?? { count: 0, durationMs: 0 };
    bucket.count += 1;
    bucket.durationMs += durationMs;
    this.httpBuckets.set(key, bucket);
  }

  runStarted(): void {
    this.activeRuns += 1;
  }

  runFinished(outcome: AgentRunOutcome): void {
    this.activeRuns = Math.max(0, this.activeRuns - 1);
    this.runOutcomes.set(outcome, (this.runOutcomes.get(outcome) ?? 0) + 1);
  }

  runRejected(): void {
    this.runOutcomes.set(
      "rate_limited",
      (this.runOutcomes.get("rate_limited") ?? 0) + 1,
    );
  }

  concurrencyUnavailable(): void {
    this.runOutcomes.set(
      "concurrency_unavailable",
      (this.runOutcomes.get("concurrency_unavailable") ?? 0) + 1,
    );
  }

  providerRetried(): void {
    this.providerRetries += 1;
  }

  qualityRewritten(count = 1): void {
    this.qualityRewrites += Math.max(0, count);
  }

  lowQualityCompleted(): void {
    this.lowQualityCompletions += 1;
  }

  modelUsage(inputTokens: number, outputTokens: number): void {
    this.inputTokens += Math.max(0, inputTokens);
    this.outputTokens += Math.max(0, outputTokens);
  }

  toPrometheus(): string {
    const lines = [
      "# HELP echomere_agent_uptime_seconds Process uptime in seconds.",
      "# TYPE echomere_agent_uptime_seconds gauge",
      `echomere_agent_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1_000)}`,
      "# HELP echomere_agent_http_requests_active Active HTTP requests.",
      "# TYPE echomere_agent_http_requests_active gauge",
      `echomere_agent_http_requests_active ${this.activeRequests}`,
      "# HELP echomere_agent_http_requests_total Completed HTTP requests.",
      "# TYPE echomere_agent_http_requests_total counter",
    ];
    for (const [key, bucket] of [...this.httpBuckets].sort()) {
      const [method, statusClass] = key.split(":");
      lines.push(
        `echomere_agent_http_requests_total{method="${method}",status_class="${statusClass}"} ${bucket.count}`,
      );
    }
    lines.push(
      "# HELP echomere_agent_http_request_duration_milliseconds_sum Total request duration.",
      "# TYPE echomere_agent_http_request_duration_milliseconds_sum counter",
    );
    for (const [key, bucket] of [...this.httpBuckets].sort()) {
      const [method, statusClass] = key.split(":");
      lines.push(
        `echomere_agent_http_request_duration_milliseconds_sum{method="${method}",status_class="${statusClass}"} ${bucket.durationMs.toFixed(3)}`,
      );
    }
    lines.push(
      "# HELP echomere_agent_runs_active Active Agent runs.",
      "# TYPE echomere_agent_runs_active gauge",
      `echomere_agent_runs_active ${this.activeRuns}`,
      "# HELP echomere_agent_runs_total Terminal Agent runs by outcome.",
      "# TYPE echomere_agent_runs_total counter",
    );
    for (const outcome of [
      "completed",
      "failed",
      "interrupted",
      "waiting_input",
      "rate_limited",
      "concurrency_unavailable",
    ] as const) {
      lines.push(
        `echomere_agent_runs_total{outcome="${outcome}"} ${this.runOutcomes.get(outcome) ?? 0}`,
      );
    }
    lines.push(
      "# HELP echomere_agent_provider_retries_total Model provider retries scheduled before any output.",
      "# TYPE echomere_agent_provider_retries_total counter",
      `echomere_agent_provider_retries_total ${this.providerRetries}`,
      "# HELP echomere_agent_quality_rewrites_total Drafts regenerated after failing the response quality contract.",
      "# TYPE echomere_agent_quality_rewrites_total counter",
      `echomere_agent_quality_rewrites_total ${this.qualityRewrites}`,
      "# HELP echomere_agent_low_quality_completions_total Final responses still below the quality threshold after configured rewrites.",
      "# TYPE echomere_agent_low_quality_completions_total counter",
      `echomere_agent_low_quality_completions_total ${this.lowQualityCompletions}`,
      "# HELP echomere_agent_model_input_tokens_total Model input tokens reported by providers.",
      "# TYPE echomere_agent_model_input_tokens_total counter",
      `echomere_agent_model_input_tokens_total ${this.inputTokens}`,
      "# HELP echomere_agent_model_output_tokens_total Model output tokens reported by providers.",
      "# TYPE echomere_agent_model_output_tokens_total counter",
      `echomere_agent_model_output_tokens_total ${this.outputTokens}`,
    );
    lines.push("");
    return lines.join("\n");
  }
}
