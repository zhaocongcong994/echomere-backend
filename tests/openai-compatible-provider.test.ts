import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LLMProviderError,
  type LLMChunk,
  type LLMRequest,
} from "../src/providers/llm-provider.ts";
import { OpenAICompatibleLLMProvider } from "../src/providers/openai-compatible-provider.ts";

const request: LLMRequest = {
  messages: [
    { role: "system", content: "Only return the final answer." },
    { role: "user", content: "Hello" },
  ],
  metadata: { runId: "run-provider-test", mode: "qingting" },
};

async function collect(stream: AsyncIterable<LLMChunk>): Promise<LLMChunk[]> {
  const chunks: LLMChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function createProvider(fetchFn: typeof fetch, timeoutMs = 1_000) {
  return new OpenAICompatibleLLMProvider({
    providerName: "deepseek",
    apiKey: "test-key-that-is-not-real",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    timeoutMs,
    maxTokens: 256,
    thinking: "disabled",
    fetchFn,
  });
}

describe("OpenAICompatibleLLMProvider", () => {
  it("streams final content and usage while discarding reasoning_content", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const body = [
        ": keep-alive",
        "",
        'data: {"choices":[{"delta":{"reasoning_content":"private reasoning"},"finish_reason":null}],"usage":null}',
        "",
        'data: {"choices":[{"delta":{"content":"最终"},"finish_reason":null}],"usage":null}',
        "",
        'data: {"choices":[{"delta":{"content":"答案"},"finish_reason":"stop"}],"usage":null}',
        "",
        'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4}}',
        "",
        "data: [DONE]",
        "",
      ].join("\n");
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;

    const chunks = await collect(createProvider(fetchFn).stream(request));
    const content = chunks
      .filter((chunk) => chunk.type === "content")
      .map((chunk) => chunk.delta)
      .join("");

    assert.equal(content, "最终答案");
    assert.equal(content.includes("private reasoning"), false);
    assert.deepEqual(
      chunks.find((chunk) => chunk.type === "usage"),
      { type: "usage", inputTokens: 12, outputTokens: 4 },
    );
    assert.deepEqual(chunks.at(-1), {
      type: "completed",
      finishReason: "stop",
    });
    assert.equal(requestBody?.model, "deepseek-v4-flash");
    assert.deepEqual(requestBody?.stream_options, { include_usage: true });
    assert.deepEqual(requestBody?.thinking, { type: "disabled" });
    assert.equal(requestBody?.reasoning_effort, undefined);
  });

  it("sends reasoning effort only when thinking mode is enabled", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;
    const provider = new OpenAICompatibleLLMProvider({
      providerName: "deepseek",
      apiKey: "test-key-that-is-not-real",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      timeoutMs: 1_000,
      maxTokens: 256,
      thinking: "enabled",
      reasoningEffort: "high",
      fetchFn,
    });

    await collect(provider.stream(request));

    assert.deepEqual(requestBody?.thinking, { type: "enabled" });
    assert.equal(requestBody?.reasoning_effort, "high");
  });

  it("rejects a stream that closes before the completion marker", async () => {
    const fetchFn = (async () =>
      new Response(
        'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      )) as typeof fetch;

    await assert.rejects(
      async () => collect(createProvider(fetchFn).stream(request)),
      (error: unknown) =>
        error instanceof LLMProviderError &&
        error.code === "provider_invalid_stream" &&
        error.retryable === true,
    );
  });

  it("maps authentication errors to a non-retryable structured error", async () => {
    const fetchFn = (async () => new Response("unauthorized", { status: 401 })) as typeof fetch;

    await assert.rejects(
      async () => collect(createProvider(fetchFn).stream(request)),
      (error: unknown) =>
        error instanceof LLMProviderError &&
        error.code === "provider_unauthorized" &&
        error.retryable === false,
    );
  });

  it("maps request timeout to a retryable structured error", async () => {
    const fetchFn = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      })) as typeof fetch;

    await assert.rejects(
      async () => collect(createProvider(fetchFn, 5).stream(request)),
      (error: unknown) =>
        error instanceof LLMProviderError &&
        error.code === "provider_timeout" &&
        error.retryable === true,
    );
  });

  it("propagates caller cancellation as AbortError", async () => {
    const fetchFn = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      })) as typeof fetch;
    const controller = new AbortController();
    const result = collect(
      createProvider(fetchFn, 1_000).stream(request, { signal: controller.signal }),
    );
    setTimeout(() => controller.abort(), 0);

    await assert.rejects(
      result,
      (error: unknown) => error instanceof DOMException && error.name === "AbortError",
    );
  });
});
