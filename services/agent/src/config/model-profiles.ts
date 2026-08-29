import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import {
  loadLLMConfig,
  type LLMProviderKind,
  type LLMRuntimeConfig,
} from "./llm-config.ts";

type Environment = Record<string, string | undefined>;

export interface ModelProfileSummary {
  id: string;
  label: string;
  provider: LLMProviderKind;
  model: string;
  configured: boolean;
  active: boolean;
}

export interface ModelProfileCatalog {
  source: "legacy-env" | "profile-file";
  activeProfileId: string;
  activeConfig: LLMRuntimeConfig;
  profiles: ModelProfileSummary[];
  getConfig(profileId: string): LLMRuntimeConfig;
}

export type ModelProfileConfigErrorCode =
  | "profile_not_found"
  | "profile_not_configured";

export class ModelProfileConfigError extends Error {
  readonly code: ModelProfileConfigErrorCode;
  readonly profileId: string;

  constructor(
    code: ModelProfileConfigErrorCode,
    profileId: string,
    message: string,
  ) {
    super(message);
    this.name = "ModelProfileConfigError";
    this.code = code;
    this.profileId = profileId;
  }
}

const profileSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u),
  label: z.string().trim().min(1).max(80),
  provider: z.enum(["deepseek", "openai-compatible"]),
  baseUrl: z.string().trim().url(),
  model: z.string().trim().min(1).max(160),
  apiKeyEnv: z
    .string()
    .trim()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u),
  timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
  maxTokens: z.number().int().min(1).max(131_072).optional(),
  thinking: z.enum(["enabled", "disabled"]).optional(),
  reasoningEffort: z.enum(["low", "high", "max"]).optional(),
});

const catalogSchema = z.object({
  defaultProfile: z.string().trim().optional(),
  profiles: z.array(profileSchema).min(1).max(32),
});

export function loadModelProfileCatalog(
  environment: Environment = process.env,
  options: {
    cwd?: string;
    readFile?: (path: string) => string;
  } = {},
): ModelProfileCatalog {
  const configuredPath = environment.LLM_PROFILES_FILE?.trim();
  if (!configuredPath) return legacyCatalog(environment);

  const absolutePath = resolve(options.cwd ?? process.cwd(), configuredPath);
  let raw: string;
  try {
    raw = (options.readFile ?? ((path) => readFileSync(path, "utf8")))(
      absolutePath,
    );
  } catch (error) {
    throw new Error(`Unable to read LLM profile file: ${absolutePath}`, {
      cause: error,
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error("LLM profile file must contain valid JSON.", { cause: error });
  }
  const parsed = catalogSchema.parse(json);
  const ids = new Set<string>();
  for (const profile of parsed.profiles) {
    if (ids.has(profile.id)) {
      throw new Error(`Duplicate LLM profile id: ${profile.id}`);
    }
    ids.add(profile.id);
  }

  const activeProfileId =
    environment.LLM_ACTIVE_PROFILE?.trim() ||
    parsed.defaultProfile ||
    parsed.profiles[0]?.id;
  if (!activeProfileId) {
    throw new Error(
      `LLM_ACTIVE_PROFILE does not match a configured profile: ${activeProfileId ?? ""}`,
    );
  }

  const profiles = parsed.profiles.map((profile) => ({
    id: profile.id,
    label: profile.label,
    provider: profile.provider,
    model: profile.model,
    configured: Boolean(environment[profile.apiKeyEnv]?.trim()),
    active: profile.id === activeProfileId,
  }));
  const getConfig = (profileId: string): LLMRuntimeConfig => {
    const profile = parsed.profiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      throw new ModelProfileConfigError(
        "profile_not_found",
        profileId,
        `Unknown LLM profile: ${profileId}`,
      );
    }
    const apiKey = environment[profile.apiKeyEnv]?.trim();
    if (!apiKey) {
      throw new ModelProfileConfigError(
        "profile_not_configured",
        profileId,
        `The LLM profile '${profile.id}' requires ${profile.apiKeyEnv}.`,
      );
    }

    return {
      provider: profile.provider,
      apiKey,
      baseUrl: profile.baseUrl,
      model: profile.model,
      timeoutMs: profile.timeoutMs ?? 60_000,
      maxTokens: profile.maxTokens ?? 2_048,
      thinking: profile.thinking ?? "disabled",
      ...(profile.reasoningEffort
        ? { reasoningEffort: profile.reasoningEffort }
        : {}),
    };
  };

  let activeConfig: LLMRuntimeConfig;
  try {
    activeConfig = getConfig(activeProfileId);
  } catch (error) {
    if (
      error instanceof ModelProfileConfigError &&
      error.code === "profile_not_found"
    ) {
      throw new Error(
        `LLM_ACTIVE_PROFILE does not match a configured profile: ${activeProfileId}`,
        { cause: error },
      );
    }
    throw error;
  }

  return {
    source: "profile-file",
    activeProfileId,
    activeConfig,
    profiles,
    getConfig,
  };
}

function legacyCatalog(environment: Environment): ModelProfileCatalog {
  const activeConfig = loadLLMConfig(environment as NodeJS.ProcessEnv);
  return {
    source: "legacy-env",
    activeProfileId: "default",
    activeConfig,
    profiles: [
      {
        id: "default",
        label: `${activeConfig.provider} / ${activeConfig.model}`,
        provider: activeConfig.provider,
        model: activeConfig.model,
        configured: activeConfig.provider === "mock" || Boolean(activeConfig.apiKey),
        active: true,
      },
    ],
    getConfig(profileId: string): LLMRuntimeConfig {
      if (profileId !== "default") {
        throw new ModelProfileConfigError(
          "profile_not_found",
          profileId,
          `Unknown LLM profile: ${profileId}`,
        );
      }
      return activeConfig;
    },
  };
}
