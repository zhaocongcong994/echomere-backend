import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeChatHttpError,
  describeStreamError,
  JsonSSEParser,
} from "../lib/chat-stream.ts";

describe("chat SSE parser", () => {
  it("parses fragmented LF and CRLF frames", () => {
    const parser = new JsonSSEParser();
    assert.deepEqual(parser.push("event: meta\r\ndata: {\"conversation"), []);
    assert.deepEqual(
      parser.push("Id\":\"c1\"}\r\n\r\nevent: chunk\ndata: {\"content\":\"你好\"}\n\n"),
      [
        { event: "meta", data: { conversationId: "c1" } },
        { event: "chunk", data: { content: "你好" } },
      ],
    );
  });

  it("ignores comments and flushes a final frame", () => {
    const parser = new JsonSSEParser();
    assert.deepEqual(parser.push(": keep-alive\n\n"), []);
    assert.deepEqual(parser.finish("event: done\ndata: {\"ok\":true}"), [
      { event: "done", data: { ok: true } },
    ]);
  });
});

describe("chat errors", () => {
  it("maps rate limit and dependency failures to user-facing copy", () => {
    assert.match(
      describeChatHttpError(429, { error: "CHAT_RATE_LIMITED", retryAfterSeconds: 3 }),
      /3 秒/u,
    );
    assert.match(
      describeChatHttpError(503, { error: "agent_concurrency_unavailable" }),
      /暂时不可用/u,
    );
    assert.match(describeStreamError({ code: "profile_required" }), /命盘档案/u);
    assert.match(
      describeStreamError({ code: "provider_output_truncated" }),
      /长度上限/u,
    );
    assert.match(
      describeStreamError({ code: "provider_unauthorized" }),
      /配置不可用/u,
    );
    assert.match(
      describeStreamError({ code: "model_input_budget_exceeded" }),
      /上下文过长/u,
    );
    assert.match(
      describeStreamError({ code: "provider_timeout" }),
      /暂时未响应/u,
    );
  });
});
