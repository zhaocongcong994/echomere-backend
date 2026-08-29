import { resolve } from "node:path";

import { loadBackendConfig } from "./backend-config.ts";
import { validateAgentEnvironment } from "./environment.ts";
import { loadModelProfileCatalog } from "./model-profiles.ts";

type Environment = Record<string, string | undefined>;

export interface AgentProductionPreflightReport {
  ok: true;
  nodeEnv: "production";
  listen: { host: string; port: number };
  storage: {
    databasePath: string;
    runtimeModelSelectionPath: string;
  };
  modelProfiles: {
    source: "legacy-env" | "profile-file";
    activeProfileId: string;
    configured: number;
    total: number;
  };
  runtimeModelSwitchMode: "disabled" | "local" | "service";
  quality: {
    maxRewrites: number;
    buffersDraftUntilValidated: true;
  };
  concurrencyStore: "redis";
  toolsProvider: "echomere-backend";
}

export function validateAgentProductionPreflight(
  env: Environment = process.env,
  options: {
    cwd?: string;
    readFile?: (path: string) => string;
  } = {},
): AgentProductionPreflightReport {
  if (env.NODE_ENV !== "production") {
    throw new Error("NODE_ENV must be production for the production preflight.");
  }

  const environment = validateAgentEnvironment(env);
  const catalog = loadModelProfileCatalog(env, options);
  const backend = loadBackendConfig(env as NodeJS.ProcessEnv);
  const configuredProfiles = catalog.profiles.filter(
    (profile) => profile.configured,
  ).length;

  if (configuredProfiles === 0) {
    throw new Error("At least one configured model profile is required.");
  }
  if (backend.toolsProvider !== "echomere-backend") {
    throw new Error("Production Agent tools must use echomere-backend.");
  }

  const databasePath = resolve(env.AGENT_DB_PATH!);
  const runtimeModelSelectionPath = resolve(
    environment.runtimeModelSelectionPath,
  );
  if (
    environment.runtimeModelSwitchEnabled &&
    databasePath === runtimeModelSelectionPath
  ) {
    throw new Error(
      "AGENT_DB_PATH and AGENT_RUNTIME_MODEL_SELECTION_PATH must be different files.",
    );
  }

  return {
    ok: true,
    nodeEnv: "production",
    listen: { host: environment.host, port: environment.port },
    storage: { databasePath, runtimeModelSelectionPath },
    modelProfiles: {
      source: catalog.source,
      activeProfileId: catalog.activeProfileId,
      configured: configuredProfiles,
      total: catalog.profiles.length,
    },
    runtimeModelSwitchMode: environment.runtimeModelSwitchMode,
    quality: {
      maxRewrites: environment.maxQualityRewrites,
      buffersDraftUntilValidated: true,
    },
    concurrencyStore: "redis",
    toolsProvider: "echomere-backend",
  };
}
