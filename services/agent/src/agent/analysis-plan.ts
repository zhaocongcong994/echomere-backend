import type {
  AgentAnalysisPlan,
  AgentAnalysisTopic,
  AgentInput,
  ResolvedAgentMode,
} from "./types.ts";

const topicPatterns: Array<[AgentAnalysisTopic, RegExp]> = [
  ["career", /事业|工作|职场|求职|跳槽|升职|创业|项目|合作/u],
  ["wealth", /财运|收入|赚钱|财务|投资|负债|生意/u],
  ["relationship", /感情|恋爱|婚姻|伴侣|桃花|复合|对方|相亲/u],
  ["wellbeing", /健康|身体|睡眠|失眠|压力|焦虑|情绪/u],
  ["study", /学业|学习|考试|留学|申请|证书/u],
  ["family", /家庭|家人|父母|孩子|子女|亲子/u],
];

const timingPattern =
  /今年|明年|后年|本月|下月|近期|最近|未来|什么时候|何时|时机|流年|流月|流日|大运|运势|(?:19|20)\d{2}年?/u;
const vagueDivinationPattern =
  /^(?:帮我)?(?:算|看|问|占|起卦)(?:一下|一卦)?(?:吧|呀|啊|。|！|!|？|\?)?$/u;

export function createAgentAnalysisPlan(input: {
  request: AgentInput;
  resolvedMode: ResolvedAgentMode;
  now: Date;
}): AgentAnalysisPlan {
  const topics = detectTopics(input.request.message, input.resolvedMode);
  const requestedWindow = detectRequestedWindow(input.request.message, input.now);

  if (input.resolvedMode === "qingting") {
    return {
      schemaVersion: "1",
      intent: "supportive_listening",
      topics,
      requestedWindow,
      requiredTools: [],
      responseSections: ["接住此刻", "我听见的", "先做一件小事", "一个温和的问题"],
    };
  }

  if (input.resolvedMode === "wenshi") {
    const normalized = input.request.message.replace(/\s+/gu, "").trim();
    return {
      schemaVersion: "1",
      intent: "decision_divination",
      topics: topics.includes("decision") ? topics : ["decision", ...topics],
      requestedWindow,
      requiredTools: ["get_or_cast_hexagram"],
      responseSections: [
        "一句话回应",
        "已确认依据",
        "合理解释",
        "可验证的行动",
        "不确定性与边界",
        "可以继续追问",
      ],
      ...(normalized.length < 4 || vagueDivinationPattern.test(normalized)
        ? {
            clarification: {
              code: "specific_question_required",
              message: "问事需要一个具体、可聚焦的问题，请补充你想判断的事情和时间范围。",
              requiredFields: ["question"],
            },
          }
        : {}),
    };
  }

  return {
    schemaVersion: "1",
    intent: "fortune_analysis",
    topics,
    requestedWindow,
    requiredTools: [
      "get_profile_snapshot",
      ...(timingPattern.test(input.request.message) ? (["get_time_flow"] as const) : []),
    ],
    responseSections: [
      "一句话结论",
      "已确认依据",
      "合理解释",
      "行动建议",
      "不确定性与边界",
      "可以继续追问",
    ],
  };
}

function detectTopics(message: string, mode: ResolvedAgentMode): AgentAnalysisTopic[] {
  const topics = topicPatterns
    .filter(([, pattern]) => pattern.test(message))
    .map(([topic]) => topic);

  if (mode === "wenshi" && !topics.includes("decision")) topics.unshift("decision");
  if (mode === "qingting" && !topics.includes("emotion")) topics.unshift("emotion");
  return topics.length > 0 ? [...new Set(topics)] : ["general"];
}

function detectRequestedWindow(message: string, now: Date): string | null {
  const explicitYear = message.match(/(?:19|20)\d{2}/u)?.[0];
  if (explicitYear) return explicitYear;
  if (/明年/u.test(message)) return String(now.getFullYear() + 1);
  if (/后年/u.test(message)) return String(now.getFullYear() + 2);
  if (/今年/u.test(message)) return String(now.getFullYear());
  if (/本月/u.test(message)) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  if (/下月/u.test(message)) {
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;
  }
  if (timingPattern.test(message)) return "relative";
  return null;
}
