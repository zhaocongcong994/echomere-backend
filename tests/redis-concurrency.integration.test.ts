import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type {
  LLMChunk,
  LLMProvider,
  LLMRequest,
} from "../src/providers/llm-provider.ts";
import { SqliteAgentStore } from "../src/repositories/sqlite-agent-store.ts";
import { createAgentServer } from "../src/server/app.ts";
import { RedisRunConcurrencyLimiter } from "../src/server/run-concurrency.ts";
import { LocalMockAgentTools } from "../src/tools/local-mock-tools.ts";

const redisUrl = process.env.TEST_REDIS_URL;

test(
  "two Agent HTTP instances share Redis concurrency leases",
  { skip: redisUrl ? false : "TEST_REDIS_URL is not configured" },
  async () => {
    let providerWasAborted = false;
    const slowProvider: LLMProvider = {
      name: "redis-slow-provider",
      model: "redis-slow-model",
      async *stream(
        _request: LLMRequest,
        options?: { signal?: AbortSignal },
      ): AsyncIterable<LLMChunk> {
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              providerWasAborted = true;
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        });
      },
    };
    const prefix = `echomere:test:http:${randomUUID()}`;
    const firstStore = new SqliteAgentStore(":memory:");
    const secondStore = new SqliteAgentStore(":memory:");
    const firstLimiter = new RedisRunConcurrencyLimiter({
      url: redisUrl!,
      maxGlobal: 1,
      maxPerUser: 1,
      leaseTtlMs: 3_000,
      keyPrefix: prefix,
    });
    const secondLimiter = new RedisRunConcurrencyLimiter({
      url: redisUrl!,
      maxGlobal: 1,
      maxPerUser: 1,
      leaseTtlMs: 3_000,
      keyPrefix: prefix,
    });
    const firstServer = createAgentServer({
      provider: slowProvider,
      tools: new LocalMockAgentTools([], { hexagrams: firstStore }),
      runs: firstStore,
      conversations: firstStore,
      toolRuns: firstStore,
      runLimiter: firstLimiter,
    });
    const secondServer = createAgentServer({
      provider: slowProvider,
      tools: new LocalMockAgentTools([], { hexagrams: secondStore }),
      runs: secondStore,
      conversations: secondStore,
      toolRuns: secondStore,
      runLimiter: secondLimiter,
    });

    try {
      const [firstUrl, secondUrl] = await Promise.all([
        listen(firstServer),
        listen(secondServer),
      ]);
      const controller = new AbortController();
      const activeResponse = await fetch(`${firstUrl}/api/agent/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "shared-redis-user",
          clientRequestId: "redis-http-active",
          mode: "qingting",
          message: "保持第一个运行",
        }),
        signal: controller.signal,
      });
      assert.equal(activeResponse.status, 200);

      const blockedResponse = await fetch(`${secondUrl}/api/agent/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "shared-redis-user",
          clientRequestId: "redis-http-blocked",
          mode: "qingting",
          message: "第二个实例必须拒绝",
        }),
      });
      assert.equal(blockedResponse.status, 429);
      assert.equal(
        ((await blockedResponse.json()) as { error: string }).error,
        "agent_rate_limited",
      );

      controller.abort();
      await activeResponse.text().catch(() => undefined);
      for (let attempt = 0; attempt < 30 && !providerWasAborted; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(providerWasAborted, true);
    } finally {
      await Promise.all([close(firstServer), close(secondServer)]);
      await Promise.all([firstLimiter.close(), secondLimiter.close()]);
      firstStore.close();
      secondStore.close();
    }
  },
);

async function listen(server: ReturnType<typeof createAgentServer>): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: ReturnType<typeof createAgentServer>): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
