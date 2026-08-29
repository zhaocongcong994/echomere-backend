import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAgentAnalysisPlan } from "../src/agent/analysis-plan.ts";
import {
  appendVisibleDisclaimer,
  assessAgentResponseQuality,
  buildQualityRewriteInstruction,
} from "../src/agent/response-quality.ts";
import type { AgentInput, ResolvedAgentMode } from "../src/agent/types.ts";

describe("Agent response quality contract", () => {
  it("passes a fact-interpretation-action layered fortune response", () => {
    const plan = planFor("kanyun", "看看我今年事业运");
    const quality = assessAgentResponseQuality({
      mode: "kanyun",
      plan,
      content: [
        "## 一句话结论",
        "今年适合先验证新机会。",
        "## 已确认依据",
        "命盘和时间流显示了当前字段。",
        "## 合理解释",
        "这可能意味着变动增多。",
        "## 行动建议",
        "值得核对岗位、合同和薪酬。",
        "## 不确定性与边界",
        "解读存在不确定性，不应作为唯一依据。",
        "## 可以继续追问",
        "你也可以继续追问月度节奏。",
      ].join("\n\n"),
    });

    assert.equal(quality.passed, true);
    assert.equal(quality.score, 6);
  });

  it("flags a bare deterministic answer that has no evidence or actions", () => {
    const plan = planFor("wenshi", "我该不该接受这份工作？");
    const quality = assessAgentResponseQuality({
      mode: "wenshi",
      plan,
      content: "结论：接受这份工作。",
    });

    assert.equal(quality.passed, false);
    assert.ok(quality.score < 5);
  });

  it("requires listening responses to acknowledge emotion and avoid divination", () => {
    const plan = planFor("qingting", "最近压力很大");
    const quality = assessAgentResponseQuality({
      mode: "qingting",
      plan,
      content:
        "听起来你最近承受了很多压力。今天可以先写下最紧急的一件事。哪一件事最让你疲惫？",
    });

    assert.equal(quality.passed, true);
    assert.equal(quality.checks.avoidsUnrequestedDivination, true);
  });

  it("appends a visible backend disclaimer once", () => {
    const first = appendVisibleDisclaimer({
      content: "正文",
      mode: "kanyun",
      toolSource: "backend",
      usedTools: true,
    });
    const second = appendVisibleDisclaimer({
      content: first.content,
      mode: "kanyun",
      toolSource: "backend",
      usedTools: true,
    });

    assert.match(first.delta, /不应作为/u);
    assert.equal(second.delta, "");
  });

  it("turns failed checks into a mode-specific rewrite instruction", () => {
    const plan = planFor("wenshi", "我该不该接受这份工作？");
    const quality = assessAgentResponseQuality({
      mode: "wenshi",
      plan,
      content: "结论：接受。",
    });
    const instruction = buildQualityRewriteInstruction({
      quality,
      plan,
      mode: "wenshi",
    });

    assert.match(instruction, /质量修复指令/u);
    assert.match(instruction, /工具依据/u);
    assert.match(instruction, /只输出重写后的最终答案/u);
    assert.doesNotMatch(instruction, /结论：接受/u);
  });
});

function planFor(mode: ResolvedAgentMode, message: string) {
  const request: AgentInput = {
    userId: "quality-user",
    clientRequestId: `quality-${mode}`,
    mode,
    message,
  };
  return createAgentAnalysisPlan({
    request,
    resolvedMode: mode,
    now: new Date("2026-08-27T00:00:00.000Z"),
  });
}
