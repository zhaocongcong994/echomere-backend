import type { LLMChunk, LLMProvider, LLMRequest } from "./llm-provider.ts";

export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";
  readonly model = "mock-v1";

  async *stream(
    request: LLMRequest,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<LLMChunk> {
    const userMessage = [...request.messages]
      .reverse()
      .find((message) => message.role === "user")?.content;

    const response = buildMockResponse({
      mode: request.metadata.mode,
      userMessage: userMessage ?? "",
      ...(request.metadata.contextSummary
        ? { contextSummary: request.metadata.contextSummary }
        : {}),
    });

    const chunks = response.match(/.{1,18}/gu) ?? [response];

    for (const delta of chunks) {
      if (options?.signal?.aborted) {
        throw new DOMException("The Agent run was aborted.", "AbortError");
      }
      yield { type: "content", delta };
    }

    yield {
      type: "usage",
      inputTokens: Math.max(1, Math.ceil(JSON.stringify(request.messages).length / 4)),
      outputTokens: Math.max(1, Math.ceil(response.length / 4)),
    };
    yield { type: "completed", finishReason: "stop" };
  }
}

function buildMockResponse(input: {
  mode: string;
  userMessage: string;
  contextSummary?: string;
}): string {
  if (input.mode === "qingting") {
    return [
      "听起来你已经承受了不小的压力，能把它说出来很不容易。",
      `我听见的是：“${input.userMessage}”。这是元见 Agent 的本地 Mock 响应。`,
      "今天可以先做一个小行动：写下此刻最让你紧绷的一件事，只分辨它是事实还是担心。",
      "如果只选一件事先变得轻一点，你最希望是哪一件？",
    ].join("\n\n");
  }

  return [
    "## 一句话结论",
    `这是元见 Agent 的本地 Mock 响应；当前只验证 ${input.mode} 模式的编排与输出结构。`,
    "## 已确认依据",
    input.contextSummary ?? "当前模式没有可用工具依据。",
    "## 合理解释",
    `针对“${input.userMessage}”，当前内容只是可能的解读示例，不是对现实的确定判断。`,
    "## 行动建议",
    "- 先记录一个可验证的信号。\n- 在做决定前，用现实信息交叉核对。",
    "## 不确定性与边界",
    "Mock 工具只用于本地流程验证，不能用来推断真实事件。",
    "## 可以继续追问",
    "你也可以继续问：关键风险、可验证信号，或下一步行动。",
  ].join("\n\n");
}
