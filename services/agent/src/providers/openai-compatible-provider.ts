import {
  LLMProviderError,
  type LLMChunk,
  type LLMProvider,
  type LLMRequest,
} from "./llm-provider.ts";

type FetchLike = typeof fetch;

export interface OpenAICompatibleProviderOptions {
  providerName: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "low" | "high" | "max";
  fetchFn?: FetchLike;
}

interface ParsedStreamChunk {
  content?: string;
  usage?: { inputTokens: number; outputTokens: number };
  finishReason?: string;
}

export class OpenAICompatibleLLMProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;

  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly thinking: "enabled" | "disabled" | undefined;
  private readonly reasoningEffort: "low" | "high" | "max" | undefined;
  private readonly fetchFn: FetchLike;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.name = options.providerName;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.endpoint = `${options.baseUrl.replace(/\/+$/u, "")}/chat/completions`;
    this.timeoutMs = options.timeoutMs;
    this.maxTokens = options.maxTokens;
    this.thinking = options.thinking;
    this.reasoningEffort = options.reasoningEffort;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async *stream(
    request: LLMRequest,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<LLMChunk> {
    const requestController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      requestController.abort(new DOMException("Provider request timed out.", "TimeoutError"));
    }, this.timeoutMs);
    const abortFromCaller = () => requestController.abort(options?.signal?.reason);
    options?.signal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      if (options?.signal?.aborted) {
        throw new DOMException("The Agent run was aborted.", "AbortError");
      }

      const response = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model: this.model,
          messages: request.messages,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: this.maxTokens,
          ...(this.thinking ? { thinking: { type: this.thinking } } : {}),
          ...(this.thinking === "enabled" && this.reasoningEffort
            ? { reasoning_effort: this.reasoningEffort }
            : {}),
        }),
        signal: requestController.signal,
      });

      if (!response.ok) {
        throw createLLMProviderHttpError(response.status);
      }
      if (!response.body) {
        throw new LLMProviderError({
          code: "provider_invalid_stream",
          message: "The model provider returned an empty response stream.",
          retryable: true,
          status: response.status,
        });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finishReason = "stop";
      let sawDone = false;

      while (!sawDone) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/u, "");
          buffer = buffer.slice(newlineIndex + 1);
          newlineIndex = buffer.indexOf("\n");

          const payload = readSSEPayload(line);
          if (payload === null) continue;
          if (payload === "[DONE]") {
            sawDone = true;
            break;
          }

          const parsed = parseStreamChunk(payload);
          if (parsed.content) yield { type: "content", delta: parsed.content };
          if (parsed.usage) yield { type: "usage", ...parsed.usage };
          if (parsed.finishReason) finishReason = parsed.finishReason;
        }

        if (done) break;
      }

      if (!sawDone && buffer.trim().startsWith("data:")) {
        const payload = readSSEPayload(buffer.trim());
        if (payload === "[DONE]") {
          sawDone = true;
        } else if (payload) {
          const parsed = parseStreamChunk(payload);
          if (parsed.content) yield { type: "content", delta: parsed.content };
          if (parsed.usage) yield { type: "usage", ...parsed.usage };
          if (parsed.finishReason) finishReason = parsed.finishReason;
        }
      }

      if (!sawDone) {
        throw new LLMProviderError({
          code: "provider_invalid_stream",
          message: "The model provider closed the stream before the completion marker.",
          retryable: true,
        });
      }

      yield { type: "completed", finishReason };
    } catch (error) {
      if (error instanceof LLMProviderError) throw error;
      if (options?.signal?.aborted) {
        throw new DOMException("The Agent run was aborted.", "AbortError");
      }
      if (timedOut) {
        throw new LLMProviderError({
          code: "provider_timeout",
          message: `The model provider did not respond within ${this.timeoutMs}ms.`,
          retryable: true,
          cause: error,
        });
      }
      throw new LLMProviderError({
        code: "provider_network_error",
        message: "The model provider could not be reached.",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      options?.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

function readSSEPayload(line: string): string | null {
  if (line.length === 0 || line.startsWith(":")) return null;
  if (!line.startsWith("data:")) return null;
  return line.slice(5).trimStart();
}

function parseStreamChunk(payload: string): ParsedStreamChunk {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch (error) {
    throw new LLMProviderError({
      code: "provider_invalid_stream",
      message: "The model provider returned malformed stream data.",
      retryable: true,
      cause: error,
    });
  }

  if (!isRecord(value)) return {};
  const firstChoice = Array.isArray(value.choices) ? value.choices[0] : undefined;
  const choice = isRecord(firstChoice) ? firstChoice : undefined;
  const delta = choice && isRecord(choice.delta) ? choice.delta : undefined;
  const usage = isRecord(value.usage) ? value.usage : undefined;
  const inputTokens = usage?.prompt_tokens;
  const outputTokens = usage?.completion_tokens;

  return {
    ...(typeof delta?.content === "string" && delta.content.length > 0
      ? { content: delta.content }
      : {}),
    ...(typeof inputTokens === "number" && typeof outputTokens === "number"
      ? { usage: { inputTokens, outputTokens } }
      : {}),
    ...(typeof choice?.finish_reason === "string"
      ? { finishReason: choice.finish_reason }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createLLMProviderHttpError(status: number): LLMProviderError {
  if (status === 401) {
    return new LLMProviderError({
      code: "provider_unauthorized",
      message: "The model provider rejected the API credential.",
      retryable: false,
      status,
    });
  }
  if (status === 403) {
    return new LLMProviderError({
      code: "provider_forbidden",
      message: "The model provider denied this request.",
      retryable: false,
      status,
    });
  }
  if (status === 429) {
    return new LLMProviderError({
      code: "provider_rate_limited",
      message: "The model provider rate limit was reached.",
      retryable: true,
      status,
    });
  }
  if (status >= 500) {
    return new LLMProviderError({
      code: "provider_unavailable",
      message: `The model provider is unavailable (HTTP ${status}).`,
      retryable: true,
      status,
    });
  }
  return new LLMProviderError({
    code: "provider_bad_request",
    message: `The model provider rejected the request (HTTP ${status}).`,
    retryable: false,
    status,
  });
}
