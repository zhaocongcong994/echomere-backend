import type { ResolvedAgentMode } from "../agent/types.ts";

export type AgentToolName =
  | "get_profile_snapshot"
  | "get_time_flow"
  | "get_or_cast_hexagram";

export interface ModePolicy {
  mode: ResolvedAgentMode;
  displayName: string;
  requiredTools: AgentToolName[];
  instruction: string;
}

export interface ModeResolution {
  resolvedMode: ResolvedAgentMode;
  reason: string;
}
