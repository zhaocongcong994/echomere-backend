import type {
  AgentAnalysisPlan,
  AgentResponseQuality,
  ResolvedAgentMode,
} from "./types.ts";

export function assessAgentResponseQuality(input: {
  content: string;
  mode: ResolvedAgentMode;
  plan: AgentAnalysisPlan;
}): AgentResponseQuality {
  const content = input.content.trim();
  const checks =
    input.mode === "qingting"
      ? {
          acknowledgesEmotion: /听起来|我听见|能理解|辛苦|不容易|压力/u.test(content),
          offersSmallStep: /可以先|试着|小行动|先做|今天先/u.test(content),
          asksOneQuestion: /？|\?/u.test(content),
          avoidsUnrequestedDivination: !/命盘|卦象|流年|大运/u.test(content),
        }
      : {
          hasConclusion: /结论|回应|总体|一句话/u.test(content),
          hasEvidence: /依据|命盘|卦象|时间流|排盘|已确认/u.test(content),
          separatesInterpretation: /解释|解读|可能|意味着/u.test(content),
          hasActions: /行动|建议|可以先|值得核对|观察/u.test(content),
          statesUncertainty: /不确定|可能|仅供参考|参考性|需核对|不应作为/u.test(content),
          offersFollowUp: /继续追问|你也可以|如果你愿意|可以继续/u.test(content),
        };
  const score = Object.values(checks).filter(Boolean).length;
  const minimum = input.mode === "qingting" ? 3 : 5;
  return {
    schemaVersion: "1",
    score,
    passed: score >= minimum,
    checks,
  };
}

export function appendVisibleDisclaimer(input: {
  content: string;
  mode: ResolvedAgentMode;
  toolSource: "mock" | "backend";
  usedTools: boolean;
}): { content: string; delta: string } {
  if (input.mode === "qingting" || !input.usedTools) {
    return { content: input.content, delta: "" };
  }
  if (/仅供参考|参考性推断|不应作为.{0,18}唯一依据/u.test(input.content)) {
    return { content: input.content, delta: "" };
  }

  const disclaimer =
    input.toolSource === "backend"
      ? "> 提醒：命盘或卦象字段来自计算工具；上述解读属于参考性推断，不应作为医疗、法律、财务或其他重大决定的唯一依据。"
      : "> 提醒：当前命理工具数据为本地 Mock，仅用于验证流程，不构成任何现实判断依据。";
  const delta = `\n\n${disclaimer}`;
  return { content: `${input.content}${delta}`, delta };
}

export function buildQualityRewriteInstruction(input: {
  quality: AgentResponseQuality;
  plan: AgentAnalysisPlan;
  mode: ResolvedAgentMode;
}): string {
  const failedChecks = Object.entries(input.quality.checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => qualityCheckLabel(name));
  const format =
    input.mode === "qingting"
      ? "使用自然对话，先理解处境，给一个小行动，最后只问一个问题。"
      : `严格按以下小节重新生成：${input.plan.responseSections.join("；")}。`;

  return [
    "【质量修复指令】",
    "上一次内部草稿未通过输出契约，不得将该草稿或质量检查过程告知用户。",
    `必须补齐：${failedChecks.join("、") || "完整回答结构"}。`,
    format,
    "只输出重写后的最终答案，不要解释你做了哪些修改。",
  ].join("\n");
}

function qualityCheckLabel(name: string): string {
  const labels: Record<string, string> = {
    acknowledgesEmotion: "对用户处境的理解",
    offersSmallStep: "一个可立即执行的小行动",
    asksOneQuestion: "一个有帮助的澄清问题",
    avoidsUnrequestedDivination: "不主动引入命理推断",
    hasConclusion: "对当前问题的直接回应",
    hasEvidence: "已确认的工具依据",
    separatesInterpretation: "事实与解释的分层",
    hasActions: "可验证、可执行的行动",
    statesUncertainty: "不确定性和适用边界",
    offersFollowUp: "2—3 个可继续追问方向",
  };
  return labels[name] ?? name;
}
