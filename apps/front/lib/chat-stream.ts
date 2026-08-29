export interface ParsedSSEEvent {
  event: string;
  data: unknown;
}

export class JsonSSEParser {
  private buffer = "";

  push(chunk: string): ParsedSSEEvent[] {
    this.buffer += chunk;
    return this.readFrames(false);
  }

  finish(chunk = ""): ParsedSSEEvent[] {
    this.buffer += chunk;
    return this.readFrames(true);
  }

  private readFrames(flush: boolean): ParsedSSEEvent[] {
    const events: ParsedSSEEvent[] = [];
    while (this.buffer.length > 0) {
      const delimiter = /\r?\n\r?\n/u.exec(this.buffer);
      if (!delimiter) {
        if (!flush) break;
        const finalFrame = this.buffer;
        this.buffer = "";
        const event = parseFrame(finalFrame);
        if (event) events.push(event);
        break;
      }
      const frame = this.buffer.slice(0, delimiter.index);
      this.buffer = this.buffer.slice(delimiter.index + delimiter[0].length);
      const event = parseFrame(frame);
      if (event) events.push(event);
    }
    return events;
  }
}

export function describeChatHttpError(
  status: number,
  payload: Record<string, unknown>,
): string {
  const code = typeof payload.error === "string" ? payload.error : "";
  const message = typeof payload.message === "string" ? payload.message : "";
  const retryAfter =
    typeof payload.retryAfterSeconds === "number"
      ? `，约 ${payload.retryAfterSeconds} 秒后可重试`
      : "";

  if (status === 401) return "登录状态已失效，请重新登录。";
  if (status === 429 || code === "CHAT_RATE_LIMITED") {
    return `请求过于频繁${retryAfter}。`;
  }
  if (
    status === 503 ||
    code === "CHAT_RATE_LIMIT_UNAVAILABLE" ||
    code === "agent_concurrency_unavailable"
  ) {
    return `聊天服务暂时不可用${retryAfter}，请稍后重试。`;
  }
  if (code === "NO_PROFILE") return "看运需要先建立命盘档案。";
  if (code === "CONVERSATION_MODE_CONFLICT") {
    return "当前对话已锁定为其他模式，请新建对话后再试。";
  }
  if (code === "CLIENT_REQUEST_ID_CONFLICT") {
    return "这次请求与已有记录冲突，请重新发送。";
  }
  return message || code || `请求失败（HTTP ${status}）`;
}

export function describeStreamError(payload: Record<string, unknown>): string {
  const code = typeof payload.code === "string" ? payload.code : "";
  const message = typeof payload.message === "string" ? payload.message : "";
  if (code === "profile_required") return "看运需要先选择或创建一份命盘档案。";
  if (code === "agent_run_interrupted") return "本次回答已停止。";
  if (code === "agent_stream_incomplete") return "回答意外中断，请重新发送。";
  if (code === "agent_rate_limited") return "当前运行较多，请稍后重试。";
  if (code === "provider_output_truncated") {
    return "回答达到长度上限，请缩小问题范围后重试。";
  }
  if (code === "provider_incomplete_response" || code === "provider_invalid_stream") {
    return "模型连接意外中断，请重试。";
  }
  if (code === "provider_content_filtered") {
    return "本次请求未能生成可展示的回答，请调整表达后重试。";
  }
  if (code === "provider_insufficient_system_resource") {
    return "模型服务当前繁忙，请稍后重试。";
  }
  if (code === "model_input_budget_exceeded") {
    return "当前对话上下文过长，请新建对话或缩短问题后重试。";
  }
  if (code === "provider_rate_limited") {
    return "模型请求过于频繁，请稍后重试。";
  }
  if (
    code === "provider_timeout" ||
    code === "provider_network_error" ||
    code === "provider_unavailable"
  ) {
    return "模型服务暂时未响应，请稍后重试。";
  }
  if (
    code === "provider_unauthorized" ||
    code === "provider_forbidden" ||
    code === "provider_model_not_found"
  ) {
    return "模型配置不可用，请联系管理员检查配置。";
  }
  return message || "Agent 运行失败，请稍后重试。";
}

function parseFrame(frame: string): ParsedSSEEvent | null {
  if (!frame.trim() || frame.trimStart().startsWith(":")) return null;
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/u)) {
    if (line.startsWith("event:")) event = line.slice(6).trim() || "message";
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /u, ""));
  }
  if (dataLines.length === 0) return null;
  const rawData = dataLines.join("\n");
  return { event, data: JSON.parse(rawData) as unknown };
}
