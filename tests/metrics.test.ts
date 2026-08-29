import assert from "node:assert/strict";
import test from "node:test";

import { AgentMetrics } from "../src/observability/metrics.ts";

test("quality rewrite metrics separate repairs from low-quality completions", () => {
  const metrics = new AgentMetrics();
  metrics.qualityRewritten(2);
  metrics.lowQualityCompleted();

  const output = metrics.toPrometheus();
  assert.match(output, /echomere_agent_quality_rewrites_total 2/u);
  assert.match(output, /echomere_agent_low_quality_completions_total 1/u);
  assert.match(output, /echomere_agent_provider_retries_total 0/u);
});
