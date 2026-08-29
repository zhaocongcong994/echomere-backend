import { z } from "zod";

export type LLMProviderKind = "mock" | "deepseek" | "openai-compatible";

export interface LLMRuntimeConfig {
  provider: LLMProviderKind;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "low" | "high" | "max";
}

const integerFromEnv = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? fallback : Number(value)),
    z.number().int().positive(),
  );

const envSchema = z.object({
  LLM_PROVIDER: z
    .enum(["mock", "deepseek", "openai-compatible"])
    .default("mock"),
  LLM_API_KEY: z.string().trim().optional(),
  LLM_BASE_URL: z.string().trim().url().optional().or(z.literal("")),
  LLM_MODEL: z.string().trim().optional(),
  LLM_TIMEOUT_MS: integerFromEnv(60_000),
  LLM_MAX_TOKENS: integerFromEnv(2_048),
  LLM_THINKING: z.enum(["enabled", "disabled"]).optional(),
  LLM_REASONING_EFFORT: z.enum(["low", "high", "max"]).optional(),
});

export function loadLLMConfig(
  environment: NodeJS.ProcessEnv = process.env,
): LLMRuntimeConfig {
  const parsed = envSchema.parse(environment);

  if (parsed.LLM_PROVIDER === "mock" || !parsed.LLM_API_KEY) {
    return {
      provider: "mock",
      model: "mock-v1",
      timeoutMs: parsed.LLM_TIMEOUT_MS,
      maxTokens: parsed.LLM_MAX_TOKENS,
    };
  }

  if (parsed.LLM_PROVIDER === "deepseek") {
    return {
      provider: "deepseek",
      apiKey: parsed.LLM_API_KEY,
      baseUrl: parsed.LLM_BASE_URL || "https://api.deepseek.com",
      model: parsed.LLM_MODEL || "deepseek-v4-flash",
      timeoutMs: parsed.LLM_TIMEOUT_MS,
      maxTokens: parsed.LLM_MAX_TOKENS,
      thinking: parsed.LLM_THINKING ?? "disabled",
      ...(parsed.LLM_REASONING_EFFORT
        ? { reasoningEffort: parsed.LLM_REASONING_EFFORT }
        : {}),
    };
  }

  if (!parsed.LLM_BASE_URL || !parsed.LLM_MODEL) {
    throw new Error(
      "LLM_BASE_URL and LLM_MODEL are required for the openai-compatible provider.",
    );
  }

  return {
    provider: "openai-compatible",
    apiKey: parsed.LLM_API_KEY,
    baseUrl: parsed.LLM_BASE_URL,
    model: parsed.LLM_MODEL,
    timeoutMs: parsed.LLM_TIMEOUT_MS,
    maxTokens: parsed.LLM_MAX_TOKENS,
  };
}
