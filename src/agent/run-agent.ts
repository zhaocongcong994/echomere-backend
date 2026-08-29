import { randomUUID } from "node:crypto";

import { getModePolicy } from "../policies/index.ts";
import {
  LLMProviderError,
  type LLMProvider,
} from "../providers/llm-provider.ts";
import { ConversationModeConflictError } from "../repositories/types.ts";
import type {
  AgentRunRepository,
  ConversationHistorySource,
  ConversationRepository,
  ToolRunRepository,
} from "../repositories/types.ts";
import {
  AgentToolError,
  type AgentToolExecutionContext,
  type AgentTools,
  type ProfileSnapshot,
} from "../tools/types.ts";
import { createAgentAnalysisPlan } from "./analysis-plan.ts";
import { loadConversationContext } from "./context-loader.ts";
import { agentInputSchema } from "./input-schema.ts";
import { resolveAgentMode } from "./mode-router.ts";
import { validateAgentOutput } from "./output-validator.ts";
import { buildLocalPrompt, PROMPT_VERSION } from "./prompt-builder.ts";
import {
  appendVisibleDisclaimer,
  assessAgentResponseQuality,
  buildQualityRewriteInstruction,
} from "./response-quality.ts";
import { assessUserSafety } from "./safety.ts";
import { AgentStateMachine } from "./state-machine.ts";
import type {
  AgentContextSnapshot,
  AgentEvent,
  AgentInput,
  AgentResponseQuality,
  AgentResult,
  AgentRunRecord,
  AgentUsage,
} from "./types.ts";

export interface AgentDependencies {
  provider: LLMProvider;
  runs: AgentRunRepository;
  tools: AgentTools;
  runtimePolicy?: AgentRuntimePolicy;
  conversations?: ConversationRepository;
  conversationHistory?: ConversationHistorySource;
  toolRuns?: ToolRunRepository;
  idFactory?: () => string;
  now?: () => Date;
}

export interface AgentRuntimePolicy {
  maxModelInputCharacters: number;
  maxProviderRetries: number;
  maxQualityRewrites: number;
  providerRetryBaseDelayMs: number;
  providerRetryMaxDelayMs: number;
}

const DEFAULT_RUNTIME_POLICY: AgentRuntimePolicy = {
  maxModelInputCharacters: 32_000,
  maxProviderRetries: 1,
  maxQualityRewrites: 1,
  providerRetryBaseDelayMs: 500,
  providerRetryMaxDelayMs: 4_000,
};

export async function* runAgent(
  rawInput: unknown,
  dependencies: AgentDependencies,
  options?: { signal?: AbortSignal; accessToken?: string; requestId?: string },
): AsyncIterable<AgentEvent> {
  const createId = dependencies.idFactory ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());
  const runtimePolicy = dependencies.runtimePolicy ?? DEFAULT_RUNTIME_POLICY;
  const stateMachine = new AgentStateMachine();
  const toolContext: AgentToolExecutionContext = {
    ...(options?.signal ? { signal: options.signal } : {}),
    ...(options?.accessToken ? { accessToken: options.accessToken } : {}),
    ...(options?.requestId ? { requestId: options.requestId } : {}),
  };
  let runId = createId();
  let recordCreated = false;

  const parsed = agentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    yield { type: "run_started", runId };
    yield { type: "state_changed", runId, state: stateMachine.state };
    stateMachine.transition("failed");
    yield { type: "state_changed", runId, state: stateMachine.state };
    yield {
      type: "run_failed",
      runId,
      code: "invalid_input",
      message: parsed.error.issues.map((issue) => issue.message).join("; "),
      retryable: false,
    };
    return;
  }

  const input: AgentInput = {
    userId: parsed.data.userId,
    clientRequestId: parsed.data.clientRequestId,
    mode: parsed.data.mode,
    message: parsed.data.message,
    ...(parsed.data.conversationId
      ? { conversationId: parsed.data.conversationId }
      : {}),
    ...(parsed.data.profileId ? { profileId: parsed.data.profileId } : {}),
  };
  let resolution = resolveAgentMode(input);
  const existing = await dependencies.runs.findByClientRequestId(input.clientRequestId);

  if (existing) {
    runId = existing.id;
    yield {
      type: "run_started",
      runId,
      conversationId: existing.conversationId,
      mode: existing.requestedMode,
      resolvedMode: existing.resolvedMode,
      routeReason: existing.routeReason,
    };
    yield { type: "state_changed", runId, state: existing.status };

    if (existing.status === "completed" && existing.result) {
      yield { type: "run_completed", runId, result: existing.result, reused: true };
    } else {
      yield {
        type: "run_failed",
        runId,
        code: "request_already_exists",
        message: `The request already exists with status: ${existing.status}.`,
        retryable: existing.status !== "failed",
      };
    }
    return;
  }

  const conversationId = input.conversationId ?? createId();
  const conversationMetadata = input.conversationId
    ? await dependencies.conversations?.getMetadata(input.conversationId, input.userId)
    : null;

  if (conversationMetadata) {
    if (input.mode === "suiyuan") {
      resolution = {
        resolvedMode: conversationMetadata.resolvedMode,
        reason: `沿用当前对话已锁定的${conversationMetadata.resolvedMode}模式。`,
      };
    } else if (input.mode !== conversationMetadata.resolvedMode) {
      yield {
        type: "run_started",
        runId,
        conversationId,
        mode: input.mode,
        resolvedMode: conversationMetadata.resolvedMode,
        routeReason: `该对话已锁定为 ${conversationMetadata.resolvedMode} 模式。`,
      };
      yield { type: "state_changed", runId, state: stateMachine.state };
      stateMachine.transition("validated");
      yield { type: "state_changed", runId, state: stateMachine.state };
      stateMachine.transition("failed");
      yield { type: "state_changed", runId, state: stateMachine.state };
      yield {
        type: "run_failed",
        runId,
        code: "conversation_mode_conflict",
        message: `该对话已锁定为 ${conversationMetadata.resolvedMode} 模式，请新建对话后再使用 ${input.mode} 模式。`,
        retryable: false,
      };
      return;
    }
  }

  const policy = getModePolicy(resolution.resolvedMode);
  const analysisPlan = createAgentAnalysisPlan({
    request: input,
    resolvedMode: resolution.resolvedMode,
    now: now(),
  });
  const usesAuthoritativeHistory = Boolean(
    input.conversationId && dependencies.conversationHistory,
  );
  const storedConversation = !usesAuthoritativeHistory && input.conversationId
    ? await dependencies.conversations?.getWithMessages(
        input.conversationId,
        input.userId,
      )
    : null;
  let conversationContext = loadConversationContext(
    storedConversation?.messages ?? [],
  );

  yield {
    type: "run_started",
    runId,
    conversationId,
    mode: input.mode,
    resolvedMode: resolution.resolvedMode,
    routeReason: resolution.reason,
  };
  yield { type: "state_changed", runId, state: stateMachine.state };

  stateMachine.transition("validated");
  yield { type: "state_changed", runId, state: stateMachine.state };

  const createdAt = now();
  const record: AgentRunRecord = {
    id: runId,
    clientRequestId: input.clientRequestId,
    userId: input.userId,
    conversationId,
    requestedMode: input.mode,
    resolvedMode: resolution.resolvedMode,
    routeReason: resolution.reason,
    status: stateMachine.state,
    createdAt,
    updatedAt: createdAt,
  };

  try {
    await dependencies.conversations?.ensure({
      id: conversationId,
      userId: input.userId,
      resolvedMode: resolution.resolvedMode,
      createdAt,
      updatedAt: createdAt,
    });
    await dependencies.runs.create(record);
    recordCreated = true;

    if (usesAuthoritativeHistory && input.conversationId) {
      const authoritativeMessages = await dependencies.conversationHistory!.listMessages({
        conversationId: input.conversationId,
        userId: input.userId,
        clientRequestId: input.clientRequestId,
        ...(options?.accessToken ? { accessToken: options.accessToken } : {}),
        ...(options?.requestId ? { requestId: options.requestId } : {}),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      conversationContext = loadConversationContext(authoritativeMessages);
    } else {
      await dependencies.conversations?.appendMessage({
        id: createId(),
        conversationId,
        userId: input.userId,
        role: "user",
        content: input.message,
        agentRunId: runId,
        createdAt,
      });
    }

    stateMachine.transition("context_loaded");
    await dependencies.runs.updateStatus(runId, stateMachine.state);
    yield { type: "state_changed", runId, state: stateMachine.state };

    const safety = assessUserSafety(input.message);
    yield {
      type: "safety_assessed",
      runId,
      level: safety.level,
      categories: safety.categories,
    };

    if (safety.level !== "block" && analysisPlan.clarification) {
      const contextSnapshot: AgentContextSnapshot = {
        capturedAt: now().toISOString(),
        resolvedMode: resolution.resolvedMode,
        historyMessageIds: conversationContext.messageIds,
        historyMessageCount: conversationContext.messages.length,
        historyCharacterCount: conversationContext.characterCount,
        toolEvidenceRefs: [],
        safetyCategories: safety.categories,
        analysisPlan,
      };
      await dependencies.runs.saveContext(runId, PROMPT_VERSION, contextSnapshot);
      stateMachine.transition("waiting_input");
      await dependencies.runs.updateStatus(runId, stateMachine.state);
      yield { type: "state_changed", runId, state: stateMachine.state };
      yield {
        type: "run_waiting_input",
        runId,
        code: analysisPlan.clarification.code,
        message: analysisPlan.clarification.message,
        requiredFields: analysisPlan.clarification.requiredFields,
      };
      return;
    }

    const toolRunIds: string[] = [];
    const evidenceRefs: string[] = [];
    const toolContexts: string[] = [];
    const toolSummaries: string[] = [];
    let profile: ProfileSnapshot | undefined;

    if (safety.level !== "block" && analysisPlan.requiredTools.length > 0) {
      stateMachine.transition("tools_running");
      await dependencies.runs.updateStatus(runId, stateMachine.state);
      yield { type: "state_changed", runId, state: stateMachine.state };
    }

    if (safety.level !== "block" && resolution.resolvedMode === "kanyun") {
      const profileToolRunId = createId();
      const profileToolStartedAt = now();
      await dependencies.toolRuns?.startTool({
        id: profileToolRunId,
        agentRunId: runId,
        toolName: "get_profile_snapshot",
        displayName: "读取档案快照",
        status: "running",
        input: {
          userId: input.userId,
          ...(input.profileId ? { profileId: input.profileId } : {}),
        },
        createdAt: profileToolStartedAt,
        updatedAt: profileToolStartedAt,
      });
      yield {
        type: "tool_started",
        runId,
        toolRunId: profileToolRunId,
        toolName: "get_profile_snapshot",
        displayName: "读取档案快照",
      };
      const profileResult = await executeTool(
        dependencies.toolRuns,
        profileToolRunId,
        () =>
          dependencies.tools.getProfileSnapshot({
            userId: input.userId,
            ...(input.profileId ? { profileId: input.profileId } : {}),
          }, toolContext),
      );

      if (!profileResult) {
        await dependencies.toolRuns?.completeTool(profileToolRunId, {
          summary: "未找到可用于看运的档案快照。",
          result: null,
        });
        yield {
          type: "tool_completed",
          runId,
          toolRunId: profileToolRunId,
          summary: "未找到可用于看运的档案快照。",
        };
        stateMachine.transition("waiting_input");
        await dependencies.runs.updateStatus(runId, stateMachine.state);
        yield { type: "state_changed", runId, state: stateMachine.state };
        yield {
          type: "run_waiting_input",
          runId,
          code: "profile_required",
          message: "看运模式需要先选择或创建一份出生档案。",
          requiredFields: ["profileId"],
        };
        return;
      }

      const loadedProfile = profileResult.data;
      profile = loadedProfile;
      toolRunIds.push(profileToolRunId);
      evidenceRefs.push(profileResult.evidenceRef);
      toolContexts.push(profileResult.promptContext);
      toolSummaries.push(profileResult.summary);
      await dependencies.toolRuns?.completeTool(profileToolRunId, {
        summary: profileResult.summary,
        evidenceRef: profileResult.evidenceRef,
        result: profileResult.data,
      });
      yield {
        type: "tool_completed",
        runId,
        toolRunId: profileToolRunId,
        summary: profileResult.summary,
      };

      if (analysisPlan.requiredTools.includes("get_time_flow")) {
        const timeFlowToolRunId = createId();
        const timeFlowToolStartedAt = now();
        await dependencies.toolRuns?.startTool({
          id: timeFlowToolRunId,
          agentRunId: runId,
          toolName: "get_time_flow",
          displayName: "计算时间流",
          status: "running",
          input: { profileSnapshotId: loadedProfile.id },
          createdAt: timeFlowToolStartedAt,
          updatedAt: timeFlowToolStartedAt,
        });
        yield {
          type: "tool_started",
          runId,
          toolRunId: timeFlowToolRunId,
          toolName: "get_time_flow",
          displayName: "计算时间流",
        };
        const timeFlowResult = await executeTool(
          dependencies.toolRuns,
          timeFlowToolRunId,
          () =>
            dependencies.tools.getTimeFlow(
              { profile: loadedProfile, at: now(), question: input.message },
              toolContext,
            ),
        );
        toolRunIds.push(timeFlowToolRunId);
        evidenceRefs.push(timeFlowResult.evidenceRef);
        toolContexts.push(timeFlowResult.promptContext);
        toolSummaries.push(timeFlowResult.summary);
        await dependencies.toolRuns?.completeTool(timeFlowToolRunId, {
          summary: timeFlowResult.summary,
          evidenceRef: timeFlowResult.evidenceRef,
          result: timeFlowResult.data,
        });
        yield {
          type: "tool_completed",
          runId,
          toolRunId: timeFlowToolRunId,
          summary: timeFlowResult.summary,
        };
      }
    }

    if (safety.level !== "block" && resolution.resolvedMode === "wenshi") {
      const hexagramToolRunId = createId();
      const hexagramToolStartedAt = now();
      await dependencies.toolRuns?.startTool({
        id: hexagramToolRunId,
        agentRunId: runId,
        toolName: "get_or_cast_hexagram",
        displayName: "创建或复用卦象",
        status: "running",
        input: { conversationId, question: input.message },
        createdAt: hexagramToolStartedAt,
        updatedAt: hexagramToolStartedAt,
      });
      yield {
        type: "tool_started",
        runId,
        toolRunId: hexagramToolRunId,
        toolName: "get_or_cast_hexagram",
        displayName: "创建或复用卦象",
      };
      const hexagramResult = await executeTool(
        dependencies.toolRuns,
        hexagramToolRunId,
        () =>
          dependencies.tools.getOrCastHexagram({
            conversationId,
            question: input.message,
            at: now(),
          }, toolContext),
      );
      toolRunIds.push(hexagramToolRunId);
      evidenceRefs.push(hexagramResult.evidenceRef);
      toolContexts.push(hexagramResult.promptContext);
      toolSummaries.push(hexagramResult.summary);
      await dependencies.toolRuns?.completeTool(hexagramToolRunId, {
        summary: hexagramResult.summary,
        evidenceRef: hexagramResult.evidenceRef,
        result: hexagramResult.data,
      });
      yield {
        type: "tool_completed",
        runId,
        toolRunId: hexagramToolRunId,
        summary: hexagramResult.summary,
      };
    }

    const contextSnapshot: AgentContextSnapshot = {
      capturedAt: now().toISOString(),
      resolvedMode: resolution.resolvedMode,
      historyMessageIds: conversationContext.messageIds,
      historyMessageCount: conversationContext.messages.length,
      historyCharacterCount: conversationContext.characterCount,
      toolEvidenceRefs: evidenceRefs,
      safetyCategories: safety.categories,
      analysisPlan,
    };
    await dependencies.runs.saveContext(runId, PROMPT_VERSION, contextSnapshot);

    stateMachine.transition("generating");
    await dependencies.runs.updateStatus(runId, stateMachine.state);
    yield { type: "state_changed", runId, state: stateMachine.state };

    let content = "";
    let usage: AgentUsage | undefined;
    let finishReason: string | undefined;
    let modelInputCharacters = 0;
    let providerAttempts = 0;
    let qualityRewriteCount = 0;
    const qualityAttempts: AgentResponseQuality[] = [];
    let quality: AgentResponseQuality = {
      schemaVersion: "1",
      score: 0,
      passed: false,
      checks: {},
    };

    if (safety.level === "block") {
      content = safety.directResponse ?? "当前请求需要立即转入人工安全支持。";
      finishReason = "safety_override";
    } else {
      const baseProviderRequest = {
        messages: [
          {
            role: "system" as const,
            content: buildLocalPrompt({
              request: input,
              resolution,
              policy,
              analysisPlan,
              currentDate: now().toISOString().slice(0, 10),
              toolContexts,
              toolSource: dependencies.tools.source,
              safetyInstruction: safety.systemInstruction,
            }),
          },
          ...conversationContext.messages,
          { role: "user" as const, content: input.message },
        ],
        metadata: {
          runId,
          mode: resolution.resolvedMode,
          ...(toolSummaries.length > 0
            ? { contextSummary: toolSummaries.join("；") }
            : {}),
        },
      };
      let providerRequest = baseProviderRequest;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      while (true) {
        content = "";
        finishReason = undefined;
        let draftUsage: AgentUsage | undefined;
        let transportAttempts = 0;
        const currentInputCharacters = providerRequest.messages.reduce(
          (total, message) => total + message.content.length,
          0,
        );
        modelInputCharacters = Math.max(modelInputCharacters, currentInputCharacters);
        if (currentInputCharacters > runtimePolicy.maxModelInputCharacters) {
          throw new AgentRunError(
            "model_input_budget_exceeded",
            `The model input contains ${currentInputCharacters} characters, exceeding the configured limit of ${runtimePolicy.maxModelInputCharacters}.`,
            false,
          );
        }

        while (true) {
          providerAttempts += 1;
          transportAttempts += 1;
          draftUsage = undefined;
          finishReason = undefined;
          try {
            for await (const chunk of dependencies.provider.stream(
              providerRequest,
              options,
            )) {
              if (chunk.type === "content") {
                content += chunk.delta;
              } else if (chunk.type === "usage") {
                draftUsage = {
                  inputTokens: chunk.inputTokens,
                  outputTokens: chunk.outputTokens,
                };
              } else if (chunk.type === "completed") {
                finishReason = chunk.finishReason;
              }
            }
            assertAcceptableProviderFinish(finishReason);
            break;
          } catch (error) {
            const retriesUsed = transportAttempts - 1;
            if (
              content.length > 0 ||
              retriesUsed >= runtimePolicy.maxProviderRetries ||
              !isRetryableProviderFailure(error) ||
              options?.signal?.aborted
            ) {
              throw error;
            }

            stateMachine.transition("retrying");
            await dependencies.runs.updateStatus(runId, stateMachine.state);
            yield {
              type: "state_changed",
              runId,
              state: stateMachine.state,
              reason: "provider_retry",
            };
            await waitForRetry(
              retryDelayMs(retriesUsed, runtimePolicy),
              options?.signal,
            );
            stateMachine.transition("generating");
            await dependencies.runs.updateStatus(runId, stateMachine.state);
            yield { type: "state_changed", runId, state: stateMachine.state };
          }
        }

        if (draftUsage) {
          totalInputTokens += draftUsage.inputTokens;
          totalOutputTokens += draftUsage.outputTokens;
        }

        const visibleResponse = appendVisibleDisclaimer({
          content,
          mode: resolution.resolvedMode,
          toolSource: dependencies.tools.source,
          usedTools: toolRunIds.length > 0,
        });
        content = visibleResponse.content;

        stateMachine.transition("validating");
        await dependencies.runs.updateStatus(runId, stateMachine.state);
        yield { type: "state_changed", runId, state: stateMachine.state };

        const validation = validateAgentOutput(content, {
          resolvedMode: resolution.resolvedMode,
          safetyOverride: false,
        });
        if (!validation.ok) {
          throw new AgentRunError(validation.code, validation.message, false);
        }
        quality = assessAgentResponseQuality({
          content,
          mode: resolution.resolvedMode,
          plan: analysisPlan,
        });
        qualityAttempts.push(quality);
        if (quality.passed || qualityRewriteCount >= runtimePolicy.maxQualityRewrites) {
          break;
        }

        qualityRewriteCount += 1;
        stateMachine.transition("retrying");
        await dependencies.runs.updateStatus(runId, stateMachine.state);
        yield {
          type: "state_changed",
          runId,
          state: stateMachine.state,
          reason: "quality_rewrite",
        };
        stateMachine.transition("generating");
        await dependencies.runs.updateStatus(runId, stateMachine.state);
        yield { type: "state_changed", runId, state: stateMachine.state };
        providerRequest = {
          ...baseProviderRequest,
          messages: baseProviderRequest.messages.map((message, index) =>
            index === 0
              ? {
                  ...message,
                  content: `${message.content}\n\n${buildQualityRewriteInstruction({
                    quality,
                    plan: analysisPlan,
                    mode: resolution.resolvedMode,
                  })}`,
                }
              : message,
          ),
        };
      }
      if (totalInputTokens > 0 || totalOutputTokens > 0) {
        usage = {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
        };
      }
    }

    if (safety.level === "block") {
      stateMachine.transition("validating");
      await dependencies.runs.updateStatus(runId, stateMachine.state);
      yield { type: "state_changed", runId, state: stateMachine.state };
      const validation = validateAgentOutput(content, {
        resolvedMode: resolution.resolvedMode,
        safetyOverride: true,
      });
      if (!validation.ok) {
        throw new AgentRunError(validation.code, validation.message, false);
      }
      quality = assessAgentResponseQuality({
        content,
        mode: resolution.resolvedMode,
        plan: analysisPlan,
      });
      qualityAttempts.push(quality);
    }

    for (const delta of outputChunks(content)) {
      if (options?.signal?.aborted) {
        throw new DOMException("The Agent run was aborted.", "AbortError");
      }
      yield { type: "content_delta", runId, delta };
    }

    const result: AgentResult = {
      contentMarkdown: content,
      requestedMode: input.mode,
      resolvedMode: resolution.resolvedMode,
      routeReason: resolution.reason,
      safetyCategories: safety.categories,
      contextMessageCount: conversationContext.messages.length,
      evidenceRefs,
      analysisPlan,
      quality,
      qualityRewriteCount,
      qualityAttempts,
      actionItems: safety.actionItems,
      caveats: uniqueStrings([
        ...safety.caveats,
        ...(toolRunIds.length === 0
          ? dependencies.provider.name === "mock"
            ? ["当前回答由本地 Mock 模型生成，未调用命理工具。"]
            : ["当前回答未调用命理工具；模型内容仅供参考。"]
          : dependencies.tools.source === "mock"
            ? ["当前工具结果均为本地 Mock 数据，尚未连接真实命理计算。"]
          : ["命理工具字段来自后端计算引擎；解读仍属推断，不应作为重大决策的唯一依据。"]),
      ]),
      disclaimer:
        toolRunIds.length === 0
          ? dependencies.provider.name === "mock"
            ? "当前回答由本地 Mock 模型生成，未调用命理工具；仅用于验证系统流程。"
            : "当前回答由模型生成，未调用命理工具；请结合实际情况判断。"
          : dependencies.tools.source === "mock"
            ? "本地 Mock 工具输出仅用于验证系统流程，不构成任何现实决策依据。"
            : "命理工具字段来自后端计算；模型解读属于参考性推断，不应作为重大决策的唯一依据。",
      toolRunIds,
      promptVersion: PROMPT_VERSION,
      model: dependencies.provider.model,
      modelInputCharacters,
      providerAttempts,
      ...(finishReason ? { finishReason } : {}),
      ...(usage ? { usage } : {}),
      ...(profile ? { profileVersionId: profile.id } : {}),
    };

    stateMachine.transition("persisting");
    await dependencies.runs.updateStatus(runId, stateMachine.state);
    yield { type: "state_changed", runId, state: stateMachine.state };

    if (!usesAuthoritativeHistory) {
      await dependencies.conversations?.appendMessage({
        id: createId(),
        conversationId,
        userId: input.userId,
        role: "assistant",
        content,
        agentRunId: runId,
        createdAt: now(),
      });
    }

    stateMachine.transition("completed");
    await dependencies.runs.complete(runId, result);
    yield { type: "state_changed", runId, state: stateMachine.state };
    yield { type: "run_completed", runId, result };
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    const code = isAbort
      ? "aborted"
      : error instanceof AgentRunError
        ? error.code
        : error instanceof LLMProviderError
          ? error.code
          : error instanceof AgentToolError
            ? error.code
          : error instanceof ConversationModeConflictError
            ? "conversation_mode_conflict"
            : "agent_run_failed";
    const message = userFacingFailureMessage(error);
    const retryable =
      error instanceof AgentRunError ||
      error instanceof LLMProviderError ||
      error instanceof AgentToolError
        ? error.retryable
        : error instanceof ConversationModeConflictError
          ? false
        : !isAbort;
    const terminalState = isAbort ? "interrupted" : "failed";

    if (!stateMachine.isTerminal) {
      stateMachine.transition(terminalState);
    }
    if (recordCreated) {
      if (terminalState === "failed") {
        await dependencies.runs.fail(runId, code);
      } else {
        await dependencies.runs.updateStatus(runId, terminalState);
      }
    }

    yield { type: "state_changed", runId, state: stateMachine.state };
    yield { type: "run_failed", runId, code, message, retryable };
  }
}

class AgentRunError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "AgentRunError";
    this.code = code;
    this.retryable = retryable;
  }
}

function assertAcceptableProviderFinish(finishReason: string | undefined): void {
  if (finishReason === undefined) {
    throw new AgentRunError(
      "provider_incomplete_response",
      "The model provider ended without a completion status.",
      true,
    );
  }
  if (finishReason === "length") {
    throw new AgentRunError(
      "provider_output_truncated",
      "The model response reached the configured output token limit.",
      true,
    );
  }
  if (finishReason === "content_filter") {
    throw new AgentRunError(
      "provider_content_filtered",
      "The model provider filtered this response.",
      false,
    );
  }
  if (finishReason === "insufficient_system_resource") {
    throw new AgentRunError(
      "provider_insufficient_system_resource",
      "The model provider could not complete this response due to capacity limits.",
      true,
    );
  }
  if (finishReason === "tool_calls") {
    throw new AgentRunError(
      "provider_unexpected_tool_call",
      "The model returned a tool call even though Agent tools are executed outside the model.",
      false,
    );
  }
}

function isRetryableProviderFailure(error: unknown): boolean {
  return (
    (error instanceof LLMProviderError || error instanceof AgentRunError) &&
    error.retryable
  );
}

function retryDelayMs(
  retriesUsed: number,
  policy: AgentRuntimePolicy,
): number {
  return Math.min(
    policy.providerRetryMaxDelayMs,
    policy.providerRetryBaseDelayMs * 2 ** retriesUsed,
  );
}

async function waitForRetry(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException("The Agent run was aborted.", "AbortError");
  }
  if (delayMs <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    timeout.unref();
    const abort = (): void => {
      clearTimeout(timeout);
      reject(new DOMException("The Agent run was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function executeTool<T>(
  repository: ToolRunRepository | undefined,
  toolRunId: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    await repository?.failTool(
      toolRunId,
      error instanceof AgentToolError ? error.code : "tool_execution_failed",
    );
    throw error;
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function outputChunks(content: string, maxCharacters = 120): string[] {
  if (content.length === 0) return [];
  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += maxCharacters) {
    chunks.push(content.slice(index, index + maxCharacters));
  }
  return chunks;
}

function userFacingFailureMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "本次生成已取消。";
  }
  if (error instanceof ConversationModeConflictError) return error.message;
  if (error instanceof AgentToolError) {
    const messages: Partial<Record<AgentToolError["code"], string>> = {
      backend_unauthorized: "登录状态已失效，请重新登录后再试。",
      backend_forbidden: "当前账号没有权限读取这份档案或执行该操作。",
      backend_not_found: "没有找到必要的档案或命理记录，请检查选择后重试。",
      backend_bad_request: "当前问题或档案信息不完整，请补充后重试。",
      backend_contract_missing: "命理工具接口尚未就绪，本次没有生成推断。",
      backend_invalid_response: "命理工具返回了无法验证的数据，本次已停止生成以避免误导。",
      backend_rate_limited: "当前请求较多，请稍后重试。",
      backend_unavailable: "命理工具服务暂时不可用，请稍后重试。",
      backend_timeout: "命理工具响应超时，请稍后重试。",
      backend_network_error: "暂时无法连接命理工具服务，请检查网络后重试。",
      backend_identity_mismatch: "档案身份校验失败，本次已停止生成。",
      backend_context_missing: "当前档案中没有本次分析所需的时间数据，请调整时间范围后重试。",
    };
    return messages[error.code] ?? "命理工具未能完成本次请求，本次没有生成推断。";
  }
  if (error instanceof LLMProviderError) {
    if (error.code === "provider_rate_limited") {
      return "模型服务当前请求较多，请稍后重试。";
    }
    if (error.code === "provider_unauthorized" || error.code === "provider_forbidden") {
      return "模型服务配置无效，请联系管理员检查凭据。";
    }
    return "模型服务暂时未能完成回答，请稍后重试。";
  }
  if (error instanceof AgentRunError) {
    const messages: Record<string, string> = {
      model_input_budget_exceeded: "当前会话内容过长，请新建对话或缩小问题范围。",
      provider_output_truncated: "本次回答未完整生成，请重试或缩小问题范围。",
      provider_content_filtered: "本次内容无法生成，请调整表述后重试。",
      deterministic_claim: "本次回答包含过度确定的推断，已被质量门拦截，请重试。",
      internal_context_leak: "本次回答未通过安全检查，请重试。",
    };
    return messages[error.code] ?? "本次回答未通过 Agent 质量检查，请重试。";
  }
  return "Agent 暂时未能完成本次请求，请稍后重试。";
}
