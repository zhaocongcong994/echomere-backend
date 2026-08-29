import type { LLMMessage } from "../providers/llm-provider.ts";
import type { ConversationMessageRecord } from "../repositories/types.ts";

export interface LoadedConversationContext {
  messages: LLMMessage[];
  messageIds: string[];
  characterCount: number;
}

export function loadConversationContext(
  history: ConversationMessageRecord[],
  options: { maxMessages?: number; maxCharacters?: number } = {},
): LoadedConversationContext {
  const maxMessages = options.maxMessages ?? 8;
  const maxCharacters = options.maxCharacters ?? 12_000;
  const selected: ConversationMessageRecord[] = [];
  let characterCount = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (selected.length >= maxMessages || characterCount >= maxCharacters) break;
    const message = history[index];
    if (!message || message.content.trim().length === 0) continue;

    const remaining = maxCharacters - characterCount;
    if (remaining <= 0) break;
    const tailLength = Math.max(0, remaining - 1);
    const content =
      message.content.length <= remaining
        ? message.content
        : tailLength === 0
          ? "…"
          : `…${message.content.slice(-tailLength)}`;
    selected.push({ ...message, content });
    characterCount += content.length;
  }

  selected.reverse();
  return {
    messages: selected.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    messageIds: selected.map((message) => message.id),
    characterCount,
  };
}
