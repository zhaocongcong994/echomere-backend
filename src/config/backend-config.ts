import { z } from "zod";

export type AgentToolsProviderKind = "mock" | "echomere-backend";

export interface BackendRuntimeConfig {
  toolsProvider: AgentToolsProviderKind;
  baseUrl: string;
  timeoutMs: number;
  localAccessToken?: string;
}

const integerFromEnv = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? fallback : Number(value)),
    z.number().int().positive(),
  );

const envSchema = z.object({
  AGENT_TOOLS_PROVIDER: z
    .enum(["mock", "echomere-backend"])
    .default("mock"),
  ECHOMERE_BACKEND_URL: z
    .string()
    .trim()
    .url()
    .default("http://127.0.0.1:3001"),
  ECHOMERE_BACKEND_TIMEOUT_MS: integerFromEnv(10_000),
  ECHOMERE_BACKEND_TOKEN: z.string().trim().optional(),
});

export function loadBackendConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BackendRuntimeConfig {
  const parsed = envSchema.parse(environment);
  return {
    toolsProvider: parsed.AGENT_TOOLS_PROVIDER,
    baseUrl: parsed.ECHOMERE_BACKEND_URL.replace(/\/+$/u, ""),
    timeoutMs: parsed.ECHOMERE_BACKEND_TIMEOUT_MS,
    ...(parsed.ECHOMERE_BACKEND_TOKEN
      ? { localAccessToken: parsed.ECHOMERE_BACKEND_TOKEN }
      : {}),
  };
}
