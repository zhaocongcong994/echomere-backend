import { z } from "zod";

import type {
  ConversationHistorySource,
  ConversationMessageRecord,
} from "../repositories/types.ts";
import { AgentToolError } from "../tools/types.ts";

const profileRecordSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    name: z.string().nullable().optional(),
    gender: z.string().min(1),
    birthDateTime: z.string().min(1),
    birthLocation: z.string().nullable().optional(),
    isPrimary: z.boolean(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .passthrough();

const baziSchema = z
  .object({
    schemaVersion: z.literal(2),
    engine: z
      .object({
        name: z.string().min(1),
        version: z.string().min(1),
        schemaVersion: z.number().int().optional(),
      })
      .passthrough(),
    year: z.string().min(1),
    month: z.string().min(1),
    day: z.string().min(1),
    hour: z.string().min(1),
    dayMaster: z
      .object({
        gan: z.string(),
        zhi: z.string(),
        wuxing: z.string(),
      })
      .passthrough(),
    canonicalText: z.string().min(1),
    dayun: z.unknown(),
  })
  .passthrough();

const primaryProfileResponseSchema = z
  .object({
    primaryProfile: profileRecordSchema.nullable(),
    bazi: baziSchema.nullable(),
  })
  .passthrough();

const profileResponseSchema = profileRecordSchema.extend({
  bazi: baziSchema,
});

const hexagramSchema = z
  .object({
    schemaVersion: z.literal(2),
    engine: z
      .object({
        name: z.string().min(1),
        version: z.string().min(1),
      })
      .passthrough(),
    originalName: z.string().min(1),
    changedName: z.string().min(1),
    changingYaos: z.array(z.number().int().min(1).max(6)),
    canonicalText: z.string().min(1),
  })
  .passthrough();

const hexagramResponseSchema = z
  .object({
    hexagram: hexagramSchema,
    reused: z.boolean(),
    evidenceRef: z.string().min(1).optional(),
  })
  .passthrough();

const conversationResponseSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    messages: z.array(
      z
        .object({
          id: z.string().min(1),
          conversationId: z.string().min(1),
          userId: z.string().nullable().optional(),
          role: z.enum(["user", "assistant"]),
          content: z.string(),
          clientRequestId: z.string().nullable().optional(),
          agentRunId: z.string().nullable().optional(),
          createdAt: z.string().datetime(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type BackendProfileRecord = z.infer<typeof profileRecordSchema>;
export type BackendBazi = z.infer<typeof baziSchema>;
export type BackendHexagram = z.infer<typeof hexagramSchema>;

export interface BackendProfileBundle {
  profile: BackendProfileRecord;
  bazi: BackendBazi;
}

export interface BackendHexagramBundle {
  hexagram: BackendHexagram;
  reused: boolean;
  evidenceRef?: string;
}

export interface EchomereBackendClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class EchomereBackendClient implements ConversationHistorySource {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EchomereBackendClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getPrimaryProfile(input: {
    accessToken?: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<BackendProfileBundle | null> {
    const response = await this.requestJson(
      "/api/profile",
      {
        method: "GET",
        ...(input.accessToken ? { accessToken: input.accessToken } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      },
      primaryProfileResponseSchema,
    );
    if (!response.primaryProfile || !response.bazi) return null;
    return { profile: response.primaryProfile, bazi: response.bazi };
  }

  async getProfile(input: {
    profileId: string;
    accessToken?: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<BackendProfileBundle | null> {
    try {
      const response = await this.requestJson(
        `/api/profiles/${encodeURIComponent(input.profileId)}`,
        {
          method: "GET",
          ...(input.accessToken ? { accessToken: input.accessToken } : {}),
          ...(input.requestId ? { requestId: input.requestId } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        },
        profileResponseSchema,
      );
      return { profile: response, bazi: response.bazi };
    } catch (error) {
      if (error instanceof AgentToolError && error.code === "backend_not_found") {
        return null;
      }
      throw error;
    }
  }

  async getOrCastHexagram(input: {
    conversationId: string;
    question: string;
    at: Date;
    accessToken?: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<BackendHexagramBundle> {
    try {
      const response = await this.requestJson(
        "/api/agent/tools/hexagram",
        {
          method: "POST",
          ...(input.accessToken ? { accessToken: input.accessToken } : {}),
          ...(input.requestId ? { requestId: input.requestId } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
          body: {
            conversationId: input.conversationId,
            question: input.question,
            at: input.at.toISOString(),
          },
        },
        hexagramResponseSchema,
      );
      return {
        hexagram: response.hexagram,
        reused: response.reused,
        ...(response.evidenceRef ? { evidenceRef: response.evidenceRef } : {}),
      };
    } catch (error) {
      if (error instanceof AgentToolError && error.code === "backend_not_found") {
        throw new AgentToolError({
          code: "backend_contract_missing",
          message:
            "The backend does not expose POST /api/agent/tools/hexagram yet.",
          retryable: false,
          status: 404,
          cause: error,
        });
      }
      throw error;
    }
  }

  async listMessages(input: {
    conversationId: string;
    userId: string;
    clientRequestId: string;
    accessToken?: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<ConversationMessageRecord[]> {
    const conversation = await this.requestJson(
      `/api/conversations/${encodeURIComponent(input.conversationId)}`,
      {
        method: "GET",
        ...(input.accessToken ? { accessToken: input.accessToken } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      },
      conversationResponseSchema,
    );

    if (
      conversation.id !== input.conversationId ||
      conversation.userId !== input.userId
    ) {
      throw new AgentToolError({
        code: "backend_invalid_response",
        message: "The backend returned a conversation for a different owner or id.",
        retryable: false,
      });
    }

    return conversation.messages
      .filter(
        (message) =>
          !(
            message.role === "user" &&
            message.clientRequestId === input.clientRequestId
          ),
      )
      .map((message) => ({
        id: message.id,
        conversationId: message.conversationId,
        userId: message.userId ?? conversation.userId,
        role: message.role,
        content: message.content,
        agentRunId:
          message.agentRunId ??
          message.clientRequestId ??
          `backend-message:${message.id}`,
        createdAt: new Date(message.createdAt),
      }))
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  private async requestJson<T>(
    path: string,
    input: {
      method: "GET" | "POST";
      accessToken?: string;
      requestId?: string;
      signal?: AbortSignal;
      body?: unknown;
    },
    schema: z.ZodType<T>,
  ): Promise<T> {
    if (!input.accessToken) {
      throw new AgentToolError({
        code: "backend_unauthorized",
        message: "A backend bearer token is required for real backend tools.",
        retryable: false,
        status: 401,
      });
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    timeout.unref();

    const abortFromCaller = () => controller.abort();
    input.signal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: input.method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${input.accessToken}`,
          ...(input.requestId ? { "X-Request-Id": input.requestId } : {}),
          ...(input.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        signal: controller.signal,
      });

      if (!response.ok) throw mapHttpError(response.status);

      let raw: unknown;
      try {
        raw = await response.json();
      } catch (error) {
        throw new AgentToolError({
          code: "backend_invalid_response",
          message: "The backend returned invalid JSON.",
          retryable: false,
          cause: error,
        });
      }

      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw new AgentToolError({
          code: "backend_invalid_response",
          message: `The backend response does not match the Agent contract: ${parsed.error.issues
            .map((issue) => issue.path.join("."))
            .filter(Boolean)
            .join(", ")}`,
          retryable: false,
        });
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof AgentToolError) throw error;
      if (input.signal?.aborted) {
        throw new DOMException("The backend request was aborted.", "AbortError");
      }
      if (timedOut) {
        throw new AgentToolError({
          code: "backend_timeout",
          message: "The backend request timed out.",
          retryable: true,
          cause: error,
        });
      }
      throw new AgentToolError({
        code: "backend_network_error",
        message: "The backend request failed before receiving a response.",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

function mapHttpError(status: number): AgentToolError {
  if (status === 401) {
    return new AgentToolError({
      code: "backend_unauthorized",
      message: "The backend rejected the bearer token.",
      retryable: false,
      status,
    });
  }
  if (status === 403) {
    return new AgentToolError({
      code: "backend_forbidden",
      message: "The backend denied access to this resource.",
      retryable: false,
      status,
    });
  }
  if (status === 404) {
    return new AgentToolError({
      code: "backend_not_found",
      message: "The backend resource was not found.",
      retryable: false,
      status,
    });
  }
  if (status === 429) {
    return new AgentToolError({
      code: "backend_rate_limited",
      message: "The backend rate limit was reached.",
      retryable: true,
      status,
    });
  }
  if (status >= 500) {
    return new AgentToolError({
      code: "backend_unavailable",
      message: "The backend is temporarily unavailable.",
      retryable: true,
      status,
    });
  }
  return new AgentToolError({
    code: "backend_bad_request",
    message: `The backend rejected the request with status ${status}.`,
    retryable: false,
    status,
  });
}
