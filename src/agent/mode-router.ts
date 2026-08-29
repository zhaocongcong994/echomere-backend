import { resolveSuiyuanMode } from "../policies/suiyuan.policy.ts";
import type { ModeResolution } from "../policies/types.ts";
import type { AgentInput } from "./types.ts";

export function resolveAgentMode(input: AgentInput): ModeResolution {
  if (input.mode === "suiyuan") {
    return resolveSuiyuanMode(input.message);
  }

  return {
    resolvedMode: input.mode,
    reason: `用户明确选择了${input.mode}模式。`,
  };
}
