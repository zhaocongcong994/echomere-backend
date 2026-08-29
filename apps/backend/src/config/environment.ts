import { parseRuntimeModelAdminEmails } from "../lib/runtime-model-access.js";

export interface BackendEnvironment {
  port: number;
  shutdownTimeoutMs: number;
  runtimeModelControlEnabled: boolean;
  runtimeModelAdminEmails: string[];
  warnings: string[];
}

type Environment = Record<string, string | undefined>;

export function validateBackendEnvironment(
  env: Environment = process.env,
): BackendEnvironment {
  const port = readInteger(env.PORT, 3_001, 1, 65_535, "PORT");
  const shutdownTimeoutMs = readInteger(
    env.SHUTDOWN_TIMEOUT_MS,
    15_000,
    1_000,
    120_000,
    "SHUTDOWN_TIMEOUT_MS",
  );
  const runtimeModelControlEnabled = readBoolean(
    env.AGENT_RUNTIME_MODEL_CONTROL_ENABLED,
    false,
    "AGENT_RUNTIME_MODEL_CONTROL_ENABLED",
  );
  const runtimeModelAdminEmails = parseRuntimeModelAdminEmails(
    env.AGENT_RUNTIME_MODEL_ADMIN_EMAILS,
  );
  requireUrl(env.AGENT_SERVICE_URL || "http://127.0.0.1:4310", "AGENT_SERVICE_URL");

  const store = env.CHAT_RATE_LIMIT_STORE?.trim().toLowerCase() || "memory";
  if (store !== "memory" && store !== "redis") {
    throw new Error("CHAT_RATE_LIMIT_STORE must be either memory or redis.");
  }
  if (store === "redis") requireUrl(env.REDIS_URL || "", "REDIS_URL");

  const warnings: string[] = [];
  if (env.NODE_ENV === "production") {
    if (runtimeModelControlEnabled && runtimeModelAdminEmails.length === 0) {
      throw new Error(
        "AGENT_RUNTIME_MODEL_ADMIN_EMAILS must contain at least one administrator when runtime model control is enabled in production.",
      );
    }
    requireSecret(env.JWT_SECRET, "JWT_SECRET");
    requireSecret(env.AGENT_SHARED_SECRET, "AGENT_SHARED_SECRET");
    requireSecret(env.METRICS_TOKEN, "METRICS_TOKEN");
    if (!env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required in production.");
    const origins = env.CORS_ORIGINS?.trim();
    if (!origins || origins.includes("*")) {
      throw new Error("CORS_ORIGINS must list explicit origins in production.");
    }
    if (store === "memory") {
      warnings.push(
        "CHAT_RATE_LIMIT_STORE=memory is only safe for a single Backend instance.",
      );
    }
  }

  return {
    port,
    shutdownTimeoutMs,
    runtimeModelControlEnabled,
    runtimeModelAdminEmails,
    warnings,
  };
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

function requireSecret(value: string | undefined, name: string): void {
  if (!value || value.trim().length < 32 || value.includes("replace-with")) {
    throw new Error(`${name} must contain at least 32 non-placeholder characters.`);
  }
}

function requireUrl(value: string, name: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "redis:" && url.protocol !== "rediss:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error(`${name} must be a valid service URL.`);
  }
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
