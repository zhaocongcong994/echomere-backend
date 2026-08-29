export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  metadata: {
    runId: string;
    mode: string;
    contextSummary?: string;
  };
}

export type LLMChunk =
  | { type: "content"; delta: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "completed"; finishReason: string };

export interface LLMProvider {
  readonly name: string;
  readonly model: string;

  stream(request: LLMRequest, options?: { signal?: AbortSignal }): AsyncIterable<LLMChunk>;
}

export type LLMProviderErrorCode =
  | "provider_unauthorized"
  | "provider_forbidden"
  | "provider_rate_limited"
  | "provider_bad_request"
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_network_error"
  | "provider_invalid_stream"
  | "provider_invalid_response"
  | "provider_model_not_found";

export class LLMProviderError extends Error {
  readonly code: LLMProviderErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(input: {
    code: LLMProviderErrorCode;
    message: string;
    retryable: boolean;
    status?: number;
    cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "LLMProviderError";
    this.code = input.code;
    this.retryable = input.retryable;
    if (input.status !== undefined) this.status = input.status;
  }
}
