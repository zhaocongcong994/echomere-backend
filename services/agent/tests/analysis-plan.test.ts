import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAgentAnalysisPlan } from "../src/agent/analysis-plan.ts";
import type { AgentInput } from "../src/agent/types.ts";

const now = new Date("2026-08-27T08:00:00.000Z");

describe("evidence-driven Agent analysis plan", () => {
  it("plans profile and time-flow tools for a dated career question", () => {
    const plan = createAgentAnalysisPlan({
      request: request("kanyun", "请看看我今年的事业运势"),
      resolvedMode: "kanyun",
      now,
    });

    assert.deepEqual(plan.topics, ["career"]);
    assert.equal(plan.requestedWindow, "2026");
    assert.deepEqual(plan.requiredTools, ["get_profile_snapshot", "get_time_flow"]);
  });

  it("does not fetch a time flow for a timeless profile question", () => {
    const plan = createAgentAnalysisPlan({
      request: request("kanyun", "我在职场中的核心优势是什么？"),
      resolvedMode: "kanyun",
      now,
    });

    assert.deepEqual(plan.requiredTools, ["get_profile_snapshot"]);
    assert.equal(plan.requestedWindow, null);
  });

  it("extracts explicit and relative time windows deterministically", () => {
    const explicit = createAgentAnalysisPlan({
      request: request("kanyun", "2028 年的财运节奏如何？"),
      resolvedMode: "kanyun",
      now,
    });
    const nextMonth = createAgentAnalysisPlan({
      request: request("kanyun", "下月适合跳槽吗？"),
      resolvedMode: "kanyun",
      now,
    });

    assert.equal(explicit.requestedWindow, "2028");
    assert.equal(nextMonth.requestedWindow, "2026-09");
  });

  it("requires clarification before casting for a vague divination request", () => {
    const plan = createAgentAnalysisPlan({
      request: request("wenshi", "帮我算一下"),
      resolvedMode: "wenshi",
      now,
    });

    assert.equal(plan.clarification?.code, "specific_question_required");
    assert.deepEqual(plan.clarification?.requiredFields, ["question"]);
  });

  it("keeps supportive listening free of divination tools", () => {
    const plan = createAgentAnalysisPlan({
      request: request("qingting", "最近工作压力很大，我想聊聊"),
      resolvedMode: "qingting",
      now,
    });

    assert.deepEqual(plan.requiredTools, []);
    assert.deepEqual(plan.topics, ["emotion", "career", "wellbeing"]);
  });
});

function request(mode: AgentInput["mode"], message: string): AgentInput {
  return {
    userId: "analysis-plan-user",
    clientRequestId: `analysis-plan-${mode}-${message}`,
    mode,
    message,
  };
}
