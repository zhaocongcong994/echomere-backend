import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";

import type { AgentEvent } from "../src/agent/types.ts";
import type {
  LLMChunk,
  LLMProvider,
  LLMRequest,
} from "../src/providers/llm-provider.ts";
import { MockLLMProvider } from "../src/providers/mock-provider.ts";
import { AgentMetrics } from "../src/observability/metrics.ts";
import { SqliteAgentStore } from "../src/repositories/sqlite-agent-store.ts";
import { createAgentServer } from "../src/server/app.ts";
import { RunConcurrencyLimiter } from "../src/server/run-concurrency.ts";
import type {
  RuntimeModelControl,
  RuntimeModelSnapshot,
} from "../src/server/runtime-model-controller.ts";
import {
  createLocalProfileFixture,
  LocalMockAgentTools,
} from "../src/tools/local-mock-tools.ts";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("local Agent HTTP/SSE server", () => {
  it("protects Agent API routes when a shared secret is configured", async () => {
    const store = new SqliteAgentStore(":memory:");
    const metrics = new AgentMetrics();
    const server = createAgentServer({
      provider: new MockLLMProvider(),
      tools: new LocalMockAgentTools([], { hexagrams: store }),
      runs: store,
      conversations: store,
      toolRuns: store,
      sharedSecret: "test-agent-secret",
      readinessCheck: () => store.healthCheck(),
      metrics,
      metricsToken: "test-metrics-token",
      runtimePolicy: {
        maxModelInputCharacters: 32_000,
        maxProviderRetries: 1,
        maxQualityRewrites: 1,
        providerRetryBaseDelayMs: 500,
        providerRetryMaxDelayMs: 4_000,
      },
      runtimeInfo: {
        profileSource: "legacy-env",
        activeProfileId: "default",
        profiles: [
          {
            id: "default",
            label: "mock / mock-v1",
            provider: "mock",
            model: "mock-v1",
            configured: true,
            active: true,
          },
        ],
        maxOutputTokens: 2_048,
        thinking: "disabled",
      },
    });
    const baseUrl = await listen(server);
    cleanups.push(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    });

    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    const ready = await fetch(`${baseUrl}/ready`, {
      headers: { "X-Request-Id": "agent-readiness-trace" },
    });
    assert.equal(ready.status, 200);
    assert.equal(ready.headers.get("x-request-id"), "agent-readiness-trace");

    const unauthorizedMetrics = await fetch(`${baseUrl}/metrics`);
    assert.equal(unauthorizedMetrics.status, 401);

    const unauthorized = await fetch(`${baseUrl}/api/agent/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "secret-user",
        clientRequestId: "secret-request-unauthorized",
        mode: "qingting",
        message: "test",
      }),
    });
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`${baseUrl}/api/agent/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Secret": "test-agent-secret",
      },
      body: JSON.stringify({
        userId: "secret-user",
        clientRequestId: "secret-request-authorized",
        mode: "qingting",
        message: "test",
      }),
    });
    assert.equal(authorized.status, 200);
    assert.match(await authorized.text(), /"type":"run_completed"/);

    const runtimeResponse = await fetch(`${baseUrl}/api/runtime`, {
      headers: { "X-Agent-Secret": "test-agent-secret" },
    });
    assert.equal(runtimeResponse.status, 200);
    const runtime = (await runtimeResponse.json()) as {
      provider: string;
      model: string;
      activeProfileId: string;
      profiles: Array<{ id: string; configured: boolean; active: boolean }>;
      restartRequiredToSwitch: boolean;
      switching: { enabled: boolean; persistsAcrossRestart: boolean };
      limits: { maxInputCharacters: number; maxOutputTokens: number };
      retry: { maxRetries: number; onlyBeforeFirstOutput: boolean };
      quality: { maxRewrites: number; buffersDraftUntilValidated: boolean };
    };
    assert.equal(runtime.provider, "mock");
    assert.equal(runtime.model, "mock-v1");
    assert.equal(runtime.activeProfileId, "default");
    assert.deepEqual(runtime.profiles, [
      {
        id: "default",
        label: "mock / mock-v1",
        provider: "mock",
        model: "mock-v1",
        configured: true,
        active: true,
      },
    ]);
    assert.equal(runtime.restartRequiredToSwitch, true);
    assert.deepEqual(runtime.switching, {
      enabled: false,
      mode: "disabled",
      persistsAcrossRestart: false,
      validation: "none",
    });
    assert.deepEqual(runtime.limits, {
      maxInputCharacters: 32_000,
      maxOutputTokens: 2_048,
    });
    assert.equal(runtime.retry.maxRetries, 1);
    assert.equal(runtime.retry.onlyBeforeFirstOutput, true);
    assert.deepEqual(runtime.quality, {
      maxRewrites: 1,
      buffersDraftUntilValidated: true,
    });
    assert.equal(JSON.stringify(runtime).includes("apiKey"), false);

    const metricsResponse = await fetch(`${baseUrl}/metrics`, {
      headers: { Authorization: "Bearer test-metrics-token" },
    });
    assert.equal(metricsResponse.status, 200);
    const metricText = await metricsResponse.text();
    assert.match(metricText, /echomere_agent_runs_total\{outcome="completed"\} 1/u);
    assert.match(metricText, /echomere_agent_model_input_tokens_total [1-9]\d*/u);
    assert.match(metricText, /echomere_agent_model_output_tokens_total [1-9]\d*/u);
    assert.match(metricText, /echomere_agent_quality_rewrites_total 0/u);
  });

  it("switches future runs while an active run keeps its provider snapshot", async () => {
    let releaseOldProvider!: () => void;
    let markOldProviderStarted!: () => void;
    const oldProviderStarted = new Promise<void>((resolve) => {
      markOldProviderStarted = resolve;
    });
    const oldProviderReleased = new Promise<void>((resolve) => {
      releaseOldProvider = resolve;
    });
    const oldProvider: LLMProvider = {
      name: "provider-a",
      model: "model-a",
      async *stream(): AsyncIterable<LLMChunk> {
        markOldProviderStarted();
        await oldProviderReleased;
        yield { type: "content", delta: "旧模型完成本次回答。" };
        yield { type: "usage", inputTokens: 10, outputTokens: 8 };
        yield { type: "completed", finishReason: "stop" };
      },
    };
    const newProvider: LLMProvider = {
      name: "provider-b",
      model: "model-b",
      async *stream(): AsyncIterable<LLMChunk> {
        yield { type: "content", delta: "新模型回答。" };
        yield { type: "completed", finishReason: "stop" };
      },
    };
    let activeProfileId = "profile-a";
    let activeProvider = oldProvider;
    const runtimeModels: RuntimeModelControl = {
      currentProvider: () => activeProvider,
      snapshot: () => runtimeSnapshot(activeProfileId, activeProvider),
      switchProfile: async (profileId) => {
        activeProfileId = profileId;
        activeProvider = newProvider;
        return runtimeSnapshot(activeProfileId, activeProvider);
      },
    };
    const store = new SqliteAgentStore(":memory:");
    const server = createAgentServer({
      provider: oldProvider,
      runtimeModels,
      tools: new LocalMockAgentTools([], { hexagrams: store }),
      runs: store,
      conversations: store,
      toolRuns: store,
    });
    const baseUrl = await listen(server);
    cleanups.push(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    });

    const response = await fetch(`${baseUrl}/api/agent/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "switch-user",
        clientRequestId: "switch-request",
        mode: "qingting",
        message: "测试请求级模型快照",
      }),
    });
    await oldProviderStarted;

    const switchResponse = await fetch(`${baseUrl}/api/runtime/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: "profile-b" }),
    });
    assert.equal(switchResponse.status, 200);
    assert.equal(
      ((await switchResponse.json()) as { activeProfileId: string })
        .activeProfileId,
      "profile-b",
    );
    releaseOldProvider();

    const events = parseSSE(await response.text());
    const completed = events.find((event) => event.type === "run_completed");
    assert.equal(
      completed?.type === "run_completed" ? completed.result.model : undefined,
      "model-a",
    );
    assert.equal(runtimeModels.currentProvider().model, "model-b");
  });

  it("streams an Agent run and exposes persisted conversation state", async () => {
    const store = new SqliteAgentStore(":memory:");
    const tools = new LocalMockAgentTools([createLocalProfileFixture("http-user")], {
      hexagrams: store,
    });
    const server = createAgentServer({
      provider: new MockLLMProvider(),
      tools,
      runs: store,
      conversations: store,
      toolRuns: store,
    });
    const baseUrl = await listen(server);
    cleanups.push(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    });

    const response = await fetch(`${baseUrl}/api/agent/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "http-user",
        conversationId: "http-conversation",
        clientRequestId: "http-request",
        mode: "kanyun",
        message: "看看今年的事业运",
      }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);

    const events = parseSSE(await response.text());
    assert.equal(events.some((event) => event.type === "tool_started"), true);
    assert.equal(events.at(-1)?.type, "run_completed");

    const conversationResponse = await fetch(
      `${baseUrl}/api/conversations/http-conversation?userId=http-user`,
    );
    assert.equal(conversationResponse.status, 200);
    const conversation = (await conversationResponse.json()) as {
      messages: Array<{ role: string }>;
    };
    assert.deepEqual(
      conversation.messages.map((message) => message.role),
      ["user", "assistant"],
    );

    const runResponse = await fetch(
      `${baseUrl}/api/runs/by-request/http-request?userId=http-user`,
    );
    const runData = (await runResponse.json()) as {
      run: { status: string };
      toolRuns: Array<{ status: string }>;
    };
    assert.equal(runData.run.status, "completed");
    assert.equal(runData.toolRuns.length, 2);
  });

  it("aborts an active model request when the client disconnects", async () => {
    let providerWasAborted = false;
    const slowProvider: LLMProvider = {
      name: "slow-provider",
      model: "slow-model",
      async *stream(
        _request: LLMRequest,
        options?: { signal?: AbortSignal },
      ): AsyncIterable<LLMChunk> {
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              providerWasAborted = true;
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        });
      },
    };
    const store = new SqliteAgentStore(":memory:");
    const server = createAgentServer({
      provider: slowProvider,
      tools: new LocalMockAgentTools([], { hexagrams: store }),
      runs: store,
      conversations: store,
      toolRuns: store,
      runLimiter: new RunConcurrencyLimiter(1, 1),
    });
    const baseUrl = await listen(server);
    cleanups.push(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    });

    const controller = new AbortController();
    const request = fetch(`${baseUrl}/api/agent/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": "agent-concurrency-trace",
      },
      body: JSON.stringify({
        userId: "abort-user",
        clientRequestId: "abort-request",
        mode: "qingting",
        message: "测试断线取消",
      }),
      signal: controller.signal,
    });
    const response = await request;
    assert.equal(response.headers.get("x-request-id"), "agent-concurrency-trace");

    const limited = await fetch(`${baseUrl}/api/agent/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "abort-user",
        clientRequestId: "concurrent-request",
        mode: "qingting",
        message: "测试并发保护",
      }),
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "1");
    controller.abort();
    await response.text().catch(() => undefined);

    for (let attempt = 0; attempt < 20 && !providerWasAborted; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(providerWasAborted, true);

    const run = await store.findByClientRequestId("abort-request");
    assert.equal(run?.status, "interrupted");
  });

  it("fails closed when the distributed concurrency store is unavailable", async () => {
    const store = new SqliteAgentStore(":memory:");
    const metrics = new AgentMetrics();
    const server = createAgentServer({
      provider: new MockLLMProvider(),
      tools: new LocalMockAgentTools([], { hexagrams: store }),
      runs: store,
      conversations: store,
      toolRuns: store,
      metrics,
      runLimiter: {
        store: "redis",
        tryAcquire: async () => {
          throw new Error("redis unavailable");
        },
        healthCheck: async () => {
          throw new Error("redis unavailable");
        },
        close: async () => undefined,
      },
    });
    const baseUrl = await listen(server);
    cleanups.push(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    });

    const response = await fetch(`${baseUrl}/api/agent/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "redis-user",
        clientRequestId: "redis-unavailable-request",
        mode: "qingting",
        message: "测试 Redis 故障",
      }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json() as { error: string }).error, "agent_concurrency_unavailable");
    assert.match(
      metrics.toPrometheus(),
      /outcome="concurrency_unavailable"\} 1/u,
    );
  });
});

async function listen(server: ReturnType<typeof createAgentServer>): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function parseSSE(text: string): AgentEvent[] {
  return text
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as AgentEvent);
}

function runtimeSnapshot(
  activeProfileId: string,
  provider: LLMProvider,
): RuntimeModelSnapshot {
  return {
    provider: provider.name,
    model: provider.model,
    modelSelection: "profile-file",
    activeProfileId,
    profiles: ["profile-a", "profile-b"].map((id) => ({
      id,
      label: id,
      provider: "openai-compatible",
      model: id === "profile-a" ? "model-a" : "model-b",
      configured: true,
      active: id === activeProfileId,
    })),
    restartRequiredToSwitch: false,
    switching: {
      enabled: true,
      mode: "local",
      persistsAcrossRestart: true,
      validation: "provider-model-list",
    },
    maxOutputTokens: 2_048,
    thinking: "disabled",
  };
}
