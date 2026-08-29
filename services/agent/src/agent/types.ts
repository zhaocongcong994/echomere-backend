export const AGENT_MODES = ["kanyun", "wenshi", "qingting", "suiyuan"] as const;

export type AgentMode = (typeof AGENT_MODES)[number];

export const RESOLVED_AGENT_MODES = ["kanyun", "wenshi", "qingting"] as const;

export type ResolvedAgentMode = (typeof RESOLVED_AGENT_MODES)[number];

export type SafetyCategory =
  | "self_harm"
  | "violence"
  | "medical"
  | "legal"
  | "financial"
  | "prompt_injection";

export type AgentAnalysisTopic =
  | "career"
  | "wealth"
  | "relationship"
  | "wellbeing"
  | "study"
  | "family"
  | "decision"
  | "emotion"
  | "general";

export interface AgentAnalysisPlan {
  schemaVersion: "1";
  intent: "fortune_analysis" | "decision_divination" | "supportive_listening";
  topics: AgentAnalysisTopic[];
  requestedWindow: string | null;
  requiredTools: Array<
    "get_profile_snapshot" | "get_time_flow" | "get_or_cast_hexagram"
  >;
  responseSections: string[];
  clarification?: {
    code: string;
    message: string;
    requiredFields: string[];
  };
}

export interface AgentResponseQuality {
  schemaVersion: "1";
  score: number;
  passed: boolean;
  checks: Record<string, boolean>;
}

export interface AgentContextSnapshot {
  capturedAt: string;
  resolvedMode: ResolvedAgentMode;
  historyMessageIds: string[];
  historyMessageCount: number;
  historyCharacterCount: number;
  toolEvidenceRefs: string[];
  safetyCategories: SafetyCategory[];
  analysisPlan: AgentAnalysisPlan;
}

export type AgentState =
  | "received"
  | "validated"
  | "context_loaded"
  | "tools_running"
  | "generating"
  | "validating"
  | "persisting"
  | "waiting_input"
  | "retrying"
  | "interrupted"
  | "completed"
  | "failed";

export interface AgentInput {
  userId: string;
  conversationId?: string;
  clientRequestId: string;
  mode: AgentMode;
  message: string;
  profileId?: string;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AgentResult {
  contentMarkdown: string;
  requestedMode: AgentMode;
  resolvedMode: ResolvedAgentMode;
  routeReason: string;
  safetyCategories: SafetyCategory[];
  contextMessageCount: number;
  evidenceRefs: string[];
  analysisPlan: AgentAnalysisPlan;
  quality: AgentResponseQuality;
  actionItems: string[];
  caveats: string[];
  disclaimer: string;
  toolRunIds: string[];
  promptVersion: string;
  model: string;
  modelInputCharacters?: number;
  providerAttempts?: number;
  qualityRewriteCount: number;
  qualityAttempts: AgentResponseQuality[];
  finishReason?: string;
  usage?: AgentUsage;
  profileVersionId?: string;
}

export type AgentEvent =
  | {
      type: "run_started";
      runId: string;
      conversationId?: string;
      mode?: AgentMode;
      resolvedMode?: ResolvedAgentMode;
      routeReason?: string;
    }
  | {
      type: "state_changed";
      runId: string;
      state: AgentState;
      reason?: "provider_retry" | "quality_rewrite";
    }
  | {
      type: "safety_assessed";
      runId: string;
      level: "normal" | "caution" | "block";
      categories: SafetyCategory[];
    }
  | {
      type: "tool_started";
      runId: string;
      toolRunId: string;
      displayName: string;
      toolName: string;
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
  | { type: "run_completed"; runId: string; result: AgentResult; reused?: boolean }
  | {
      type: "run_failed";
      runId: string;
      code: string;
      message: string;
      retryable: boolean;
    };

export interface AgentRunRecord {
  id: string;
  clientRequestId: string;
  userId: string;
  conversationId: string;
  requestedMode: AgentMode;
  resolvedMode: ResolvedAgentMode;
  routeReason: string;
  status: AgentState;
  createdAt: Date;
  updatedAt: Date;
  promptVersion?: string;
  contextSnapshot?: AgentContextSnapshot;
  result?: AgentResult;
  errorCode?: string;
}
