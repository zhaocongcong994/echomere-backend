import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { runAgent, type AgentRuntimePolicy } from "../agent/run-agent.ts";
import type { LLMProvider } from "../providers/llm-provider.ts";
import type { StructuredLogger } from "../observability/logger.ts";
import { serializeError } from "../observability/logger.ts";
import type {
  AgentMetrics,
  AgentRunOutcome,
} from "../observability/metrics.ts";
import type {
  AgentRunRepository,
  ConversationHistorySource,
  ConversationRepository,
  ToolRunRepository,
} from "../repositories/types.ts";
import type { AgentTools } from "../tools/types.ts";
import type {
  RunConcurrencyGate,
  RunLease,
} from "./run-concurrency.ts";
import {
  RuntimeModelSwitchError,
  type RuntimeModelControl,
} from "./runtime-model-controller.ts";

export interface AgentServerDependencies {
  provider: LLMProvider;
  runtimeModels?: RuntimeModelControl;
  tools: AgentTools;
  runs: AgentRunRepository;
  conversations: ConversationRepository;
  conversationHistory?: ConversationHistorySource;
  toolRuns: ToolRunRepository;
  defaultAccessToken?: string;
  sharedSecret?: string;
  runLimiter?: RunConcurrencyGate;
  readinessCheck?: () => Promise<void> | void;
  logger?: StructuredLogger;
  metrics?: AgentMetrics;
  metricsToken?: string;
  runtimePolicy?: AgentRuntimePolicy;
  runtimeInfo?: {
    profileSource: "legacy-env" | "profile-file";
    activeProfileId: string;
    profiles: Array<{
      id: string;
      label: string;
      provider: string;
      model: string;
      configured: boolean;
      active: boolean;
    }>;
    maxOutputTokens: number;
    thinking: "enabled" | "disabled";
    reasoningEffort?: "low" | "high" | "max";
  };
}

export function createAgentServer(dependencies: AgentServerDependencies): Server {
  return createServer(async (request, response) => {
    setCorsHeaders(response);
    const requestId = readRequestId(request);
    response.setHeader("X-Request-Id", requestId);
    const requestPath = (request.url ?? "/").split("?", 1)[0] || "/";
    const requestStartedAt = performance.now();
    dependencies.metrics?.requestStarted();
    let requestRecorded = false;
    const recordRequest = (): void => {
      if (requestRecorded) return;
      requestRecorded = true;
      const durationMs = performance.now() - requestStartedAt;
      dependencies.metrics?.requestFinished(
        request.method ?? "UNKNOWN",
        response.statusCode,
        durationMs,
      );
      dependencies.logger?.info("http_request_completed", {
        requestId,
        method: request.method ?? "UNKNOWN",
        path: requestPath,
        statusCode: response.statusCode,
        durationMs: Number(durationMs.toFixed(3)),
      });
    };
    response.once("finish", recordRequest);
    response.once("close", recordRequest);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const requestUrl = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "127.0.0.1"}`,
    );

    try {
      if (request.method === "GET" && requestUrl.pathname === "/health") {
        const provider = currentProvider(dependencies);
        sendJson(response, 200, {
          ok: true,
          provider: provider.name,
          model: provider.model,
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/ready") {
        try {
          await dependencies.readinessCheck?.();
          sendJson(response, 200, { status: "ready" });
        } catch {
          sendJson(response, 503, { status: "not_ready" });
        }
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/metrics") {
        if (
          dependencies.metricsToken &&
          readBearerToken(request) !== dependencies.metricsToken
        ) {
          sendJson(response, 401, { error: "metrics_unauthorized" });
          return;
        }
        sendText(
          response,
          200,
          dependencies.metrics?.toPrometheus() ?? "# metrics_not_configured\n",
          "text/plain; version=0.0.4; charset=utf-8",
        );
        return;
      }

      if (
        requestUrl.pathname.startsWith("/api/") &&
        dependencies.sharedSecret &&
        !secretsMatch(request.headers["x-agent-secret"], dependencies.sharedSecret)
      ) {
        sendJson(response, 401, { error: "agent_unauthorized" });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/runtime") {
        sendJson(response, 200, buildRuntimePayload(dependencies));
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/runtime/profile"
      ) {
        if (!dependencies.runtimeModels) {
          sendJson(response, 403, {
            error: "profile_switch_disabled",
            message: "Runtime model switching is disabled.",
            retryable: false,
          });
          return;
        }
        const body = await readJsonBody(request);
        const profileId = readProfileId(body);
        try {
          const previousProfileId = dependencies.runtimeModels.snapshot().activeProfileId;
          const runtime = await dependencies.runtimeModels.switchProfile(profileId);
          dependencies.logger?.info("runtime_model_profile_switched", {
            requestId,
            previousProfileId,
            activeProfileId: runtime.activeProfileId,
            provider: runtime.provider,
            model: runtime.model,
          });
          sendJson(response, 200, buildRuntimePayload(dependencies));
        } catch (error) {
          if (error instanceof RuntimeModelSwitchError) {
            dependencies.logger?.warn("runtime_model_profile_switch_failed", {
              requestId,
              targetProfileId: profileId,
              activeProfileId:
                dependencies.runtimeModels.snapshot().activeProfileId,
              errorCode: error.code,
              retryable: error.retryable,
            });
            sendJson(response, error.status, {
              error: error.code,
              message: error.message,
              retryable: error.retryable,
            });
            return;
          }
          throw error;
        }
        return;
      }

      if (
        request.method === "GET" &&
        requestUrl.pathname.startsWith("/api/conversations/")
      ) {
        const conversationId = decodeURIComponent(
          requestUrl.pathname.slice("/api/conversations/".length),
        );
        const userId = requestUrl.searchParams.get("userId");
        if (!conversationId || !userId) {
          sendJson(response, 400, { error: "conversationId and userId are required" });
          return;
        }
        const conversation = await dependencies.conversations.getWithMessages(
          conversationId,
          userId,
        );
        sendJson(
          response,
          conversation ? 200 : 404,
          conversation ?? { error: "conversation_not_found" },
        );
        return;
      }

      if (
        request.method === "GET" &&
        requestUrl.pathname.startsWith("/api/runs/by-request/")
      ) {
        const clientRequestId = decodeURIComponent(
          requestUrl.pathname.slice("/api/runs/by-request/".length),
        );
        const userId = requestUrl.searchParams.get("userId");
        const run = await dependencies.runs.findByClientRequestId(clientRequestId);
        if (!run || !userId || run.userId !== userId) {
          sendJson(response, 404, { error: "run_not_found" });
          return;
        }
        const toolRuns = await dependencies.toolRuns.listToolRunsByAgentRunId(run.id);
        sendJson(response, 200, { run, toolRuns });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/agent/stream") {
        const body = await readJsonBody(request);
        const userId = readBodyUserId(body);
        let lease: RunLease;
        try {
          const acquired =
            userId && dependencies.runLimiter
              ? await dependencies.runLimiter.tryAcquire(userId)
              : NOOP_RUN_LEASE;
          if (!acquired) {
            dependencies.metrics?.runRejected();
            response.setHeader("Retry-After", "1");
            sendJson(response, 429, {
              error: "agent_rate_limited",
              retryAfterSeconds: 1,
              requestId,
            });
            return;
          }
          lease = acquired;
        } catch (error) {
          dependencies.metrics?.concurrencyUnavailable();
          dependencies.logger?.error("agent_concurrency_unavailable", {
            requestId,
            store: dependencies.runLimiter?.store,
            ...serializeError(error),
          });
          response.setHeader("Retry-After", "1");
          sendJson(response, 503, {
            error: "agent_concurrency_unavailable",
            retryAfterSeconds: 1,
            requestId,
          });
          return;
        }
        try {
          await streamAgentRun(
            response,
            body,
            dependencies,
            readBearerToken(request) ?? dependencies.defaultAccessToken,
            requestId,
            lease.signal,
          );
        } finally {
          try {
            await lease.release();
          } catch (error) {
            dependencies.logger?.error("agent_concurrency_release_failed", {
              requestId,
              store: dependencies.runLimiter?.store,
              ...serializeError(error),
            });
          }
        }
        return;
      }

      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      dependencies.logger?.error("unhandled_request_error", {
        requestId,
        method: request.method ?? "UNKNOWN",
        path: requestPath,
        ...serializeError(error),
      });
      if (!response.headersSent) {
        const status = error instanceof RequestBodyError ? error.status : 500;
        sendJson(response, status, {
          error:
            error instanceof RequestBodyError
              ? error.message
              : "internal_server_error",
        });
      } else if (!response.writableEnded) {
        writeSSE(response, "server_error", {
          type: "server_error",
          code: "internal_server_error",
        });
        response.end();
      }
    }
  });
}

async function streamAgentRun(
  response: ServerResponse,
  body: unknown,
  dependencies: AgentServerDependencies,
  accessToken?: string,
  requestId?: string,
  leaseSignal?: AbortSignal,
): Promise<void> {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.write("retry: 3000\n\n");

  const controller = new AbortController();
  const keepAlive = setInterval(() => {
    if (!response.destroyed && !response.writableEnded) {
      response.write(": keep-alive\n\n");
    }
  }, 15_000);
  keepAlive.unref();
  response.on("close", () => {
    if (!response.writableEnded) controller.abort();
  });
  const abortForLostLease = (): void => {
    controller.abort(leaseSignal?.reason);
  };
  leaseSignal?.addEventListener("abort", abortForLostLease, { once: true });

  const runStartedAt = performance.now();
  const provider = currentProvider(dependencies);
  dependencies.metrics?.runStarted();
  let outcome: AgentRunOutcome | undefined;
  let providerAttempts: number | undefined;
  let modelInputCharacters: number | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  try {
    for await (const event of runAgent(
      body,
      {
        provider,
        tools: dependencies.tools,
        runs: dependencies.runs,
        conversations: dependencies.conversations,
        ...(dependencies.conversationHistory
          ? { conversationHistory: dependencies.conversationHistory }
          : {}),
        toolRuns: dependencies.toolRuns,
        ...(dependencies.runtimePolicy
          ? { runtimePolicy: dependencies.runtimePolicy }
          : {}),
      },
      {
        signal: controller.signal,
        ...(accessToken ? { accessToken } : {}),
        ...(requestId ? { requestId } : {}),
      },
    )) {
      outcome ??= terminalOutcome(event);
      if (
        event.type === "state_changed" &&
        event.state === "retrying" &&
        event.reason === "provider_retry"
      ) {
        dependencies.metrics?.providerRetried();
      }
      if (event.type === "run_completed") {
        providerAttempts = event.result.providerAttempts;
        modelInputCharacters = event.result.modelInputCharacters;
        if (!event.reused && event.result.usage) {
          inputTokens = event.result.usage.inputTokens;
          outputTokens = event.result.usage.outputTokens;
          dependencies.metrics?.modelUsage(inputTokens, outputTokens);
        }
        if (!event.reused && event.result.qualityRewriteCount > 0) {
          dependencies.metrics?.qualityRewritten(event.result.qualityRewriteCount);
        }
        if (!event.reused && !event.result.quality.passed) {
          dependencies.metrics?.lowQualityCompleted();
        }
      }
      if (response.destroyed) {
        controller.abort();
        break;
      }
      writeSSE(response, event.type, event);
    }
  } catch (error) {
    outcome ??= controller.signal.aborted ? "interrupted" : "failed";
    throw error;
  } finally {
    leaseSignal?.removeEventListener("abort", abortForLostLease);
    outcome ??= controller.signal.aborted ? "interrupted" : "failed";
    dependencies.metrics?.runFinished(outcome);
    dependencies.logger?.info("agent_run_finished", {
      requestId,
      outcome,
      durationMs: Number((performance.now() - runStartedAt).toFixed(3)),
      provider: provider.name,
      model: provider.model,
      providerAttempts,
      modelInputCharacters,
      inputTokens,
      outputTokens,
    });
    clearInterval(keepAlive);
    if (!response.writableEnded && !response.destroyed) response.end();
  }
}

const NOOP_RUN_LEASE: RunLease = {
  release: async () => undefined,
};

function writeSSE(response: ServerResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) {
      throw new RequestBodyError(413, "request_body_too_large");
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RequestBodyError(400, "invalid_json");
  }
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Agent-Secret, X-Request-Id",
  );
  response.setHeader("Access-Control-Expose-Headers", "X-Request-Id, Retry-After");
}

function readRequestId(request: IncomingMessage): string {
  const value = request.headers["x-request-id"];
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/u.test(value)
    ? value
    : randomUUID();
}

function readBodyUserId(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("userId" in body)) return null;
  const userId = (body as { userId?: unknown }).userId;
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}

function readProfileId(body: unknown): string {
  if (!body || typeof body !== "object" || !("profileId" in body)) {
    throw new RequestBodyError(400, "profile_id_required");
  }
  const profileId = (body as { profileId?: unknown }).profileId;
  if (
    typeof profileId !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(profileId)
  ) {
    throw new RequestBodyError(400, "invalid_profile_id");
  }
  return profileId;
}

function currentProvider(dependencies: AgentServerDependencies): LLMProvider {
  return dependencies.runtimeModels?.currentProvider() ?? dependencies.provider;
}

function buildRuntimePayload(dependencies: AgentServerDependencies): unknown {
  const provider = currentProvider(dependencies);
  const runtime = dependencies.runtimeModels?.snapshot();
  return {
    provider: provider.name,
    model: provider.model,
    modelSelection:
      runtime?.modelSelection ??
      dependencies.runtimeInfo?.profileSource ??
      "legacy-env",
    activeProfileId:
      runtime?.activeProfileId ??
      dependencies.runtimeInfo?.activeProfileId ??
      "default",
    profiles: runtime?.profiles ??
      dependencies.runtimeInfo?.profiles ?? [
        {
          id: "default",
          label: `${provider.name} / ${provider.model}`,
          provider: provider.name,
          model: provider.model,
          configured: true,
          active: true,
        },
      ],
    restartRequiredToSwitch: runtime?.restartRequiredToSwitch ?? true,
    switching: runtime?.switching ?? {
      enabled: false,
      mode: "disabled",
      persistsAcrossRestart: false,
      validation: "none",
    },
    limits: {
      maxInputCharacters:
        dependencies.runtimePolicy?.maxModelInputCharacters ?? null,
      maxOutputTokens:
        runtime?.maxOutputTokens ??
        dependencies.runtimeInfo?.maxOutputTokens ??
        null,
    },
    retry: {
      maxRetries: dependencies.runtimePolicy?.maxProviderRetries ?? 0,
      baseDelayMs:
        dependencies.runtimePolicy?.providerRetryBaseDelayMs ?? 0,
      maxDelayMs:
        dependencies.runtimePolicy?.providerRetryMaxDelayMs ?? 0,
      onlyBeforeFirstOutput: true,
    },
    quality: {
      maxRewrites: dependencies.runtimePolicy?.maxQualityRewrites ?? 0,
      buffersDraftUntilValidated: true,
    },
    thinking: {
      mode:
        runtime?.thinking ?? dependencies.runtimeInfo?.thinking ?? "disabled",
      ...(runtime?.reasoningEffort
        ? { reasoningEffort: runtime.reasoningEffort }
        : dependencies.runtimeInfo?.reasoningEffort
          ? { reasoningEffort: dependencies.runtimeInfo.reasoningEffort }
          : {}),
    },
  };
}

function readBearerToken(request: IncomingMessage): string | undefined {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) return undefined;
  const token = value.slice(7).trim();
  return token || undefined;
}

function secretsMatch(value: string | string[] | undefined, expected: string): boolean {
  if (typeof value !== "string") return false;
  const actualBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function sendText(
  response: ServerResponse,
  status: number,
  data: string,
  contentType: string,
): void {
  response.writeHead(status, { "Content-Type": contentType });
  response.end(data);
}

function terminalOutcome(event: { type: string; code?: string }): AgentRunOutcome | undefined {
  if (event.type === "run_completed") return "completed";
  if (event.type === "run_waiting_input") return "waiting_input";
  if (event.type === "run_failed") {
    return event.code === "agent_run_interrupted" ? "interrupted" : "failed";
  }
  return undefined;
}

class RequestBodyError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
  }
}
