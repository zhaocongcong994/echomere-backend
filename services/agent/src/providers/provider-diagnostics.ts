import type { LLMRuntimeConfig } from "../config/llm-config.ts";
import { LLMProviderError } from "./llm-provider.ts";
import { createLLMProviderHttpError } from "./openai-compatible-provider.ts";

type FetchLike = typeof fetch;

export interface LLMProviderDiagnosticResult {
  ok: true;
  provider: string;
  model: string;
  endpointOrigin: string;
  availableModelCount: number;
  durationMs: number;
}

export async function diagnoseLLMProvider(
  config: LLMRuntimeConfig,
  options: {
    fetchFn?: FetchLike;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<LLMProviderDiagnosticResult> {
  if (config.provider === "mock" || !config.apiKey || !config.baseUrl) {
    throw new LLMProviderError({
      code: "provider_bad_request",
      message:
        "A real LLM provider is not active. Set LLM_PROVIDER and a newly generated LLM_API_KEY in .env.local.",
      retryable: false,
    });
  }

  const startedAt = performance.now();
  const timeoutMs = options.timeoutMs ?? Math.min(config.timeoutMs, 10_000);
  const requestController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    requestController.abort(new DOMException("Provider diagnostic timed out.", "TimeoutError"));
  }, timeoutMs);
  timeout.unref();
  const abortFromCaller = () => requestController.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    if (options.signal?.aborted) {
      throw new DOMException("The provider diagnostic was aborted.", "AbortError");
    }

    const modelsEndpoint = `${config.baseUrl.replace(/\/+$/u, "")}/models`;
    const response = await (options.fetchFn ?? fetch)(modelsEndpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
      },
      signal: requestController.signal,
    });

    if (!response.ok) throw createLLMProviderHttpError(response.status);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new LLMProviderError({
        code: "provider_invalid_response",
        message: "The model provider returned an invalid model list response.",
        retryable: true,
        cause: error,
      });
    }

    const modelIds = readModelIds(payload);
    if (modelIds.length === 0) {
      throw new LLMProviderError({
        code: "provider_invalid_response",
        message: "The model provider returned an empty model list.",
        retryable: true,
      });
    }
    if (!modelIds.includes(config.model)) {
      throw new LLMProviderError({
        code: "provider_model_not_found",
        message: `The configured model is not available: ${config.model}.`,
        retryable: false,
      });
    }

    return {
      ok: true,
      provider: config.provider,
      model: config.model,
      endpointOrigin: new URL(config.baseUrl).origin,
      availableModelCount: modelIds.length,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    if (error instanceof LLMProviderError) throw error;
    if (options.signal?.aborted) {
      throw new DOMException("The provider diagnostic was aborted.", "AbortError");
    }
    if (timedOut) {
      throw new LLMProviderError({
        code: "provider_timeout",
        message: `The model provider diagnostic did not respond within ${timeoutMs}ms.`,
        retryable: true,
        cause: error,
      });
    }
    throw new LLMProviderError({
      code: "provider_network_error",
      message: "The model provider diagnostic could not reach the API.",
      retryable: true,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function readModelIds(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  return payload.data.flatMap((item) =>
    isRecord(item) && typeof item.id === "string" ? [item.id] : [],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
