export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamChunk {
  content: string;
  reasoning?: string;
}

export async function* streamChat(
  messages: ChatMessage[],
  options?: { temperature?: number }
): AsyncGenerator<StreamChunk, void, unknown> {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || "https://api.moonshot.cn/v1";
  const model = process.env.LLM_MODEL || "moonshot-v1-8k";

  if (!apiKey) {
    yield {
      content:
        "\n\n[系统提示：未配置 LLM_API_KEY，当前为占位回复。请在 .env 中填入 API Key 后重启服务。]",
    };
    return;
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
      stream: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    yield {
      content: `\n\n[调用失败：${res.status} ${res.statusText}${text ? ` - ${text}` : ""}]`,
    };
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    yield { content: "\n\n[调用失败：未收到流式响应]" };
    return;
  }

  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;

      try {
        const data = JSON.parse(trimmed.slice(6));
        const delta = data.choices?.[0]?.delta;
        if (delta) {
          yield {
            content: delta.content || "",
            reasoning: delta.reasoning_content || "",
          };
        }
      } catch {
        // ignore malformed JSON
      }
    }
  }
}
