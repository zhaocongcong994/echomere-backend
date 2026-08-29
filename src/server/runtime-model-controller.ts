import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { z } from "zod";

import type { LLMRuntimeConfig } from "../config/llm-config.ts";
import {
  ModelProfileConfigError,
  type ModelProfileCatalog,
  type ModelProfileSummary,
} from "../config/model-profiles.ts";
import {
  LLMProviderError,
  type LLMProvider,
} from "../providers/llm-provider.ts";

export interface RuntimeModelSnapshot {
  provider: string;
  model: string;
  modelSelection: "legacy-env" | "profile-file";
  activeProfileId: string;
  profiles: ModelProfileSummary[];
  restartRequiredToSwitch: boolean;
  switching: {
    enabled: boolean;
    mode: "disabled" | "local" | "service";
    persistsAcrossRestart: boolean;
    validation: "provider-model-list" | "none";
  };
  maxOutputTokens: number;
  thinking: "enabled" | "disabled";
  reasoningEffort?: "low" | "high" | "max";
}

export interface RuntimeModelControl {
  currentProvider(): LLMProvider;
  snapshot(): RuntimeModelSnapshot;
  switchProfile(profileId: string): Promise<RuntimeModelSnapshot>;
}

export type RuntimeModelSwitchErrorCode =
  | "profile_switch_disabled"
  | "profile_switch_in_progress"
  | "profile_not_found"
  | "profile_not_configured"
  | "profile_validation_failed"
  | "profile_persistence_failed";

export class RuntimeModelSwitchError extends Error {
  readonly code: RuntimeModelSwitchErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(input: {
    code: RuntimeModelSwitchErrorCode;
    message: string;
    status: number;
    retryable: boolean;
    cause?: unknown;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "RuntimeModelSwitchError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable;
  }
}

export interface RuntimeModelSelectionStore {
  load(): string | undefined;
  save(profileId: string): void;
}

const selectionSchema = z.object({
  activeProfileId: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u),
});

export class FileRuntimeModelSelectionStore
  implements RuntimeModelSelectionStore
{
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  load(): string | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
    return selectionSchema.parse(JSON.parse(raw) as unknown).activeProfileId;
  }

  save(profileId: string): void {
    const payload = selectionSchema.parse({ activeProfileId: profileId });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporaryPath, this.path);
      chmodSync(this.path, 0o600);
    } catch (error) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // The temporary file may not have been created yet.
      }
      throw error;
    }
  }
}

export interface RuntimeModelControllerOptions {
  catalog: ModelProfileCatalog;
  createProvider: (config: LLMRuntimeConfig) => LLMProvider;
  enabled?: boolean;
  mode?: "local" | "service";
  selectionStore?: RuntimeModelSelectionStore;
  validateProfile?: (config: LLMRuntimeConfig) => Promise<void>;
  onPersistedSelectionError?: (error: unknown) => void;
}

export class RuntimeModelController implements RuntimeModelControl {
  private readonly options: RuntimeModelControllerOptions;
  private activeProfileId: string;
  private activeConfig: LLMRuntimeConfig;
  private provider: LLMProvider;
  private switchPending = false;

  constructor(options: RuntimeModelControllerOptions) {
    this.options = options;
    this.activeProfileId = options.catalog.activeProfileId;
    this.activeConfig = options.catalog.activeConfig;
    this.provider = options.createProvider(this.activeConfig);

    if (options.enabled && options.selectionStore) {
      try {
        const persistedProfileId = options.selectionStore.load();
        if (persistedProfileId && persistedProfileId !== this.activeProfileId) {
          const persistedConfig = options.catalog.getConfig(persistedProfileId);
          this.provider = options.createProvider(persistedConfig);
          this.activeConfig = persistedConfig;
          this.activeProfileId = persistedProfileId;
        }
      } catch (error) {
        options.onPersistedSelectionError?.(error);
      }
    }
  }

  currentProvider(): LLMProvider {
    return this.provider;
  }

  snapshot(): RuntimeModelSnapshot {
    const enabled = this.options.enabled === true;
    return {
      provider: this.provider.name,
      model: this.provider.model,
      modelSelection: this.options.catalog.source,
      activeProfileId: this.activeProfileId,
      profiles: this.options.catalog.profiles.map((profile) => ({
        ...profile,
        active: profile.id === this.activeProfileId,
      })),
      restartRequiredToSwitch: !enabled,
      switching: {
        enabled,
        mode: enabled ? (this.options.mode ?? "local") : "disabled",
        persistsAcrossRestart: enabled && Boolean(this.options.selectionStore),
        validation: this.options.validateProfile
          ? "provider-model-list"
          : "none",
      },
      maxOutputTokens: this.activeConfig.maxTokens,
      thinking: this.activeConfig.thinking ?? "disabled",
      ...(this.activeConfig.reasoningEffort
        ? { reasoningEffort: this.activeConfig.reasoningEffort }
        : {}),
    };
  }

  async switchProfile(profileId: string): Promise<RuntimeModelSnapshot> {
    if (!this.options.enabled) {
      throw new RuntimeModelSwitchError({
        code: "profile_switch_disabled",
        message: "Runtime model switching is disabled.",
        status: 403,
        retryable: false,
      });
    }
    if (profileId === this.activeProfileId) return this.snapshot();
    if (this.switchPending) {
      throw new RuntimeModelSwitchError({
        code: "profile_switch_in_progress",
        message: "Another model profile switch is already in progress.",
        status: 409,
        retryable: true,
      });
    }

    this.switchPending = true;
    try {
      return await this.performSwitch(profileId);
    } finally {
      this.switchPending = false;
    }
  }

  private async performSwitch(profileId: string): Promise<RuntimeModelSnapshot> {
    let config: LLMRuntimeConfig;
    try {
      config = this.options.catalog.getConfig(profileId);
    } catch (error) {
      if (error instanceof ModelProfileConfigError) {
        throw new RuntimeModelSwitchError({
          code: error.code,
          message:
            error.code === "profile_not_found"
              ? "The selected model profile does not exist."
              : "The selected model profile has no configured API key.",
          status: error.code === "profile_not_found" ? 404 : 409,
          retryable: false,
          cause: error,
        });
      }
      throw error;
    }

    const nextProvider = this.options.createProvider(config);
    try {
      await this.options.validateProfile?.(config);
    } catch (error) {
      throw new RuntimeModelSwitchError({
        code: "profile_validation_failed",
        message: "The selected model profile failed its provider validation.",
        status: 502,
        retryable:
          error instanceof LLMProviderError ? error.retryable : true,
        cause: error,
      });
    }

    try {
      this.options.selectionStore?.save(profileId);
    } catch (error) {
      throw new RuntimeModelSwitchError({
        code: "profile_persistence_failed",
        message: "The selected model profile could not be persisted.",
        status: 500,
        retryable: true,
        cause: error,
      });
    }

    this.provider = nextProvider;
    this.activeConfig = config;
    this.activeProfileId = profileId;
    return this.snapshot();
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
