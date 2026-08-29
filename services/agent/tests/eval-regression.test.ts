import assert from "node:assert/strict";
import test from "node:test";
import { runRegressionSuite } from "../src/evals/run-regression.ts";
import { MockLLMProvider } from "../src/providers/mock-provider.ts";

test("four-mode regression suite produces a machine-readable passing report", async () => {
  const report = await runRegressionSuite(new MockLLMProvider());
  assert.equal(report.live, false);
  assert.equal(report.cases.length, 8);
  assert.equal(report.passed, 8);
  assert.equal(report.failed, 0);
  assert.ok(report.totalDurationMs >= 0);
  assert.ok(report.totalInputTokens > 0);
  assert.ok(report.totalOutputTokens > 0);
  assert.ok(report.cases.every((item) => Object.values(item.checks).every(Boolean)));
});
