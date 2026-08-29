import type {
  AgentContextSnapshot,
  AgentResult,
  AgentRunRecord,
  AgentState,
  ResolvedAgentMode,
} from "../agent/types.ts";

export interface AgentRunRepository {
  findByClientRequestId(clientRequestId: string): Promise<AgentRunRecord | null>;
  create(record: AgentRunRecord): Promise<void>;
  updateStatus(runId: string, status: AgentState): Promise<void>;
  saveContext(
    runId: string,
    promptVersion: string,
    snapshot: AgentContextSnapshot,
  ): Promise<void>;
  complete(runId: string, result: AgentResult): Promise<void>;
  fail(runId: string, errorCode: string): Promise<void>;
}

export interface ConversationRecord {
  id: string;
  userId: string;
  resolvedMode: ResolvedAgentMode;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessageRecord {
  id: string;
  conversationId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  agentRunId: string;
  createdAt: Date;
}

export interface ConversationWithMessages extends ConversationRecord {
  messages: ConversationMessageRecord[];
}

export interface ConversationRepository {
  getMetadata(
    conversationId: string,
    userId: string,
  ): Promise<ConversationRecord | null>;
  ensure(record: ConversationRecord): Promise<void>;
  appendMessage(record: ConversationMessageRecord): Promise<void>;
  getWithMessages(
    conversationId: string,
    userId: string,
  ): Promise<ConversationWithMessages | null>;
}

export interface ConversationHistorySource {
  listMessages(input: {
    conversationId: string;
    userId: string;
    clientRequestId: string;
    accessToken?: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<ConversationMessageRecord[]>;
}

export class ConversationModeConflictError extends Error {
  readonly existingMode: ResolvedAgentMode;
  readonly requestedMode: ResolvedAgentMode;

  constructor(existingMode: ResolvedAgentMode, requestedMode: ResolvedAgentMode) {
    super(`Conversation mode is ${existingMode}, but ${requestedMode} was requested.`);
    this.name = "ConversationModeConflictError";
    this.existingMode = existingMode;
    this.requestedMode = requestedMode;
  }
}

export interface ToolRunRecord {
  id: string;
  agentRunId: string;
  toolName: string;
  displayName: string;
  status: "running" | "completed" | "failed";
  input: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredToolRun extends ToolRunRecord {
  summary?: string;
  evidenceRef?: string;
  result?: unknown;
  errorCode?: string;
}

export interface ToolRunRepository {
  startTool(record: ToolRunRecord): Promise<void>;
  completeTool(
    toolRunId: string,
    output: { summary: string; evidenceRef?: string; result: unknown },
  ): Promise<void>;
  failTool(toolRunId: string, errorCode: string): Promise<void>;
  listToolRunsByAgentRunId(agentRunId: string): Promise<StoredToolRun[]>;
}
