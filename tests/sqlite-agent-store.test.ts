import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";

import { runAgent } from "../src/agent/run-agent.ts";
import type { AgentEvent } from "../src/agent/types.ts";
import { MockLLMProvider } from "../src/providers/mock-provider.ts";
import { SqliteAgentStore } from "../src/repositories/sqlite-agent-store.ts";
import {
  createLocalProfileFixture,
  LocalMockAgentTools,
} from "../src/tools/local-mock-tools.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const result: AgentEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "echomere-agent-store-"));
  temporaryDirectories.push(directory);
  return join(directory, "agent.db");
}

describe("SqliteAgentStore", () => {
  it("migrates legacy conversations and run context columns", async () => {
    const databasePath = createDatabasePath();
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY,
        client_request_id TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        requested_mode TEXT NOT NULL,
        resolved_mode TEXT NOT NULL,
        route_reason TEXT NOT NULL,
        status TEXT NOT NULL,
        result_json TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO conversations VALUES (
        'legacy-conversation', 'legacy-user',
        '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z'
      );
      INSERT INTO agent_runs VALUES (
        'legacy-run', 'legacy-request', 'legacy-user', 'legacy-conversation',
        'qingting', 'qingting', '旧版路由', 'completed', NULL, NULL,
        '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z'
      );
    `);
    legacy.close();

    const store = new SqliteAgentStore(databasePath);
    try {
      const metadata = await store.getMetadata(
        "legacy-conversation",
        "legacy-user",
      );
      assert.equal(metadata?.resolvedMode, "qingting");
      const run = await store.findByClientRequestId("legacy-request");
      assert.equal(run?.promptVersion, undefined);
      assert.equal(run?.contextSnapshot, undefined);
    } finally {
      store.close();
    }
  });

  it("persists runs, tool runs, conversations and messages", async () => {
    const store = new SqliteAgentStore(":memory:");
    const tools = new LocalMockAgentTools([createLocalProfileFixture("sqlite-user")], {
      hexagrams: store,
    });

    const events = await collect(
      runAgent(
        {
          userId: "sqlite-user",
          conversationId: "sqlite-conversation",
          clientRequestId: "sqlite-request",
          mode: "kanyun",
          message: "看看今年的事业运",
        },
        {
          provider: new MockLLMProvider(),
          tools,
          runs: store,
          conversations: store,
          toolRuns: store,
          now: () => new Date("2026-08-27T08:00:00.000Z"),
        },
      ),
    );

    const completed = events.find((event) => event.type === "run_completed");
    assert.equal(completed?.type, "run_completed");
    const run = await store.findByClientRequestId("sqlite-request");
    assert.equal(run?.status, "completed");

    const toolRuns = await store.listToolRunsByAgentRunId(run?.id ?? "");
    assert.equal(toolRuns.length, 2);
    assert.deepEqual(
      toolRuns.map((toolRun) => toolRun.status),
      ["completed", "completed"],
    );

    const conversation = await store.getWithMessages(
      "sqlite-conversation",
      "sqlite-user",
    );
    assert.deepEqual(
      conversation?.messages.map((message) => message.role),
      ["user", "assistant"],
    );
    store.close();
  });

  it("restores idempotency and reuses a hexagram after database restart", async () => {
    const databasePath = createDatabasePath();
    const firstStore = new SqliteAgentStore(databasePath);
    const firstTools = new LocalMockAgentTools([], { hexagrams: firstStore });
    const dependencies = {
      provider: new MockLLMProvider(),
      tools: firstTools,
      runs: firstStore,
      conversations: firstStore,
      toolRuns: firstStore,
      now: () => new Date("2026-08-27T08:00:00.000Z"),
    };
    const firstInput = {
      userId: "restart-user",
      conversationId: "restart-conversation",
      clientRequestId: "restart-request-1",
      mode: "wenshi" as const,
      message: "我该不该接受这份工作？",
    };

    const firstEvents = await collect(runAgent(firstInput, dependencies));
    const firstCompleted = firstEvents.find((event) => event.type === "run_completed");
    assert.equal(firstCompleted?.type, "run_completed");
    firstStore.close();

    const secondStore = new SqliteAgentStore(databasePath);
    const secondTools = new LocalMockAgentTools([], { hexagrams: secondStore });
    const secondDependencies = {
      provider: new MockLLMProvider(),
      tools: secondTools,
      runs: secondStore,
      conversations: secondStore,
      toolRuns: secondStore,
      now: () => new Date("2026-08-27T09:00:00.000Z"),
    };

    const reusedRequestEvents = await collect(runAgent(firstInput, secondDependencies));
    const reusedRequest = reusedRequestEvents.find(
      (event) => event.type === "run_completed",
    );
    assert.equal(reusedRequest?.type, "run_completed");
    if (reusedRequest?.type === "run_completed") {
      assert.equal(reusedRequest.reused, true);
    }

    const followUpEvents = await collect(
      runAgent(
        {
          ...firstInput,
          clientRequestId: "restart-request-2",
          message: "那我应该重点注意什么？",
        },
        secondDependencies,
      ),
    );
    const toolCompleted = followUpEvents.find(
      (event) => event.type === "tool_completed",
    );
    assert.equal(toolCompleted?.type, "tool_completed");
    if (toolCompleted?.type === "tool_completed") {
      assert.match(toolCompleted.summary, /复用/);
    }

    const conversation = await secondStore.getWithMessages(
      "restart-conversation",
      "restart-user",
    );
    assert.equal(conversation?.messages.length, 4);
    secondStore.close();
  });
});
