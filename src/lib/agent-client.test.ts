import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";
import { AgentServiceClient, AgentServiceError } from "./agent-client.js";

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Agent client forwards credentials and parses fragmented SSE", async () => {
  let receivedSecret = "";
  let receivedAuthorization = "";
  let receivedRequestId = "";
  let receivedBody: unknown;
  const server = createServer(async (request, response) => {
    receivedSecret = String(request.headers["x-agent-secret"] || "");
    receivedAuthorization = String(request.headers.authorization || "");
    receivedRequestId = String(request.headers["x-request-id"] || "");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(
      'event: run_started\ndata: {"type":"run_started","runId":"run-1","conversationId":"conversation-1","resolvedMode":"qingting","routeReason":"测试路由"}\n\n',
    );
    response.write(
      'event: content_delta\ndata: {"type":"content_delta","runId":"run-1","delta":"你好"}\n',
    );
    response.write("\n");
    response.end(
      'event: run_completed\ndata: {"type":"run_completed","runId":"run-1","result":{"contentMarkdown":"你好","requestedMode":"qingting","resolvedMode":"qingting","routeReason":"测试路由","evidenceRefs":[],"actionItems":[],"caveats":[],"toolRunIds":[],"safetyCategories":[],"model":"mock-v1"}}\n\n',
    );
  });
  servers.push(server);
  const baseUrl = await listen(server);
  const client = new AgentServiceClient({
    baseUrl,
    sharedSecret: "shared-secret",
  });

  const events = [];
  for await (const event of client.stream(
    {
      userId: "user-1",
      clientRequestId: "request-1",
      conversationId: "conversation-1",
      mode: "qingting",
      message: "测试",
    },
    { accessToken: "user-token", requestId: "trace-request-1" },
  )) {
    events.push(event);
  }

  assert.deepEqual(
    events.map((event) => event.type),
    ["run_started", "content_delta", "run_completed"],
  );
  assert.equal(receivedSecret, "shared-secret");
  assert.equal(receivedAuthorization, "Bearer user-token");
  assert.equal(receivedRequestId, "trace-request-1");
  assert.deepEqual(receivedBody, {
    userId: "user-1",
    clientRequestId: "request-1",
    conversationId: "conversation-1",
    mode: "qingting",
    message: "测试",
  });
});

test("Agent client validates the public health endpoint", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404).end();
  });
  servers.push(server);
  const client = new AgentServiceClient({ baseUrl: await listen(server) });
  await client.health();
});

test("Agent client reads a credential-free runtime profile catalog", async () => {
  let receivedSecret = "";
  let receivedSwitchBody: unknown;
  const server = createServer(async (request, response) => {
    receivedSecret = String(request.headers["x-agent-secret"] || "");
    if (request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      receivedSwitchBody = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      ) as unknown;
    }
    const activeProfileId = request.method === "POST"
      ? "deepseek-reasoner"
      : "deepseek-fast";
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        provider: "deepseek",
        model:
          activeProfileId === "deepseek-fast"
            ? "deepseek-v4-flash"
            : "deepseek-reasoner",
        modelSelection: "profile-file",
        activeProfileId,
        profiles: [
          {
            id: "deepseek-fast",
            label: "DeepSeek Fast",
            provider: "deepseek",
            model: "deepseek-v4-flash",
            configured: true,
            active: activeProfileId === "deepseek-fast",
          },
          {
            id: "deepseek-reasoner",
            label: "DeepSeek Reasoner",
            provider: "deepseek",
            model: "deepseek-reasoner",
            configured: true,
            active: activeProfileId === "deepseek-reasoner",
          },
        ],
        restartRequiredToSwitch: false,
        switching: {
          enabled: true,
          persistsAcrossRestart: true,
          validation: "provider-model-list",
        },
        limits: { maxInputCharacters: 32000, maxOutputTokens: 2048 },
        retry: {
          maxRetries: 1,
          baseDelayMs: 500,
          maxDelayMs: 4000,
          onlyBeforeFirstOutput: true,
        },
        quality: { maxRewrites: 1, buffersDraftUntilValidated: true },
        thinking: { mode: "disabled" },
      }),
    );
  });
  servers.push(server);
  const client = new AgentServiceClient({
    baseUrl: await listen(server),
    sharedSecret: "runtime-shared-secret",
  });

  const runtime = await client.runtime();
  assert.equal(receivedSecret, "runtime-shared-secret");
  assert.equal(runtime.activeProfileId, "deepseek-fast");
  assert.equal(runtime.profiles[0]?.configured, true);
  assert.equal(JSON.stringify(runtime).includes("apiKey"), false);

  const switched = await client.switchRuntimeProfile("deepseek-reasoner");
  assert.deepEqual(receivedSwitchBody, { profileId: "deepseek-reasoner" });
  assert.equal(switched.activeProfileId, "deepseek-reasoner");
  assert.equal(switched.model, "deepseek-reasoner");
});

test("Agent client rejects a stream without a terminal event", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(
      'event: run_started\ndata: {"type":"run_started","runId":"run-incomplete"}\n\n',
    );
  });
  servers.push(server);
  const client = new AgentServiceClient({ baseUrl: await listen(server) });

  await assert.rejects(
    async () => {
      for await (const _event of client.stream(
        {
          userId: "user-1",
          clientRequestId: "request-incomplete",
          conversationId: "conversation-1",
          mode: "qingting",
          message: "test",
        },
        { accessToken: "token" },
      )) {
        // Consume the complete stream.
      }
    },
    (error: unknown) =>
      error instanceof AgentServiceError && error.code === "agent_invalid_stream",
  );
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
