import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";

test("Backend proxies Agent SSE idempotently and persists one hexagram per conversation", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "echomere-integration-"));
  const databasePath = join(temporaryDirectory, "integration.db");
  await applyMigrations(databasePath);

  const agentRequests: Array<{
    authorization?: string;
    secret?: string;
    body: Record<string, unknown>;
  }> = [];
  const runtimeProfileSwitches: string[] = [];
  const requestCounts = new Map<string, number>();
  const fakeAgent = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, provider: "mock", model: "mock-v1" }));
      return;
    }
    if (request.method === "GET" && request.url === "/api/runtime") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          provider: "mock",
          model: "mock-v1",
          modelSelection: "legacy-env",
          activeProfileId: "default",
          profiles: [
            {
              id: "default",
              label: "mock / mock-v1",
              provider: "mock",
              model: "mock-v1",
              configured: true,
              active: true,
            },
            {
              id: "alternate",
              label: "alternate / alternate-v1",
              provider: "openai-compatible",
              model: "alternate-v1",
              configured: true,
              active: false,
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
      return;
    }
    if (request.method === "POST" && request.url === "/api/runtime/profile") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        profileId: string;
      };
      runtimeProfileSwitches.push(body.profileId);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          provider: "openai-compatible",
          model: "alternate-v1",
          modelSelection: "profile-file",
          activeProfileId: "alternate",
          profiles: [
            {
              id: "default",
              label: "mock / mock-v1",
              provider: "mock",
              model: "mock-v1",
              configured: true,
              active: false,
            },
            {
              id: "alternate",
              label: "alternate / alternate-v1",
              provider: "openai-compatible",
              model: "alternate-v1",
              configured: true,
              active: true,
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
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
    agentRequests.push({
      ...(typeof request.headers.authorization === "string"
        ? { authorization: request.headers.authorization }
        : {}),
      ...(typeof request.headers["x-agent-secret"] === "string"
        ? { secret: request.headers["x-agent-secret"] }
        : {}),
      body,
    });

    const clientRequestId = String(body.clientRequestId);
    const mode = String(body.mode) as "kanyun" | "qingting" | "wenshi";
    const runId = `run-${clientRequestId}`;
    const count = (requestCounts.get(clientRequestId) ?? 0) + 1;
    requestCounts.set(clientRequestId, count);
    const content = mode === "wenshi" ? "问事完成" : "倾听完成";

    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(
      `event: run_started\ndata: ${JSON.stringify({
        type: "run_started",
        runId,
        conversationId: body.conversationId,
        mode,
        resolvedMode: mode,
        routeReason: "集成测试路由",
      })}\n\n`,
    );
    if (count === 1) {
      response.write(
        `event: content_delta\ndata: ${JSON.stringify({
          type: "content_delta",
          runId,
          delta: content,
        })}\n\n`,
      );
    }
    response.end(
      `event: run_completed\ndata: ${JSON.stringify({
        type: "run_completed",
        runId,
        ...(count > 1 ? { reused: true } : {}),
        result: {
          contentMarkdown: content,
          requestedMode: mode,
          resolvedMode: mode,
          routeReason: "集成测试路由",
          evidenceRefs: [],
          actionItems: [],
          caveats: [],
          toolRunIds: [],
          safetyCategories: [],
          model: "integration-mock",
        },
      })}\n\n`,
    );
  });

  let backendServer: Server | undefined;
  try {
    const agentUrl = await listen(fakeAgent);
    process.env.DATABASE_URL = `file:${databasePath}`;
    process.env.JWT_SECRET = "integration-jwt-secret";
    process.env.AGENT_SERVICE_URL = agentUrl;
    process.env.AGENT_SHARED_SECRET = "integration-agent-secret";
    process.env.AGENT_RUNTIME_MODEL_CONTROL_ENABLED = "true";
    process.env.AGENT_RUNTIME_MODEL_ADMIN_EMAILS = "integration@local.test";
    process.env.CHAT_RATE_LIMIT_MAX = "3";
    process.env.CHAT_RATE_LIMIT_WINDOW_MS = "60000";

    const [{ createApp }, { prisma }] = await Promise.all([
      import("../app.js"),
      import("./prisma.js"),
    ]);
    backendServer = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => backendServer?.once("listening", resolve));
    const backendUrl = addressOf(backendServer);

    const loginResponse = await fetch(`${backendUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "integration@local.test", code: "123456" }),
    });
    assert.equal(loginResponse.status, 200);
    const login = (await loginResponse.json()) as {
      token: string;
      user: { id: string };
    };
    const authHeaders = {
      Authorization: `Bearer ${login.token}`,
      "Content-Type": "application/json",
    };

    const livenessResponse = await fetch(`${backendUrl}/api/health`, {
      headers: { "X-Request-Id": "integration-trace-id" },
    });
    assert.equal(livenessResponse.headers.get("x-request-id"), "integration-trace-id");
    const readinessResponse = await fetch(`${backendUrl}/api/ready`);
    assert.equal(readinessResponse.status, 200);
    assert.deepEqual(await readinessResponse.json(), {
      status: "ready",
      components: { database: "ok", agent: "ok", rateLimit: "ok" },
    });

    const runtimeResponse = await fetch(`${backendUrl}/api/agent/runtime`, {
      headers: { Authorization: `Bearer ${login.token}` },
    });
    assert.equal(runtimeResponse.status, 200);
    const runtime = (await runtimeResponse.json()) as {
      activeProfileId: string;
      profiles: Array<{ id: string }>;
      switching: { enabled: boolean; access: string };
    };
    assert.equal(runtime.activeProfileId, "default");
    assert.equal(runtime.profiles[0]?.id, "default");
    assert.deepEqual(runtime.switching, {
      enabled: true,
      persistsAcrossRestart: true,
      validation: "provider-model-list",
      access: "admin",
    });

    const readOnlyLoginResponse = await fetch(`${backendUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "viewer@local.test", code: "123456" }),
    });
    assert.equal(readOnlyLoginResponse.status, 200);
    const readOnlyLogin = (await readOnlyLoginResponse.json()) as {
      token: string;
    };
    const readOnlyRuntimeResponse = await fetch(
      `${backendUrl}/api/agent/runtime`,
      { headers: { Authorization: `Bearer ${readOnlyLogin.token}` } },
    );
    assert.equal(readOnlyRuntimeResponse.status, 200);
    const readOnlyRuntime = (await readOnlyRuntimeResponse.json()) as {
      switching: { enabled: boolean; access: string };
    };
    assert.equal(readOnlyRuntime.switching.enabled, false);
    assert.equal(readOnlyRuntime.switching.access, "read-only");

    const forbiddenSwitchResponse = await fetch(
      `${backendUrl}/api/agent/runtime/profile`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${readOnlyLogin.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ profileId: "alternate" }),
      },
    );
    assert.equal(forbiddenSwitchResponse.status, 403);
    assert.equal(
      ((await forbiddenSwitchResponse.json()) as { error: string }).error,
      "agent_profile_switch_forbidden",
    );
    assert.deepEqual(runtimeProfileSwitches, []);

    const switchResponse = await fetch(
      `${backendUrl}/api/agent/runtime/profile`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ profileId: "alternate" }),
      },
    );
    assert.equal(switchResponse.status, 200);
    assert.equal(
      ((await switchResponse.json()) as { activeProfileId: string })
        .activeProfileId,
      "alternate",
    );
    assert.deepEqual(runtimeProfileSwitches, ["alternate"]);

    const [first, retry] = await Promise.all([
      postChat(backendUrl, authHeaders, {
        mode: "qingting",
        message: "最近有些焦虑",
        clientRequestId: "integration-qingting-request",
      }),
      postChat(backendUrl, authHeaders, {
        mode: "qingting",
        message: "最近有些焦虑",
        clientRequestId: "integration-qingting-request",
      }),
    ]);
    assert.deepEqual(
      first.map((event) => event.event),
      ["meta", "chunk", "done"],
      JSON.stringify(first),
    );
    const qingtingConversationId = String(first[0]?.data.conversationId);

    assert.equal(retry.some((event) => event.event === "chunk"), true);
    assert.equal(
      [first, retry].some((events) => events.at(-1)?.data.reused === true),
      true,
    );

    const conversationResponse = await fetch(
      `${backendUrl}/api/conversations/${qingtingConversationId}`,
      { headers: { Authorization: `Bearer ${login.token}` } },
    );
    const conversation = (await conversationResponse.json()) as {
      messages: Array<{ role: string; clientRequestId?: string; agentRunId?: string }>;
    };
    assert.deepEqual(
      conversation.messages.map((message) => message.role),
      ["user", "assistant"],
    );
    assert.equal(
      conversation.messages[0]?.clientRequestId,
      "integration-qingting-request",
    );
    assert.equal(
      conversation.messages[1]?.agentRunId,
      "run-integration-qingting-request",
    );

    const subscriptionResponse = await fetch(`${backendUrl}/api/subscription`, {
      headers: { Authorization: `Bearer ${login.token}` },
    });
    const subscription = (await subscriptionResponse.json()) as { used: number };
    assert.equal(subscription.used, 1);

    const wenshi = await postChat(backendUrl, authHeaders, {
      mode: "wenshi",
      message: "我该不该接受这份工作？",
      clientRequestId: "integration-wenshi-request",
    });
    const wenshiConversationId = String(wenshi[0]?.data.conversationId);

    const firstHexagramResponse = await fetch(
      `${backendUrl}/api/agent/tools/hexagram`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          conversationId: wenshiConversationId,
          question: "我该不该接受这份工作？",
          at: "2026-08-27T00:00:00.000Z",
        }),
      },
    );
    assert.equal(firstHexagramResponse.status, 200);
    const firstHexagram = (await firstHexagramResponse.json()) as {
      reused: boolean;
      evidenceRef: string;
      hexagram: { originalName: string; canonicalText: string };
    };
    assert.equal(firstHexagram.reused, false);
    assert.ok(firstHexagram.hexagram.canonicalText.length > 0);

    const reusedHexagramResponse = await fetch(
      `${backendUrl}/api/agent/tools/hexagram`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          conversationId: wenshiConversationId,
          question: "换个问法再问一次",
          at: "2026-08-27T01:00:00.000Z",
        }),
      },
    );
    const reusedHexagram = (await reusedHexagramResponse.json()) as {
      reused: boolean;
      evidenceRef: string;
      hexagram: { originalName: string };
    };
    assert.equal(reusedHexagram.reused, true);
    assert.equal(
      reusedHexagram.hexagram.originalName,
      firstHexagram.hexagram.originalName,
    );
    assert.equal(reusedHexagram.evidenceRef, firstHexagram.evidenceRef);

    const wrongModeHexagram = await fetch(
      `${backendUrl}/api/agent/tools/hexagram`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          conversationId: qingtingConversationId,
          question: "不应在倾听模式起卦",
          at: "2026-08-27T00:00:00.000Z",
        }),
      },
    );
    assert.equal(wrongModeHexagram.status, 409);

    const limited = await fetch(`${backendUrl}/api/chat/stream`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        mode: "qingting",
        message: "超出本次测试的限流配额",
        clientRequestId: "integration-rate-limited-request",
      }),
    });
    assert.equal(
      limited.status,
      429,
      JSON.stringify({
        limit: limited.headers.get("x-ratelimit-limit"),
        remaining: limited.headers.get("x-ratelimit-remaining"),
      }),
    );
    assert.equal(limited.headers.get("x-ratelimit-remaining"), "0");
    assert.ok(limited.headers.get("retry-after"));

    const metricsResponse = await fetch(`${backendUrl}/api/metrics`);
    assert.equal(metricsResponse.status, 200);
    const metrics = await metricsResponse.text();
    assert.match(metrics, /echomere_backend_http_requests_total/u);
    assert.match(metrics, /echomere_backend_chat_rate_limited_total 1/u);
    assert.match(
      metrics,
      /echomere_backend_runtime_model_switches_total\{outcome="succeeded"\} 1/u,
    );
    assert.match(
      metrics,
      /echomere_backend_runtime_model_switches_total\{outcome="denied"\} 1/u,
    );

    assert.ok(
      agentRequests.every(
        (request) =>
          request.authorization === `Bearer ${login.token}` &&
          request.secret === "integration-agent-secret",
      ),
    );
    assert.ok(
      agentRequests.every(
        (request) => request.body.userId === login.user.id,
      ),
    );

    assert.equal(await prisma.hexagram.count(), 1);
    assert.equal(await prisma.message.count(), 4);
    assert.equal(await prisma.billingRecord.count(), 2);
    await prisma.$disconnect();
  } finally {
    if (backendServer) {
      await new Promise<void>((resolve) => backendServer?.close(() => resolve()));
    }
    await new Promise<void>((resolve) => fakeAgent.close(() => resolve()));
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

async function applyMigrations(databasePath: string): Promise<void> {
  const database = createClient({ url: `file:${databasePath}` });
  const migrationsDirectory = join(process.cwd(), "prisma", "migrations");
  const migrations = readdirSync(migrationsDirectory, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const migration of migrations) {
    await database.executeMultiple(
      readFileSync(
        join(migrationsDirectory, migration, "migration.sql"),
        "utf8",
      ),
    );
  }
  database.close();
}

async function postChat(
  baseUrl: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const response = await fetch(`${baseUrl}/api/chat/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return parseSSE(await response.text());
}

function parseSSE(
  text: string,
): Array<{ event: string; data: Record<string, unknown> }> {
  return text
    .split(/\r?\n\r?\n/u)
    .map((frame) => frame.trim())
    .filter((frame) => frame && !frame.startsWith("retry:"))
    .map((frame) => {
      const lines = frame.split(/\r?\n/u);
      const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
      const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
      if (!event || !data) throw new Error(`Invalid SSE frame: ${frame}`);
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return addressOf(server);
}

function addressOf(server: Server): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
