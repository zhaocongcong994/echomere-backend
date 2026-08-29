import type { LLMRuntimeConfig } from "../config/llm-config.ts";
import type { LLMProvider } from "./llm-provider.ts";
import { MockLLMProvider } from "./mock-provider.ts";
import { OpenAICompatibleLLMProvider } from "./openai-compatible-provider.ts";

export function createLLMProvider(config: LLMRuntimeConfig): LLMProvider {
  if (config.provider === "mock" || !config.apiKey) {
    return new MockLLMProvider();
  }

  if (!config.baseUrl) {
    throw new Error(`Missing base URL for provider: ${config.provider}`);
  }

  return new OpenAICompatibleLLMProvider({
    providerName: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
    maxTokens: config.maxTokens,
    ...(config.thinking ? { thinking: config.thinking } : {}),
    ...(config.reasoningEffort
      ? { reasoningEffort: config.reasoningEffort }
      : {}),
  });
}
