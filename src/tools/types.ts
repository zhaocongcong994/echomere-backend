export interface ProfileSnapshot {
  id: string;
  profileId: string;
  userId: string;
  subjectName: string;
  version: number;
  timezone: string;
  source: "mock" | "backend";
  facts: string[];
  createdAt: string;
}

export interface TimeFlowResult {
  id: string;
  profileSnapshotId: string;
  period: string;
  source: "mock" | "backend";
  facts: string[];
}

export interface HexagramResult {
  id: string;
  conversationId: string;
  question: string;
  primaryHexagram: string;
  changedHexagram: string;
  movingLines: number[];
  source: "mock" | "backend";
  createdAt: string;
}

export interface ToolResult<T> {
  data: T;
  summary: string;
  promptContext: string;
  evidenceRef: string;
}

export interface AgentToolExecutionContext {
  accessToken?: string;
  requestId?: string;
  signal?: AbortSignal;
}

export type AgentToolErrorCode =
  | "backend_unauthorized"
  | "backend_forbidden"
  | "backend_not_found"
  | "backend_bad_request"
  | "backend_contract_missing"
  | "backend_invalid_response"
  | "backend_rate_limited"
  | "backend_unavailable"
  | "backend_timeout"
  | "backend_network_error"
  | "backend_identity_mismatch"
  | "backend_context_missing";

export class AgentToolError extends Error {
  readonly code: AgentToolErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(input: {
    code: AgentToolErrorCode;
    message: string;
    retryable: boolean;
    status?: number;
    cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "AgentToolError";
    this.code = input.code;
    this.retryable = input.retryable;
    if (input.status !== undefined) this.status = input.status;
  }
}

export interface HexagramToolResult extends ToolResult<HexagramResult> {
  reused: boolean;
}

export interface AgentTools {
  readonly source: "mock" | "backend";

  getProfileSnapshot(input: {
    userId: string;
    profileId?: string;
  }, context?: AgentToolExecutionContext): Promise<ToolResult<ProfileSnapshot> | null>;

  getTimeFlow(input: {
    profile: ProfileSnapshot;
    at: Date;
    question?: string;
  }, context?: AgentToolExecutionContext): Promise<ToolResult<TimeFlowResult>>;

  getOrCastHexagram(input: {
    conversationId: string;
    question: string;
    at: Date;
  }, context?: AgentToolExecutionContext): Promise<HexagramToolResult>;
}

export interface HexagramRepository {
  findByConversationId(conversationId: string): Promise<HexagramResult | null>;
  insertIfAbsent(result: HexagramResult): Promise<HexagramResult>;
}
