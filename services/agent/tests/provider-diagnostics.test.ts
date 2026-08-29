import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LLMRuntimeConfig } from "../src/config/llm-config.ts";
import { LLMProviderError } from "../src/providers/llm-provider.ts";
import { diagnoseLLMProvider } from "../src/providers/provider-diagnostics.ts";

const config: LLMRuntimeConfig = {
  provider: "deepseek",
  apiKey: "test-key-that-is-not-real",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  timeoutMs: 1_000,
  maxTokens: 256,
  thinking: "disabled",
};

describe("LLM provider diagnostics", () => {
  it("verifies the credential endpoint and configured model without exposing the key", async () => {
    let requestUrl = "";
    let authorization = "";
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({
        object: "list",
        data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }],
      });
    }) as typeof fetch;

    const result = await diagnoseLLMProvider(config, { fetchFn });

    assert.equal(requestUrl, "https://api.deepseek.com/models");
    assert.equal(authorization, "Bearer test-key-that-is-not-real");
    assert.equal(result.model, "deepseek-v4-flash");
    assert.equal(result.endpointOrigin, "https://api.deepseek.com");
    assert.equal(result.availableModelCount, 2);
    assert.equal(JSON.stringify(result).includes(config.apiKey ?? ""), false);
  });

  it("reports a configured model that is absent from the provider list", async () => {
    const fetchFn = (async () =>
      Response.json({ data: [{ id: "deepseek-v4-pro" }] })) as typeof fetch;

    await assert.rejects(
      diagnoseLLMProvider(config, { fetchFn }),
      (error: unknown) =>
        error instanceof LLMProviderError &&
        error.code === "provider_model_not_found" &&
        error.retryable === false,
    );
  });

  it("maps diagnostic timeout to a retryable provider error", async () => {
    const fetchFn = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      })) as typeof fetch;

    await assert.rejects(
      diagnoseLLMProvider(config, { fetchFn, timeoutMs: 5 }),
      (error: unknown) =>
        error instanceof LLMProviderError &&
        error.code === "provider_timeout" &&
        error.retryable === true,
    );
  });
});
