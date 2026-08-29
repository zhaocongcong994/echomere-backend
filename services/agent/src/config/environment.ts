import { isAbsolute } from "node:path";

export type RuntimeModelSwitchMode = "disabled" | "local" | "service";

export interface AgentEnvironment {
  host: string;
  port: number;
  shutdownTimeoutMs: number;
  maxModelInputCharacters: number;
  maxProviderRetries: number;
  maxQualityRewrites: number;
  providerRetryBaseDelayMs: number;
  providerRetryMaxDelayMs: number;
  runtimeModelSwitchEnabled: boolean;
  runtimeModelSwitchMode: RuntimeModelSwitchMode;
  runtimeModelSelectionPath: string;
  runtimeModelSwitchValidationTimeoutMs: number;
}

type Environment = Record<string, string | undefined>;

export function validateAgentEnvironment(
  env: Environment = process.env,
): AgentEnvironment {
  const host = env.AGENT_HOST?.trim() || "127.0.0.1";
  const port = readInteger(env.AGENT_PORT, 4_310, 1, 65_535, "AGENT_PORT");
  const shutdownTimeoutMs = readInteger(
    env.SHUTDOWN_TIMEOUT_MS,
    30_000,
    1_000,
    180_000,
    "SHUTDOWN_TIMEOUT_MS",
  );
  const maxModelInputCharacters = readInteger(
    env.AGENT_MAX_MODEL_INPUT_CHARACTERS,
    32_000,
    4_000,
    200_000,
    "AGENT_MAX_MODEL_INPUT_CHARACTERS",
  );
  const maxProviderRetries = readInteger(
    env.AGENT_MAX_PROVIDER_RETRIES,
    1,
    0,
    3,
    "AGENT_MAX_PROVIDER_RETRIES",
  );
  const maxQualityRewrites = readInteger(
    env.AGENT_MAX_QUALITY_REWRITES,
    1,
    0,
    2,
    "AGENT_MAX_QUALITY_REWRITES",
  );
  const providerRetryBaseDelayMs = readInteger(
    env.AGENT_PROVIDER_RETRY_BASE_DELAY_MS,
    500,
    0,
    10_000,
    "AGENT_PROVIDER_RETRY_BASE_DELAY_MS",
  );
  const providerRetryMaxDelayMs = readInteger(
    env.AGENT_PROVIDER_RETRY_MAX_DELAY_MS,
    4_000,
    0,
    30_000,
    "AGENT_PROVIDER_RETRY_MAX_DELAY_MS",
  );
  const runtimeModelSwitchEnabled = readBoolean(
    env.AGENT_RUNTIME_MODEL_SWITCH_ENABLED,
    false,
    "AGENT_RUNTIME_MODEL_SWITCH_ENABLED",
  );
  const configuredRuntimeModelSwitchMode = readRuntimeModelSwitchMode(
    env.AGENT_RUNTIME_MODEL_SWITCH_MODE,
  );
  const runtimeModelSwitchMode: RuntimeModelSwitchMode =
    runtimeModelSwitchEnabled ? configuredRuntimeModelSwitchMode : "disabled";
  const runtimeModelSelectionPath =
    env.AGENT_RUNTIME_MODEL_SELECTION_PATH?.trim() ||
    "./data/runtime-model-profile.json";
  const runtimeModelSwitchValidationTimeoutMs = readInteger(
    env.AGENT_RUNTIME_MODEL_SWITCH_VALIDATION_TIMEOUT_MS,
    10_000,
    1_000,
    60_000,
    "AGENT_RUNTIME_MODEL_SWITCH_VALIDATION_TIMEOUT_MS",
  );
  if (providerRetryMaxDelayMs < providerRetryBaseDelayMs) {
    throw new Error(
      "AGENT_PROVIDER_RETRY_MAX_DELAY_MS cannot be lower than AGENT_PROVIDER_RETRY_BASE_DELAY_MS.",
    );
  }
  const isProduction = env.NODE_ENV === "production";
  const isLoopback = host === "127.0.0.1" || host === "::1" || host === "localhost";

  if (
    runtimeModelSwitchEnabled &&
    runtimeModelSwitchMode === "local" &&
    (isProduction || !isLoopback)
  ) {
    throw new Error(
      "AGENT_RUNTIME_MODEL_SWITCH_MODE=local is restricted to a loopback development Agent.",
    );
  }

  if (runtimeModelSwitchEnabled && runtimeModelSwitchMode === "service") {
    if (env.AGENT_RUNTIME_MODEL_SWITCH_SERVICE_CONFIRM !== "private-network") {
      throw new Error(
        "AGENT_RUNTIME_MODEL_SWITCH_SERVICE_CONFIRM must be private-network in service mode.",
      );
    }
    requireSecret(env.AGENT_SHARED_SECRET, "AGENT_SHARED_SECRET");
    if (!env.LLM_PROFILES_FILE?.trim()) {
      throw new Error("LLM_PROFILES_FILE is required in runtime model service mode.");
    }
    if (
      isProduction &&
      (!isAbsolute(runtimeModelSelectionPath) ||
        runtimeModelSelectionPath === "/tmp" ||
        runtimeModelSelectionPath.startsWith("/tmp/"))
    ) {
      throw new Error(
        "AGENT_RUNTIME_MODEL_SELECTION_PATH must be an absolute persistent path outside /tmp in production service mode.",
      );
    }
  }

  if (isProduction || !isLoopback) requireSecret(env.AGENT_SHARED_SECRET, "AGENT_SHARED_SECRET");
  if (isProduction) {
    requireSecret(env.AGENT_METRICS_TOKEN, "AGENT_METRICS_TOKEN");
    if (!env.AGENT_DB_PATH?.trim() || env.AGENT_DB_PATH === ":memory:") {
      throw new Error("AGENT_DB_PATH must be persistent in production.");
    }
    if (!isAbsolute(env.AGENT_DB_PATH)) {
      throw new Error("AGENT_DB_PATH must be an absolute path in production.");
    }
    if (
      !env.LLM_API_KEY?.trim() ||
      isPlaceholder(env.LLM_API_KEY) ||
      env.LLM_PROVIDER === "mock"
    ) {
      throw new Error("A non-Mock LLM provider and LLM_API_KEY are required in production.");
    }
    if (env.AGENT_TOOLS_PROVIDER !== "echomere-backend") {
      throw new Error("AGENT_TOOLS_PROVIDER must be echomere-backend in production.");
    }
    if (env.ECHOMERE_BACKEND_TOKEN?.trim()) {
      throw new Error(
        "ECHOMERE_BACKEND_TOKEN is local-only and must not be set in production.",
      );
    }
    if (env.AGENT_CONCURRENCY_STORE !== "redis") {
      throw new Error("AGENT_CONCURRENCY_STORE must be redis in production.");
    }
    requireServiceUrl(env.REDIS_URL, "REDIS_URL");
  }

  return {
    host,
    port,
    shutdownTimeoutMs,
    maxModelInputCharacters,
    maxProviderRetries,
    maxQualityRewrites,
    providerRetryBaseDelayMs,
    providerRetryMaxDelayMs,
    runtimeModelSwitchEnabled,
    runtimeModelSwitchMode,
    runtimeModelSelectionPath,
    runtimeModelSwitchValidationTimeoutMs,
  };
}

function readRuntimeModelSwitchMode(
  value: string | undefined,
): "local" | "service" {
  const normalized = value?.trim().toLowerCase() || "local";
  if (normalized === "local" || normalized === "service") return normalized;
  throw new Error(
    "AGENT_RUNTIME_MODEL_SWITCH_MODE must be either local or service.",
  );
}

function readBoolean(
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be either true or false.`);
}

function requireServiceUrl(value: string | undefined, name: string): void {
  try {
    const url = new URL(value || "");
    if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error(`${name} must be a valid redis:// or rediss:// URL.`);
  }
}

function requireSecret(value: string | undefined, name: string): void {
  if (!value || value.trim().length < 32 || isPlaceholder(value)) {
    throw new Error(`${name} must contain at least 32 non-placeholder characters.`);
  }
}

function isPlaceholder(value: string): boolean {
  return /replace[-_ ]?with|change[-_ ]?me|your[-_ ]?(?:key|secret)/iu.test(
    value,
  );
}

function readInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}
