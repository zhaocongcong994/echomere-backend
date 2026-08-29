import { z } from "zod";

export type AgentMode = "kanyun" | "qingting" | "wenshi" | "suiyuan";
export type ResolvedAgentMode = "kanyun" | "qingting" | "wenshi";

export interface AgentStreamInput {
  userId: string;
  clientRequestId: string;
  mode: AgentMode;
  message: string;
  conversationId: string;
  profileId?: string;
}

export interface AgentResultPayload {
  contentMarkdown: string;
  requestedMode: AgentMode;
  resolvedMode: ResolvedAgentMode;
  routeReason: string;
  evidenceRefs: string[];
  actionItems: string[];
  caveats: string[];
  toolRunIds: string[];
  safetyCategories: string[];
  model: string;
  modelInputCharacters?: number;
  providerAttempts?: number;
  usage?: { inputTokens: number; outputTokens: number };
  finishReason?: string;
  analysisPlan?: {
    schemaVersion: "1";
    intent: string;
    topics: string[];
    requestedWindow: string | null;
    requiredTools: string[];
    responseSections: string[];
  };
  quality?: {
    schemaVersion: "1";
    score: number;
    passed: boolean;
    checks: Record<string, boolean>;
  };
  qualityRewriteCount?: number;
  qualityAttempts?: Array<{
    schemaVersion: "1";
    score: number;
    passed: boolean;
    checks: Record<string, boolean>;
  }>;
}

export interface AgentRuntimePayload {
  provider: string;
  model: string;
  modelSelection: "legacy-env" | "profile-file";
  activeProfileId: string;
  profiles: Array<{
    id: string;
    label: string;
    provider: string;
    model: string;
    configured: boolean;
    active: boolean;
  }>;
  restartRequiredToSwitch: boolean;
  switching: {
    enabled: boolean;
    mode?: "disabled" | "local" | "service";
    persistsAcrossRestart: boolean;
    validation: "provider-model-list" | "none";
  };
  limits: {
    maxInputCharacters: number | null;
    maxOutputTokens: number | null;
  };
  retry: {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    onlyBeforeFirstOutput: boolean;
  };
  quality: {
    maxRewrites: number;
    buffersDraftUntilValidated: boolean;
  };
  thinking: {
    mode: "enabled" | "disabled";
    reasoningEffort?: "low" | "high" | "max";
  };
}

export type AgentServiceEvent =
  | {
      type: "run_started";
      runId: string;
      conversationId?: string;
      mode?: AgentMode;
      resolvedMode?: ResolvedAgentMode;
      routeReason?: string;
    }
  | { type: "state_changed"; runId: string; state: string }
  | {
      type: "safety_assessed";
      runId: string;
      level: "normal" | "caution" | "block";
      categories: string[];
    }
  | {
      type: "tool_started";
      runId: string;
      toolRunId: string;
      toolName: string;
      displayName: string;
    }
  | {
      type: "tool_completed";
      runId: string;
      toolRunId: string;
      summary: string;
    }
  | { type: "content_delta"; runId: string; delta: string }
  | {
      type: "run_waiting_input";
      runId: string;
      code: string;
      message: string;
      requiredFields: string[];
    }
  | {
      type: "run_failed";
      runId: string;
      code: string;
      message: string;
      retryable: boolean;
    }
  | {
      type: "run_completed";
      runId: string;
      result: AgentResultPayload;
      reused?: boolean;
    };

export type AgentServiceErrorCode =
  | "agent_unauthorized"
  | "agent_forbidden"
  | "agent_bad_request"
  | "agent_rate_limited"
  | "agent_unavailable"
  | "agent_connect_timeout"
  | "agent_network_error"
  | "agent_invalid_stream"
  | "agent_profile_switch_disabled"
  | "agent_profile_switch_in_progress"
  | "agent_profile_not_found"
  | "agent_profile_not_configured"
  | "agent_profile_validation_failed"
  | "agent_profile_persistence_failed";

export class AgentServiceError extends Error {
  readonly code: AgentServiceErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(input: {
    code: AgentServiceErrorCode;
    message: string;
    retryable: boolean;
    status?: number;
    cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "AgentServiceError";
    this.code = input.code;
    this.retryable = input.retryable;
    if (input.status !== undefined) this.status = input.status;
  }
}

const eventSchema = z
  .object({
    type: z.enum([
      "run_started",
      "state_changed",
      "safety_assessed",
      "tool_started",
      "tool_completed",
      "content_delta",
      "run_waiting_input",
      "run_failed",
      "run_completed",
    ]),
    runId: z.string().min(1),
  })
  .passthrough();

const runtimeSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  modelSelection: z.enum(["legacy-env", "profile-file"]),
  activeProfileId: z.string().min(1),
  profiles: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      provider: z.string().min(1),
      model: z.string().min(1),
      configured: z.boolean(),
      active: z.boolean(),
    }),
  ),
  restartRequiredToSwitch: z.boolean(),
  switching: z.object({
    enabled: z.boolean(),
    mode: z.enum(["disabled", "local", "service"]).optional(),
    persistsAcrossRestart: z.boolean(),
    validation: z.enum(["provider-model-list", "none"]),
  }),
  limits: z.object({
    maxInputCharacters: z.number().int().positive().nullable(),
    maxOutputTokens: z.number().int().positive().nullable(),
  }),
  retry: z.object({
    maxRetries: z.number().int().nonnegative(),
    baseDelayMs: z.number().int().nonnegative(),
    maxDelayMs: z.number().int().nonnegative(),
    onlyBeforeFirstOutput: z.boolean(),
  }),
  quality: z.object({
    maxRewrites: z.number().int().nonnegative(),
    buffersDraftUntilValidated: z.boolean(),
  }),
  thinking: z.object({
    mode: z.enum(["enabled", "disabled"]),
    reasoningEffort: z.enum(["low", "high", "max"]).optional(),
  }),
});

export interface AgentServiceClientOptions {
  baseUrl: string;
  sharedSecret?: string;
  connectTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class AgentServiceClient {
  private readonly baseUrl: string;
  private readonly sharedSecret?: string;
  private readonly connectTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AgentServiceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.sharedSecret = options.sharedSecret;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async *stream(
    input: AgentStreamInput,
    options: { accessToken: string; signal?: AbortSignal; requestId?: string },
  ): AsyncGenerator<AgentServiceEvent> {
    const controller = new AbortController();
    let connectTimedOut = false;
    const timeout = setTimeout(() => {
      connectTimedOut = true;
      controller.abort();
    }, this.connectTimeoutMs);
    timeout.unref();
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/agent/stream`, {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${options.accessToken}`,
          "Content-Type": "application/json",
          ...(options.requestId ? { "X-Request-Id": options.requestId } : {}),
          ...(this.sharedSecret
            ? { "X-Agent-Secret": this.sharedSecret }
            : {}),
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      clearTimeout(timeout);
    } catch (error) {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromCaller);
      if (options.signal?.aborted) {
        throw new DOMException("Agent request aborted.", "AbortError");
      }
      if (connectTimedOut) {
        throw new AgentServiceError({
          code: "agent_connect_timeout",
          message: "Timed out while connecting to the Agent service.",
          retryable: true,
          cause: error,
        });
      }
      throw new AgentServiceError({
        code: "agent_network_error",
        message: "Could not connect to the Agent service.",
        retryable: true,
        cause: error,
      });
    }

    if (!response.ok) {
      options.signal?.removeEventListener("abort", abortFromCaller);
      throw mapAgentHttpError(response.status);
    }
    if (!response.body) {
      options.signal?.removeEventListener("abort", abortFromCaller);
      throw invalidStream("Agent response did not include a body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let terminalEventSeen = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/u);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const event = parseFrame(frame);
          if (!event) continue;
          if (
            event.type === "run_completed" ||
            event.type === "run_failed" ||
            event.type === "run_waiting_input"
          ) {
            terminalEventSeen = true;
          }
          yield event;
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        const event = parseFrame(buffer);
        if (event) {
          if (
            event.type === "run_completed" ||
            event.type === "run_failed" ||
            event.type === "run_waiting_input"
          ) {
            terminalEventSeen = true;
          }
          yield event;
        }
      }
    } catch (error) {
      if (options.signal?.aborted) {
        throw new DOMException("Agent request aborted.", "AbortError");
      }
      if (error instanceof AgentServiceError) throw error;
      throw new AgentServiceError({
        code: "agent_network_error",
        message: "The Agent stream ended because of a network error.",
        retryable: true,
        cause: error,
      });
    } finally {
      options.signal?.removeEventListener("abort", abortFromCaller);
      reader.releaseLock();
    }

    if (!terminalEventSeen) {
      throw invalidStream("Agent stream ended without a terminal event.");
    }
  }

  async health(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.connectTimeoutMs);
    timeout.unref();
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/health`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new AgentServiceError({
          code: "agent_unavailable",
          message: `Agent health check failed with status ${response.status}.`,
          retryable: true,
          status: response.status,
        });
      }
      const body = (await response.json()) as { ok?: unknown };
      if (body.ok !== true) throw invalidStream("Agent health response was invalid.");
    } catch (error) {
      if (error instanceof AgentServiceError) throw error;
      throw new AgentServiceError({
        code: "agent_unavailable",
        message: "Agent health check failed.",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async runtime(): Promise<AgentRuntimePayload> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.connectTimeoutMs);
    timeout.unref();
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/runtime`, {
        headers: {
          Accept: "application/json",
          ...(this.sharedSecret
            ? { "X-Agent-Secret": this.sharedSecret }
            : {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) throw mapAgentHttpError(response.status);
      const parsed = runtimeSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw invalidStream("Agent runtime response was invalid.");
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof AgentServiceError) throw error;
      throw new AgentServiceError({
        code: "agent_unavailable",
        message: "Agent runtime check failed.",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async switchRuntimeProfile(profileId: string): Promise<AgentRuntimePayload> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.connectTimeoutMs);
    timeout.unref();
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/api/runtime/profile`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(this.sharedSecret
              ? { "X-Agent-Secret": this.sharedSecret }
              : {}),
          },
          body: JSON.stringify({ profileId }),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw await mapRuntimeProfileError(response);
      const parsed = runtimeSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw invalidStream("Agent runtime response was invalid after switching.");
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof AgentServiceError) throw error;
      throw new AgentServiceError({
        code: "agent_unavailable",
        message: "Agent runtime model switch failed.",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseFrame(frame: string): AgentServiceEvent | null {
  const data = frame
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;

  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch (error) {
    throw invalidStream("Agent stream contained invalid JSON.", error);
  }
  const base = eventSchema.safeParse(value);
  if (!base.success) {
    throw invalidStream("Agent stream contained an invalid event envelope.");
  }
  return value as AgentServiceEvent;
}

function mapAgentHttpError(status: number): AgentServiceError {
  if (status === 401) {
    return new AgentServiceError({
      code: "agent_unauthorized",
      message: "Agent service authentication failed.",
      retryable: false,
      status,
    });
  }
  if (status === 403) {
    return new AgentServiceError({
      code: "agent_forbidden",
      message: "Agent service access was denied.",
      retryable: false,
      status,
    });
  }
  if (status === 429) {
    return new AgentServiceError({
      code: "agent_rate_limited",
      message: "Agent concurrency limit was reached.",
      retryable: true,
      status,
    });
  }
  if (status >= 500) {
    return new AgentServiceError({
      code: "agent_unavailable",
      message: "Agent service is temporarily unavailable.",
      retryable: true,
      status,
    });
  }
  return new AgentServiceError({
    code: "agent_bad_request",
    message: `Agent service rejected the request with status ${status}.`,
    retryable: false,
    status,
  });
}

async function mapRuntimeProfileError(
  response: Response,
): Promise<AgentServiceError> {
  const payload = (await response.json().catch(() => null)) as {
    error?: unknown;
    message?: unknown;
    retryable?: unknown;
  } | null;
  const upstreamCode =
    typeof payload?.error === "string" ? payload.error : "";
  const codeByUpstream = {
    profile_switch_disabled: "agent_profile_switch_disabled",
    profile_switch_in_progress: "agent_profile_switch_in_progress",
    profile_not_found: "agent_profile_not_found",
    profile_not_configured: "agent_profile_not_configured",
    profile_validation_failed: "agent_profile_validation_failed",
    profile_persistence_failed: "agent_profile_persistence_failed",
  } as const;
  const code = codeByUpstream[upstreamCode as keyof typeof codeByUpstream];
  if (!code) return mapAgentHttpError(response.status);
  return new AgentServiceError({
    code,
    message:
      typeof payload?.message === "string"
        ? payload.message
        : "Agent rejected the runtime model switch.",
    retryable: payload?.retryable === true,
    status: response.status,
  });
}

function invalidStream(message: string, cause?: unknown): AgentServiceError {
  return new AgentServiceError({
    code: "agent_invalid_stream",
    message,
    retryable: false,
    ...(cause === undefined ? {} : { cause }),
  });
}
