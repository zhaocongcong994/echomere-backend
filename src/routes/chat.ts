import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import {
  AgentServiceClient,
  AgentServiceError,
  type AgentMode,
  type AgentResultPayload,
  type ResolvedAgentMode,
} from "../lib/agent-client.js";
import { prisma } from "../lib/prisma.js";
import { sanitizeUserQuestion } from "../lib/prompt-builder.js";
import { getChatRateLimiter } from "../lib/chat-rate-limit.js";
import {
  authMiddleware,
  type AuthenticatedRequest,
  userRateLimitMiddleware,
} from "../middleware.js";

const router = Router();

const schema = z.object({
  mode: z.enum(["kanyun", "qingting", "wenshi", "suiyuan"]),
  message: z.string().min(1).max(4_000),
  conversationId: z.string().optional().nullable(),
  clientRequestId: z.string().min(1).max(200).optional(),
  profileId: z.string().min(1).optional(),
});

const agentClient = new AgentServiceClient({
  baseUrl: process.env.AGENT_SERVICE_URL || "http://127.0.0.1:4310",
  sharedSecret: process.env.AGENT_SHARED_SECRET || undefined,
  connectTimeoutMs: Number(process.env.AGENT_CONNECT_TIMEOUT_MS) || 10_000,
});
async function enforceChatRateLimit(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await userRateLimitMiddleware(getChatRateLimiter())(req, res, next);
}

router.post(
  "/stream",
  authMiddleware,
  enforceChatRateLimit,
  async (req: AuthenticatedRequest, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const userId = req.user!.userId;
    const accessToken = readAccessToken(req);
    const message = sanitizeUserQuestion(parsed.data.message);
    const clientRequestId = parsed.data.clientRequestId || randomUUID();

    try {
      const prepared = await prepareConversation({
        userId,
        message,
        requestedMode: parsed.data.mode,
        conversationId: parsed.data.conversationId ?? undefined,
        clientRequestId,
      });
      if (prepared.conflict) {
        res.status(prepared.conflict.status).json({
          error: prepared.conflict.code,
          message: prepared.conflict.message,
        });
        return;
      }

      const controller = new AbortController();
      const abort = () => controller.abort();
      req.once("aborted", abort);
      res.once("close", () => {
        if (!res.writableEnded) abort();
      });

      startSSE(res);
      let runId = "";
      let fullContent = "";
      let metaSent = false;
      let terminalEventSeen = false;
      const toolEvents: Array<Record<string, unknown>> = [];

      try {
        for await (const event of agentClient.stream(
          {
            userId,
            conversationId: prepared.conversation.id,
            clientRequestId,
            mode: prepared.agentMode,
            message,
            ...(parsed.data.profileId ? { profileId: parsed.data.profileId } : {}),
          },
          {
            accessToken,
            signal: controller.signal,
            ...(req.requestId ? { requestId: req.requestId } : {}),
          },
        )) {
          runId = event.runId;

          if (event.type === "run_started") {
            const resolvedMode =
              event.resolvedMode ?? normalizeResolvedMode(prepared.conversation.mode);
            if (resolvedMode && prepared.conversation.mode !== resolvedMode) {
              await prisma.conversation.update({
                where: { id: prepared.conversation.id },
                data: { mode: resolvedMode },
              });
              prepared.conversation.mode = resolvedMode;
            }
            writeSSE(res, "meta", {
              conversationId: prepared.conversation.id,
              clientRequestId,
              runId,
              mode: resolvedMode ?? prepared.conversation.mode,
              originalMode: parsed.data.mode,
              routeReason: event.routeReason ?? "",
              toolCalls: [],
              reusedRequest: prepared.reusedRequest,
              requestId: req.requestId,
            });
            metaSent = true;
            continue;
          }

          if (event.type === "tool_started" || event.type === "tool_completed") {
            const toolEvent = { ...event };
            toolEvents.push(toolEvent);
            writeSSE(res, "tool", toolEvent);
            continue;
          }

          if (event.type === "content_delta") {
            fullContent += event.delta;
            writeSSE(res, "chunk", { content: event.delta });
            continue;
          }

          if (event.type === "run_waiting_input") {
            terminalEventSeen = true;
            writeSSE(res, "waiting_input", {
              code: event.code,
              message: event.message,
              requiredFields: event.requiredFields,
              runId,
            });
            continue;
          }

          if (event.type === "run_failed") {
            terminalEventSeen = true;
            writeSSE(res, "error", {
              code: event.code,
              message: event.message,
              retryable: event.retryable,
              runId,
            });
            continue;
          }

          if (event.type === "run_completed") {
            terminalEventSeen = true;
            if (!metaSent) {
              writeSSE(res, "meta", {
                conversationId: prepared.conversation.id,
                clientRequestId,
                runId,
                mode: event.result.resolvedMode,
                originalMode: parsed.data.mode,
                routeReason: event.result.routeReason,
                toolCalls: [],
                reusedRequest: prepared.reusedRequest,
                requestId: req.requestId,
              });
              metaSent = true;
            }
            if (!fullContent && event.result.contentMarkdown) {
              fullContent = event.result.contentMarkdown;
              writeSSE(res, "chunk", { content: fullContent });
            }
            const persisted = await persistAssistantResult({
              userId,
              conversationId: prepared.conversation.id,
              clientRequestId,
              runId,
              result: event.result,
              content: fullContent,
              toolEvents,
            });
            writeSSE(res, "done", {
              conversationId: prepared.conversation.id,
              clientRequestId,
              runId,
              reused: event.reused === true || persisted.reused,
              result: event.result,
            });
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          terminalEventSeen = true;
          const mapped = mapProxyError(error);
          writeSSE(res, "error", mapped);
        }
      } finally {
        req.off("aborted", abort);
        if (!terminalEventSeen && !controller.signal.aborted && !res.writableEnded) {
          writeSSE(res, "error", {
            code: "agent_stream_incomplete",
            message: "Agent stream ended before producing a terminal event.",
            retryable: true,
          });
        }
        if (!res.writableEnded && !res.destroyed) res.end();
      }
    } catch (error) {
      next(error);
    }
  },
);

async function prepareConversation(input: {
  userId: string;
  message: string;
  requestedMode: AgentMode;
  conversationId?: string;
  clientRequestId: string;
}): Promise<
  | {
      conflict: null;
      conversation: {
        id: string;
        mode: string;
        title: string | null;
      };
      agentMode: AgentMode;
      reusedRequest: boolean;
    }
  | {
      conflict: { status: number; code: string; message: string };
    }
> {
  const previousRequest = await findPreparedRequest(input);
  if (previousRequest) return previousRequest;

  let conversation = input.conversationId
    ? await prisma.conversation.findFirst({
        where: { id: input.conversationId, userId: input.userId },
      })
    : null;
  if (input.conversationId && !conversation) {
    return {
      conflict: {
        status: 404,
        code: "CONVERSATION_NOT_FOUND",
        message: "Conversation was not found for the authenticated user.",
      },
    };
  }

  if (
    conversation &&
    input.requestedMode !== "suiyuan" &&
    normalizeResolvedMode(conversation.mode) &&
    conversation.mode !== input.requestedMode
  ) {
    return {
      conflict: {
        status: 409,
        code: "CONVERSATION_MODE_CONFLICT",
        message: `Conversation is locked to ${conversation.mode} mode.`,
      },
    };
  }

  try {
    conversation = await prisma.$transaction(async (transaction) => {
      const selectedConversation =
        conversation ??
        (await transaction.conversation.create({
          data: {
            id: randomUUID(),
            userId: input.userId,
            mode: input.requestedMode,
            originalMode:
              input.requestedMode === "suiyuan" ? input.requestedMode : null,
            title: input.message.slice(0, 30),
          },
        }));

      await transaction.message.create({
        data: {
          conversationId: selectedConversation.id,
          userId: input.userId,
          role: "user",
          content: input.message,
          clientRequestId: input.clientRequestId,
        },
      });
      const messageCount = await transaction.message.count({
        where: { conversationId: selectedConversation.id },
      });
      await transaction.conversation.update({
        where: { id: selectedConversation.id },
        data: { messageCount, updatedAt: new Date() },
      });
      return selectedConversation;
    });
  } catch (error) {
    const raced = await findPreparedRequest(input);
    if (raced) return raced;
    throw error;
  }

  await pruneActiveConversations(input.userId, conversation.id);

  return {
    conflict: null,
    conversation,
    agentMode: resolveAgentModeForConversation(
      input.requestedMode,
      conversation.mode,
    ),
    reusedRequest: false,
  };
}

async function pruneActiveConversations(
  userId: string,
  currentConversationId: string,
): Promise<void> {
  const conversationsToKeep = await prisma.conversation.findMany({
    where: { userId, status: "active" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true },
  });
  const keepIds = new Set(
    conversationsToKeep.map((conversation) => conversation.id),
  );
  keepIds.add(currentConversationId);
  await prisma.conversation.deleteMany({
    where: {
      userId,
      status: "active",
      id: { notIn: Array.from(keepIds) },
    },
  });
}

async function findPreparedRequest(input: {
  userId: string;
  message: string;
  requestedMode: AgentMode;
  clientRequestId: string;
}): Promise<
  | {
      conflict: null;
      conversation: { id: string; mode: string; title: string | null };
      agentMode: AgentMode;
      reusedRequest: boolean;
    }
  | { conflict: { status: number; code: string; message: string } }
  | null
> {
  const previousRequest = await prisma.message.findUnique({
    where: { clientRequestId: input.clientRequestId },
    include: { conversation: true },
  });
  if (!previousRequest) return null;
  if (
    previousRequest.userId !== input.userId ||
    previousRequest.content !== input.message
  ) {
    return {
      conflict: {
        status: 409,
        code: "CLIENT_REQUEST_ID_CONFLICT",
        message: "clientRequestId is already bound to a different request.",
      },
    };
  }
  if (
    input.requestedMode !== "suiyuan" &&
    normalizeResolvedMode(previousRequest.conversation.mode) &&
    previousRequest.conversation.mode !== input.requestedMode
  ) {
    return {
      conflict: {
        status: 409,
        code: "CLIENT_REQUEST_ID_CONFLICT",
        message: "clientRequestId is already bound to a different mode.",
      },
    };
  }
  return {
    conflict: null,
    conversation: previousRequest.conversation,
    agentMode: resolveAgentModeForConversation(
      input.requestedMode,
      previousRequest.conversation.mode,
    ),
    reusedRequest: true,
  };
}

async function persistAssistantResult(input: {
  userId: string;
  conversationId: string;
  clientRequestId: string;
  runId: string;
  result: AgentResultPayload;
  content: string;
  toolEvents: Array<Record<string, unknown>>;
}): Promise<{ reused: boolean }> {
  const toolCalls = [
    {
      name: "Agent执行",
      parameters: {
        clientRequestId: input.clientRequestId,
        runId: input.runId,
        mode: input.result.resolvedMode,
        model: input.result.model,
      },
      result: {
        evidenceRefs: input.result.evidenceRefs,
        toolRunIds: input.result.toolRunIds,
        safetyCategories: input.result.safetyCategories,
        analysisPlan: input.result.analysisPlan,
        quality: input.result.quality,
        qualityRewriteCount: input.result.qualityRewriteCount,
        qualityAttempts: input.result.qualityAttempts,
        events: input.toolEvents,
      },
    },
  ];

  try {
    const reused = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.message.findUnique({
        where: { agentRunId: input.runId },
      });
      if (!existing) {
        await transaction.message.create({
          data: {
            conversationId: input.conversationId,
            userId: input.userId,
            role: "assistant",
            content: input.content,
            agentRunId: input.runId,
            toolCalls: JSON.stringify(toolCalls),
            thinkingSummary: "由元见 Agent 完成路由、工具编排和安全校验",
          },
        });
      }

      const messageCount = await transaction.message.count({
        where: { conversationId: input.conversationId },
      });
      await transaction.conversation.update({
        where: { id: input.conversationId },
        data: {
          mode: input.result.resolvedMode,
          messageCount,
          updatedAt: new Date(),
        },
      });

      const existingBilling = await transaction.billingRecord.findUnique({
        where: { agentRunId: input.runId },
      });
      if (!existingBilling) {
        await transaction.billingRecord.create({
          data: {
            agentRunId: input.runId,
            userId: input.userId,
            type: "interpretation",
            amount: 0,
            description: `${input.result.resolvedMode} 模式 Agent 解读`,
            conversationId: input.conversationId,
            status: "completed",
          },
        });
      }
      return Boolean(existing);
    });
    return { reused };
  } catch (error) {
    const [racedMessage, racedBilling] = await Promise.all([
      prisma.message.findUnique({ where: { agentRunId: input.runId } }),
      prisma.billingRecord.findUnique({ where: { agentRunId: input.runId } }),
    ]);
    if (racedMessage && racedBilling) return { reused: true };
    throw error;
  }
}

function resolveAgentModeForConversation(
  requestedMode: AgentMode,
  conversationMode: string,
): AgentMode {
  if (requestedMode !== "suiyuan") return requestedMode;
  return normalizeResolvedMode(conversationMode) ?? "suiyuan";
}

function normalizeResolvedMode(value: string): ResolvedAgentMode | null {
  return value === "kanyun" || value === "qingting" || value === "wenshi"
    ? value
    : null;
}

function readAccessToken(req: AuthenticatedRequest): string {
  const value = req.headers.authorization;
  if (!value?.startsWith("Bearer ")) {
    throw new Error("Authenticated request is missing its bearer token.");
  }
  return value.slice(7);
}

function startSSE(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write("retry: 3000\n\n");
}

function writeSSE(res: Response, event: string, data: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function mapProxyError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof AgentServiceError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    code: "agent_proxy_failed",
    message: error instanceof Error ? error.message : "Agent proxy failed.",
    retryable: true,
  };
}

export default router;
