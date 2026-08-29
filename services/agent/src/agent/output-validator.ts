import type { ResolvedAgentMode } from "./types.ts";

export type OutputValidationResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "empty_output"
        | "output_too_large"
        | "internal_context_leak"
        | "deterministic_claim";
      message: string;
    };

const internalContextPattern =
  /reasoning_content|【模式规则】|【工具上下文】|【安全规则】|【数据来源规则】|【质量修复指令】|上一次内部草稿|你是元见 Agent 的本地开发版本/u;
const deterministicClaimPattern =
  /一定会|注定会|百分之百|必然发生|绝对能够|机会(?:是|确实是)?真实存在|机会是真的|对方确实需要人|合同(?:细节)?(?:有|存在)隐藏项/u;

export function validateAgentOutput(
  content: string,
  options?: { resolvedMode?: ResolvedAgentMode; safetyOverride?: boolean },
): OutputValidationResult {
  if (content.trim().length === 0) {
    return {
      ok: false,
      code: "empty_output",
      message: "The model returned an empty response.",
    };
  }

  if (content.length > 50_000) {
    return {
      ok: false,
      code: "output_too_large",
      message: "The model response exceeded the output safety limit.",
    };
  }

  if (internalContextPattern.test(content)) {
    return {
      ok: false,
      code: "internal_context_leak",
      message: "The model response appears to expose internal context.",
    };
  }

  if (
    !options?.safetyOverride &&
    (options?.resolvedMode === "kanyun" || options?.resolvedMode === "wenshi") &&
    deterministicClaimPattern.test(content)
  ) {
    return {
      ok: false,
      code: "deterministic_claim",
      message: "The divination response contains an unsupported deterministic claim.",
    };
  }

  return { ok: true };
}
