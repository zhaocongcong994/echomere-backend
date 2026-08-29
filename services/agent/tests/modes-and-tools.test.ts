import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runAgent } from "../src/agent/run-agent.ts";
import type { AgentEvent } from "../src/agent/types.ts";
import { MockLLMProvider } from "../src/providers/mock-provider.ts";
import { MemoryAgentRunRepository } from "../src/repositories/memory-repository.ts";
import {
  createLocalProfileFixture,
  LocalMockAgentTools,
} from "../src/tools/local-mock-tools.ts";

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const result: AgentEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

function completedResult(events: AgentEvent[]) {
  const completed = events.find((event) => event.type === "run_completed");
  assert.equal(completed?.type, "run_completed");
  if (completed?.type !== "run_completed") throw new Error("Run did not complete.");
  return completed.result;
}

describe("mode policies and local tools", () => {
  it("runs profile and time-flow tools for kanyun", async () => {
    const events = await collect(
      runAgent(
        {
          userId: "user-kanyun",
          clientRequestId: "request-kanyun",
          mode: "kanyun",
          message: "看看今年的事业运",
        },
        {
          provider: new MockLLMProvider(),
          runs: new MemoryAgentRunRepository(),
          tools: new LocalMockAgentTools([createLocalProfileFixture("user-kanyun")]),
          now: () => new Date("2026-08-27T08:00:00.000Z"),
        },
      ),
    );

    const toolNames = events
      .filter((event) => event.type === "tool_started")
      .map((event) => event.toolName);
    assert.deepEqual(toolNames, ["get_profile_snapshot", "get_time_flow"]);

    const result = completedResult(events);
    assert.equal(result.requestedMode, "kanyun");
    assert.equal(result.resolvedMode, "kanyun");
    assert.equal(result.evidenceRefs.length, 2);
    assert.equal(result.profileVersionId, "local-profile-snapshot-v1");
    assert.equal(result.analysisPlan.requestedWindow, "2026");
    assert.equal(result.quality.passed, true);
  });

  it("uses only the profile tool for a timeless kanyun question", async () => {
    const events = await collect(
      runAgent(
        {
          userId: "user-kanyun-profile-only",
          clientRequestId: "request-kanyun-profile-only",
          mode: "kanyun",
          message: "我在职场中的核心优势是什么？",
        },
        {
          provider: new MockLLMProvider(),
          runs: new MemoryAgentRunRepository(),
          tools: new LocalMockAgentTools([
            createLocalProfileFixture("user-kanyun-profile-only"),
          ]),
        },
      ),
    );

    const toolNames = events
      .filter((event) => event.type === "tool_started")
      .map((event) => event.toolName);
    assert.deepEqual(toolNames, ["get_profile_snapshot"]);
    assert.equal(completedResult(events).evidenceRefs.length, 1);
  });

  it("waits for profile input without calling the model when kanyun has no profile", async () => {
    const events = await collect(
      runAgent(
        {
          userId: "user-without-profile",
          clientRequestId: "request-without-profile",
          mode: "kanyun",
          message: "看看我的运势",
        },
        {
          provider: new MockLLMProvider(),
          runs: new MemoryAgentRunRepository(),
          tools: new LocalMockAgentTools(),
        },
      ),
    );

    assert.equal(events.some((event) => event.type === "content_delta"), false);
    assert.equal(events.at(-1)?.type, "run_waiting_input");
    const waiting = events.at(-1);
    if (waiting?.type === "run_waiting_input") {
      assert.equal(waiting.code, "profile_required");
      assert.deepEqual(waiting.requiredFields, ["profileId"]);
    }
  });

  it("does not invoke divination tools in qingting mode", async () => {
    const events = await collect(
      runAgent(
        {
          userId: "user-qingting",
          clientRequestId: "request-qingting",
          mode: "qingting",
          message: "最近压力很大，想找人聊聊",
        },
        {
          provider: new MockLLMProvider(),
          runs: new MemoryAgentRunRepository(),
          tools: new LocalMockAgentTools([createLocalProfileFixture("user-qingting")]),
        },
      ),
    );

    assert.equal(events.some((event) => event.type === "tool_started"), false);
    assert.equal(completedResult(events).resolvedMode, "qingting");
  });

  it("routes suiyuan requests to a concrete mode", async () => {
    const events = await collect(
      runAgent(
        {
          userId: "user-suiyuan",
          clientRequestId: "request-suiyuan",
          mode: "suiyuan",
          message: "我想看看今年的事业运",
        },
        {
          provider: new MockLLMProvider(),
          runs: new MemoryAgentRunRepository(),
          tools: new LocalMockAgentTools([createLocalProfileFixture("user-suiyuan")]),
        },
      ),
    );

    const result = completedResult(events);
    assert.equal(result.requestedMode, "suiyuan");
    assert.equal(result.resolvedMode, "kanyun");
    assert.match(result.routeReason, /运势相关意图/);
  });

  it("reuses one hexagram within the same wenshi conversation", async () => {
    const tools = new LocalMockAgentTools();
    const runs = new MemoryAgentRunRepository();
    const dependencies = {
      provider: new MockLLMProvider(),
      runs,
      tools,
      now: () => new Date("2026-08-27T08:00:00.000Z"),
    };

    const first = await collect(
      runAgent(
        {
          userId: "user-wenshi",
          conversationId: "conversation-wenshi",
          clientRequestId: "request-wenshi-1",
          mode: "wenshi",
          message: "我该不该接受这份工作？",
        },
        dependencies,
      ),
    );
    const second = await collect(
      runAgent(
        {
          userId: "user-wenshi",
          conversationId: "conversation-wenshi",
          clientRequestId: "request-wenshi-2",
          mode: "wenshi",
          message: "那我最需要注意什么？",
        },
        dependencies,
      ),
    );

    const firstEvidence = completedResult(first).evidenceRefs[0];
    const secondEvidence = completedResult(second).evidenceRefs[0];
    assert.equal(secondEvidence, firstEvidence);

    const secondToolResult = second.find((event) => event.type === "tool_completed");
    assert.equal(secondToolResult?.type, "tool_completed");
    if (secondToolResult?.type === "tool_completed") {
      assert.match(secondToolResult.summary, /复用/);
    }
  });

  it("asks for a specific question before casting a hexagram", async () => {
    const events = await collect(
      runAgent(
        {
          userId: "user-vague-wenshi",
          clientRequestId: "request-vague-wenshi",
          mode: "wenshi",
          message: "帮我算一下",
        },
        {
          provider: new MockLLMProvider(),
          runs: new MemoryAgentRunRepository(),
          tools: new LocalMockAgentTools(),
        },
      ),
    );

    assert.equal(events.some((event) => event.type === "tool_started"), false);
    assert.equal(events.some((event) => event.type === "content_delta"), false);
    const waiting = events.at(-1);
    assert.equal(waiting?.type, "run_waiting_input");
    if (waiting?.type === "run_waiting_input") {
      assert.equal(waiting.code, "specific_question_required");
      assert.deepEqual(waiting.requiredFields, ["question"]);
    }
  });
});
