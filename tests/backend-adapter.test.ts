import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";

import { runAgent } from "../src/agent/run-agent.ts";
import type { AgentEvent } from "../src/agent/types.ts";
import { EchomereBackendClient } from "../src/backend/backend-client.ts";
import { loadBackendConfig } from "../src/config/backend-config.ts";
import { MockLLMProvider } from "../src/providers/mock-provider.ts";
import { SqliteAgentStore } from "../src/repositories/sqlite-agent-store.ts";
import { createAgentServer } from "../src/server/app.ts";
import { BackendAgentTools } from "../src/tools/backend-agent-tools.ts";
import { AgentToolError } from "../src/tools/types.ts";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("Echomere backend adapter", () => {
  it("loads backend tool configuration without persisting a token in input", () => {
    assert.deepEqual(loadBackendConfig({}), {
      toolsProvider: "mock",
      baseUrl: "http://127.0.0.1:3001",
      timeoutMs: 10_000,
    });
    assert.deepEqual(
      loadBackendConfig({
        AGENT_TOOLS_PROVIDER: "echomere-backend",
        ECHOMERE_BACKEND_URL: "http://127.0.0.1:3999/",
        ECHOMERE_BACKEND_TIMEOUT_MS: "2500",
        ECHOMERE_BACKEND_TOKEN: "local-token",
      }),
      {
        toolsProvider: "echomere-backend",
        baseUrl: "http://127.0.0.1:3999",
        timeoutMs: 2_500,
        localAccessToken: "local-token",
      },
    );
  });

  it("maps the existing profile API and the new hexagram contract to Agent tools", async () => {
    const received: Array<{
      method?: string;
      url?: string;
      authorization?: string;
      requestId?: string;
    }> = [];
    const backend = createContractBackend(received);
    const baseUrl = await listen(backend);
    cleanups.push(() => close(backend));
    const client = new EchomereBackendClient({ baseUrl });
    const tools = new BackendAgentTools(client);
    const context = { accessToken: "backend-user-token" };

    const profile = await tools.getProfileSnapshot(
      { userId: "backend-user", profileId: "profile-1" },
      context,
    );
    assert.equal(profile?.data.source, "backend");
    assert.match(profile?.promptContext ?? "", /八字命盘标准文本/);
    assert.match(profile?.evidenceRef ?? "", /backend:profile:profile-1/);

    assert.ok(profile);
    const flow = await tools.getTimeFlow({
      profile: profile.data,
      at: new Date("2026-08-27T00:00:00.000Z"),
      question: "2027 年事业怎么样？",
    });
    assert.equal(flow.data.period, "2027");
    assert.ok(flow.data.facts.includes("十神：正官"));

    const hexagram = await tools.getOrCastHexagram(
      {
        conversationId: "backend-conversation",
        question: "我该不该接受这份工作？",
        at: new Date("2026-08-27T00:00:00.000Z"),
      },
      context,
    );
    assert.equal(hexagram.data.primaryHexagram, "乾为天");
    assert.equal(hexagram.data.source, "backend");
    assert.equal(hexagram.reused, false);

    const history = await client.listMessages({
      conversationId: "agent-backend-conversation",
      userId: "backend-user",
      clientRequestId: "agent-backend-request",
      accessToken: context.accessToken,
    });
    assert.deepEqual(
      history.map((message) => message.content),
      ["上一轮问题", "上一轮回答"],
    );
    assert.ok(received.every((item) => item.authorization === "Bearer backend-user-token"));
  });

  it("forwards the inbound bearer token through the local Agent HTTP service", async () => {
    const received: Array<{
      method?: string;
      url?: string;
      authorization?: string;
      requestId?: string;
    }> = [];
    const backend = createContractBackend(received);
    const backendUrl = await listen(backend);
    cleanups.push(() => close(backend));

    const store = new SqliteAgentStore(":memory:");
    const backendClient = new EchomereBackendClient({ baseUrl: backendUrl });
    const agentServer = createAgentServer({
      provider: new MockLLMProvider(),
      tools: new BackendAgentTools(backendClient),
      runs: store,
      conversations: store,
      conversationHistory: backendClient,
      toolRuns: store,
    });
    const agentUrl = await listen(agentServer);
    cleanups.push(async () => {
      await close(agentServer);
      store.close();
    });

    const response = await fetch(`${agentUrl}/api/agent/stream`, {
      method: "POST",
      headers: {
        Authorization: "Bearer forwarded-token",
        "Content-Type": "application/json",
        "X-Request-Id": "agent-backend-trace",
      },
      body: JSON.stringify({
        userId: "backend-user",
        conversationId: "agent-backend-conversation",
        clientRequestId: "agent-backend-request",
        mode: "kanyun",
        message: "2027 年事业怎么样？",
      }),
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(text, /"type":"run_completed"/);
    assert.equal(received[0]?.authorization, "Bearer forwarded-token");
    assert.ok(received.every((item) => item.requestId === "agent-backend-trace"));

    const stored = await store.findByClientRequestId("agent-backend-request");
    assert.equal(stored?.result?.evidenceRefs.length, 2);
    assert.equal(stored?.result?.profileVersionId?.startsWith("backend-profile:"), true);
    assert.equal(stored?.contextSnapshot?.historyMessageCount, 2);
    assert.equal(
      stored?.result?.caveats.some((caveat) => caveat.includes("Mock")),
      false,
    );
    assert.equal(JSON.stringify(stored).includes("forwarded-token"), false);
    const localConversation = await store.getWithMessages(
      "agent-backend-conversation",
      "backend-user",
    );
    assert.deepEqual(localConversation?.messages, []);
  });

  it("maps missing authorization and the absent backend tool endpoint", async () => {
    const backend = createServer((request, response) => {
      if (request.url === "/api/agent/tools/hexagram") {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Unauthorized" }));
    });
    const baseUrl = await listen(backend);
    cleanups.push(() => close(backend));
    const client = new EchomereBackendClient({ baseUrl });

    await assert.rejects(
      client.getPrimaryProfile({}),
      (error: unknown) =>
        error instanceof AgentToolError &&
        error.code === "backend_unauthorized" &&
        error.retryable === false,
    );
    await assert.rejects(
      client.getOrCastHexagram({
        conversationId: "missing-contract",
        question: "test",
        at: new Date("2026-08-27T00:00:00.000Z"),
        accessToken: "valid-token",
      }),
      (error: unknown) =>
        error instanceof AgentToolError &&
        error.code === "backend_contract_missing" &&
        error.retryable === false,
    );
  });

  it("preserves backend tool error codes in Agent failure events", async () => {
    const store = new SqliteAgentStore(":memory:");
    try {
      const events = await collect(
        runAgent(
          {
            userId: "backend-user",
            clientRequestId: "backend-no-token-request",
            mode: "kanyun",
            message: "帮我看今年事业",
          },
          {
            provider: new MockLLMProvider(),
            tools: new BackendAgentTools(
              new EchomereBackendClient({ baseUrl: "http://127.0.0.1:3001" }),
            ),
            runs: store,
            conversations: store,
            toolRuns: store,
          },
        ),
      );
      const failure = events.at(-1);
      assert.equal(failure?.type, "run_failed");
      if (failure?.type === "run_failed") {
        assert.equal(failure.code, "backend_unauthorized");
        assert.equal(failure.retryable, false);
        assert.match(failure.message, /重新登录/u);
      }

      const run = await store.findByClientRequestId("backend-no-token-request");
      const toolRuns = await store.listToolRunsByAgentRunId(run?.id ?? "");
      assert.equal(toolRuns[0]?.errorCode, "backend_unauthorized");
    } finally {
      store.close();
    }
  });
});

function createContractBackend(
  received: Array<{
    method?: string;
    url?: string;
    authorization?: string;
    requestId?: string;
  }>,
): Server {
  return createServer(async (request, response) => {
    received.push({
      ...(request.method ? { method: request.method } : {}),
      ...(request.url ? { url: request.url } : {}),
      ...(typeof request.headers.authorization === "string"
        ? { authorization: request.headers.authorization }
        : {}),
      ...(typeof request.headers["x-request-id"] === "string"
        ? { requestId: request.headers["x-request-id"] }
        : {}),
    });
    if (!request.headers.authorization?.startsWith("Bearer ")) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    if (request.method === "GET" && request.url === "/api/profile") {
      sendJson(response, 200, {
        user: { id: "backend-user" },
        primaryProfile: backendProfile,
        bazi: backendBazi,
      });
      return;
    }
    if (request.method === "GET" && request.url === "/api/profiles/profile-1") {
      sendJson(response, 200, { ...backendProfile, bazi: backendBazi });
      return;
    }
    if (
      request.method === "GET" &&
      request.url === "/api/conversations/agent-backend-conversation"
    ) {
      sendJson(response, 200, {
        id: "agent-backend-conversation",
        userId: "backend-user",
        mode: "kanyun",
        messages: [
          {
            id: "backend-message-1",
            conversationId: "agent-backend-conversation",
            userId: "backend-user",
            role: "user",
            content: "上一轮问题",
            clientRequestId: "previous-request",
            agentRunId: null,
            createdAt: "2026-08-27T00:00:00.000Z",
          },
          {
            id: "backend-message-2",
            conversationId: "agent-backend-conversation",
            userId: "backend-user",
            role: "assistant",
            content: "上一轮回答",
            clientRequestId: null,
            agentRunId: "previous-run",
            createdAt: "2026-08-27T00:00:01.000Z",
          },
          {
            id: "backend-message-current",
            conversationId: "agent-backend-conversation",
            userId: "backend-user",
            role: "user",
            content: "2027 年事业怎么样？",
            clientRequestId: "agent-backend-request",
            agentRunId: null,
            createdAt: "2026-08-27T00:00:02.000Z",
          },
        ],
      });
      return;
    }
    if (
      request.method === "POST" &&
      request.url === "/api/agent/tools/hexagram"
    ) {
      for await (const _chunk of request) {
        // Drain the request body to exercise the real HTTP behavior.
      }
      sendJson(response, 200, {
        reused: false,
        evidenceRef: "backend:hexagram:contract-test",
        hexagram: {
          schemaVersion: 2,
          engine: { name: "taibu-core", version: "3.5.0", schemaVersion: 2 },
          originalName: "乾为天",
          changedName: "坤为地",
          changingYaos: [1, 6],
          canonicalText: "六爻标准排盘文本",
        },
      });
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  });
}

const backendProfile = {
  id: "profile-1",
  userId: "backend-user",
  name: "后端用户",
  gender: "male",
  birthDateTime: "1990-05-15T07:00:00.000Z",
  birthLocation: "成都",
  isPrimary: true,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T01:00:00.000Z",
};

const backendBazi = {
  schemaVersion: 2,
  engine: { name: "taibu-core", version: "3.5.0", schemaVersion: 2 },
  year: "庚午",
  month: "辛巳",
  day: "庚辰",
  hour: "甲申",
  dayMaster: { gan: "庚", zhi: "辰", wuxing: "金" },
  canonicalText: "八字命盘标准文本",
  dayun: {
    list: [
      {
        liunianList: [
          {
            year: 2026,
            ganZhi: "丙午",
            tenGod: "七杀",
            nayin: "天河水",
            diShi: "沐浴",
            shenSha: ["天乙贵人"],
          },
          {
            year: 2027,
            ganZhi: "丁未",
            tenGod: "正官",
            nayin: "天河水",
            diShi: "冠带",
            shenSha: [],
          },
        ],
      },
    ],
  },
};

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const result: AgentEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
