import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runAgent } from "../src/agent/run-agent.ts";
import type { AgentEvent } from "../src/agent/types.ts";
import {
  LLMProviderError,
  type LLMProvider,
} from "../src/providers/llm-provider.ts";
import { MockLLMProvider } from "../src/providers/mock-provider.ts";
import { MemoryAgentRunRepository } from "../src/repositories/memory-repository.ts";
import { LocalMockAgentTools } from "../src/tools/local-mock-tools.ts";

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const result: AgentEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

describe("runAgent", () => {
  it("completes a local mock run with the expected state sequence", async () => {
    const events = await collect(
      runAgent(
        {
          userId: "user-1",
          clientRequestId: "request-1",
          mode: "qingting",
          message: "最近工作压力很大",
        },
        {
          provider: new MockLLMProvider(),
          runs: new MemoryAgentRunRepository(),
          tools: new LocalMockAgentTools(),
          idFactory: (() => {
            let index = 0;
            return () => `id-${++index}`;
          })(),
        },
      ),
    );

    const states = events
      .filter((event) => event.type === "state_changed")
      .map((event) => event.state);
    assert.deepEqual(states, [
      "received",
      "validated",
      "context_loaded",
      "generating",
      "validating",
      "persisting",
      "completed",
    ]);

    const completed = events.find((event) => event.type === "run_completed");
    assert.equal(completed?.type, "run_completed");
    if (completed?.type === "run_completed") {
      assert.match(completed.result.contentMarkdown, /本地 Mock 响应/);
      assert.equal(completed.result.model, "mock-v1");
    }
  });

  it("returns a structured failure for invalid input", async () => {
    const events = await collect(
      runAgent(
        {
          userId: "user-1",
          clientRequestId: "request-invalid",
          mode: "unknown",
          message: "hello",
        },
        {
          provider: new MockLLMProvider(),
          runs: new MemoryAgentRunRepository(),
          tools: new LocalMockAgentTools(),
        },
      ),
    );

    const failure = events.at(-1);
    assert.equal(failure?.type, "run_failed");
    if (failure?.type === "run_failed") {
      assert.equal(failure.code, "invalid_input");
      assert.equal(failure.retryable, false);
    }
  });

  it("reuses a completed result for the same clientRequestId", async () => {
    const repository = new MemoryAgentRunRepository();
    const input = {
      userId: "user-1",
      clientRequestId: "request-idempotent",
      mode: "qingting" as const,
      message: "测试幂等",
    };
    const dependencies = {
      provider: new MockLLMProvider(),
      runs: repository,
      tools: new LocalMockAgentTools(),
    };

    const first = await collect(runAgent(input, dependencies));
    const second = await collect(runAgent(input, dependencies));
    const firstCompleted = first.find((event) => event.type === "run_completed");
    const secondCompleted = second.find((event) => event.type === "run_completed");

    assert.equal(firstCompleted?.type, "run_completed");
    assert.equal(secondCompleted?.type, "run_completed");
    if (secondCompleted?.type === "run_completed") {
      assert.equal(secondCompleted.reused, true);
    }
    if (firstCompleted?.type === "run_completed" && secondCompleted?.type === "run_completed") {
      assert.equal(secondCompleted.runId, firstCompleted.runId);
    }
  });

  it("preserves structured provider errors in Agent failure events", async () => {
    const failingProvider: LLMProvider = {
      name: "failing-provider",
      model: "failing-model",
      async *stream() {
        throw new LLMProviderError({
          code: "provider_rate_limited",
          message: "Provider rate limit reached.",
          retryable: true,
          status: 429,
        });
      },
    };
    const events = await collect(
      runAgent(
        {
          userId: "user-provider-error",
          clientRequestId: "request-provider-error",
          mode: "qingting",
          message: "测试模型失败",
        },
        {
          provider: failingProvider,
          runs: new MemoryAgentRunRepository(),
          tools: new LocalMockAgentTools(),
          runtimePolicy: runtimePolicy({ maxProviderRetries: 0 }),
        },
      ),
    );

    const failure = events.at(-1);
    assert.equal(failure?.type, "run_failed");
    if (failure?.type === "run_failed") {
      assert.equal(failure.code, "provider_rate_limited");
      assert.equal(failure.retryable, true);
    }
  });

  it("retries a retryable provider failure only before the first output", async () => {
    let attempts = 0;
    const flakyProvider: LLMProvider = {
      name: "flaky-provider",
      model: "flaky-model",
      async *stream() {
        attempts += 1;
        if (attempts === 1) {
          throw new LLMProviderError({
            code: "provider_unavailable",
            message: "Provider temporarily unavailable.",
            retryable: true,
            status: 503,
          });
        }
        yield { type: "content", delta: "重试后成功。" } as const;
        yield { type: "usage", inputTokens: 20, outputTokens: 5 } as const;
        yield { type: "completed", finishReason: "stop" } as const;
      },
    };

    const events = await collect(
      runAgent(
        {
          userId: "user-provider-retry",
          clientRequestId: "request-provider-retry",
          mode: "qingting",
          message: "测试模型重试",
        },
        {
          provider: flakyProvider,
          runs: new MemoryAgentRunRepository(),
          tools: new LocalMockAgentTools(),
          runtimePolicy: runtimePolicy({ maxProviderRetries: 1 }),
        },
      ),
    );

    assert.equal(attempts, 2);
    assert.deepEqual(
      events
        .filter((event) => event.type === "state_changed")
        .map((event) => event.state)
        .filter((state) => state === "retrying" || state === "generating"),
      ["generating", "retrying", "generating"],
    );
    const completed = events.at(-1);
    assert.equal(completed?.type, "run_completed");
    if (completed?.type === "run_completed") {
      assert.equal(completed.result.providerAttempts, 2);
      assert.ok((completed.result.modelInputCharacters ?? 0) > 0);
      assert.deepEqual(completed.result.usage, {
        inputTokens: 20,
        outputTokens: 5,
      });
    }
  });

  it("hides a low-quality draft and streams only the rewritten answer", async () => {
    let attempts = 0;
    const systemPrompts: string[] = [];
    const provider: LLMProvider = {
      name: "quality-rewrite-provider",
      model: "quality-rewrite-model",
      async *stream(request) {
        attempts += 1;
        systemPrompts.push(request.messages[0]?.content ?? "");
        const content =
          attempts === 1
            ? "好。"
            : "听起来你正在整理头绪。今天可以先写下一个小行动。你想先处理哪一件事？";
        yield { type: "content", delta: content } as const;
        yield {
          type: "usage",
          inputTokens: attempts * 10,
          outputTokens: attempts * 2,
        } as const;
        yield { type: "completed", finishReason: "stop" } as const;
      },
    };

    const events = await collect(
      runAgent(
        {
          userId: "quality-rewrite-user",
          clientRequestId: "quality-rewrite-request",
          mode: "qingting",
          message: "请帮我整理一下想法。",
        },
        {
          provider,
          runs: new MemoryAgentRunRepository(),
          tools: new LocalMockAgentTools(),
          runtimePolicy: runtimePolicy({ maxQualityRewrites: 1 }),
        },
      ),
    );

    assert.equal(attempts, 2);
    assert.doesNotMatch(systemPrompts[0] ?? "", /质量修复指令/u);
    assert.match(systemPrompts[1] ?? "", /质量修复指令/u);
    const visibleContent = events
      .filter((event) => event.type === "content_delta")
      .map((event) => event.delta)
      .join("");
    assert.doesNotMatch(visibleContent, /^好。$/u);
    assert.match(visibleContent, /今天可以先/u);
    assert.equal(
      events.some(
        (event) =>
          event.type === "state_changed" &&
          event.state === "retrying" &&
          event.reason === "quality_rewrite",
      ),
      true,
    );
    const completed = events.at(-1);
    assert.equal(completed?.type, "run_completed");
    if (completed?.type === "run_completed") {
      assert.equal(completed.result.qualityRewriteCount, 1);
      assert.deepEqual(
        completed.result.qualityAttempts.map((quality) => quality.passed),
        [false, true],
      );
      assert.equal(completed.result.providerAttempts, 2);
      assert.deepEqual(completed.result.usage, {
        inputTokens: 30,
        outputTokens: 6,
      });
    }
  });

  it("audits a final low-quality answer after the rewrite budget is exhausted", async () => {
    let attempts = 0;
    const provider: LLMProvider = {
      name: "quality-exhausted-provider",
      model: "quality-exhausted-model",
      async *stream() {
        attempts += 1;
        yield { type: "content", delta: "好。" } as const;
        yield { type: "completed", finishReason: "stop" } as const;
      },
    };
    const events = await collect(
      runAgent(
        {
          userId: "quality-exhausted-user",
          clientRequestId: "quality-exhausted-request",
          mode: "qingting",
          message: "请给一个小行动。",
        },
        {
          provider,
          runs: new MemoryAgentRunRepository(),
          tools: new LocalMockAgentTools(),
          runtimePolicy: runtimePolicy({ maxQualityRewrites: 1 }),
        },
      ),
    );

    assert.equal(attempts, 2);
    const visibleContent = events
      .filter((event) => event.type === "content_delta")
      .map((event) => event.delta)
      .join("");
    assert.equal(visibleContent, "好。");
    const completed = events.at(-1);
    assert.equal(completed?.type, "run_completed");
    if (completed?.type === "run_completed") {
      assert.equal(completed.result.quality.passed, false);
      assert.equal(completed.result.qualityRewriteCount, 1);
      assert.equal(completed.result.qualityAttempts.length, 2);
    }
  });

  it("does not expose or retry a partial model draft after transport failure", async () => {
    let attempts = 0;
    const partialProvider: LLMProvider = {
      name: "partial-provider",
      model: "partial-model",
      async *stream() {
        attempts += 1;
        yield { type: "content", delta: "部分回答" } as const;
        throw new LLMProviderError({
          code: "provider_network_error",
          message: "Connection lost after output.",
          retryable: true,
        });
      },
    };
    const events = await collect(
      runAgent(
        {
          userId: "user-provider-partial",
          clientRequestId: "request-provider-partial",
          mode: "qingting",
          message: "测试部分输出",
        },
        {
          provider: partialProvider,
          runs: new MemoryAgentRunRepository(),
          tools: new LocalMockAgentTools(),
          runtimePolicy: runtimePolicy({ maxProviderRetries: 3 }),
        },
      ),
    );

    assert.equal(attempts, 1);
    assert.equal(events.some((event) => event.type === "content_delta"), false);
    assert.equal(
      events.some(
        (event) => event.type === "state_changed" && event.state === "retrying",
      ),
      false,
    );
    const failure = events.at(-1);
    assert.equal(failure?.type, "run_failed");
    if (failure?.type === "run_failed") {
      assert.equal(failure.code, "provider_network_error");
    }
  });

  it("rejects an oversized assembled model request before provider usage", async () => {
    let attempts = 0;
    const provider: LLMProvider = {
      name: "budget-provider",
      model: "budget-model",
      async *stream() {
        attempts += 1;
        yield { type: "completed", finishReason: "stop" } as const;
      },
    };
    const events = await collect(
      runAgent(
        {
          userId: "user-input-budget",
          clientRequestId: "request-input-budget",
          mode: "qingting",
          message: "测试输入预算",
        },
        {
          provider,
          runs: new MemoryAgentRunRepository(),
          tools: new LocalMockAgentTools(),
          runtimePolicy: runtimePolicy({ maxModelInputCharacters: 10 }),
        },
      ),
    );

    assert.equal(attempts, 0);
    const failure = events.at(-1);
    assert.equal(failure?.type, "run_failed");
    if (failure?.type === "run_failed") {
      assert.equal(failure.code, "model_input_budget_exceeded");
      assert.equal(failure.retryable, false);
    }
  });

  it("does not persist a successful answer when the provider output is truncated", async () => {
    const truncatedProvider: LLMProvider = {
      name: "truncated-provider",
      model: "truncated-model",
      async *stream() {
        yield { type: "content", delta: "This answer is only partial." } as const;
        yield { type: "completed", finishReason: "length" } as const;
      },
    };
    const events = await collect(
      runAgent(
        {
          userId: "user-provider-truncated",
          clientRequestId: "request-provider-truncated",
          mode: "qingting",
          message: "测试模型截断",
        },
        {
          provider: truncatedProvider,
          runs: new MemoryAgentRunRepository(),
          tools: new LocalMockAgentTools(),
        },
      ),
    );

    assert.equal(events.some((event) => event.type === "run_completed"), false);
    const failure = events.at(-1);
    assert.equal(failure?.type, "run_failed");
    if (failure?.type === "run_failed") {
      assert.equal(failure.code, "provider_output_truncated");
      assert.equal(failure.retryable, true);
    }
  });
});

function runtimePolicy(
  overrides: Partial<{
    maxModelInputCharacters: number;
    maxProviderRetries: number;
    maxQualityRewrites: number;
    providerRetryBaseDelayMs: number;
    providerRetryMaxDelayMs: number;
  }> = {},
) {
  return {
    maxModelInputCharacters: 32_000,
    maxProviderRetries: 1,
    maxQualityRewrites: 0,
    providerRetryBaseDelayMs: 0,
    providerRetryMaxDelayMs: 0,
    ...overrides,
  };
}
