import { resolve } from "node:path";

import { loadBackendConfig } from "../config/backend-config.ts";
import { validateAgentEnvironment } from "../config/environment.ts";
import { loadLocalEnv } from "../config/load-local-env.ts";
import { loadModelProfileCatalog } from "../config/model-profiles.ts";
import { EchomereBackendClient } from "../backend/backend-client.ts";
import { diagnoseLLMProvider } from "../providers/provider-diagnostics.ts";
import { createLLMProvider } from "../providers/provider-factory.ts";
import { createJsonLogger, serializeError } from "../observability/logger.ts";
import { AgentMetrics } from "../observability/metrics.ts";
import { SqliteAgentStore } from "../repositories/sqlite-agent-store.ts";
import { createAgentTools } from "../tools/tool-factory.ts";
import { createAgentServer } from "./app.ts";
import { createRunConcurrencyLimiterFromEnv } from "./run-concurrency.ts";
import {
  FileRuntimeModelSelectionStore,
  RuntimeModelController,
} from "./runtime-model-controller.ts";

loadLocalEnv();

const environment = validateAgentEnvironment();
const databasePath = resolve(process.env.AGENT_DB_PATH?.trim() || "./data/agent.db");
const sharedSecret = process.env.AGENT_SHARED_SECRET?.trim();
const metricsToken = process.env.AGENT_METRICS_TOKEN?.trim();
const logger = createJsonLogger();
const metrics = new AgentMetrics();
const modelCatalog = loadModelProfileCatalog();
const runtimeModels = new RuntimeModelController({
  catalog: modelCatalog,
  createProvider: createLLMProvider,
  enabled: environment.runtimeModelSwitchEnabled,
  ...(environment.runtimeModelSwitchEnabled
    ? {
        mode:
          environment.runtimeModelSwitchMode === "service"
            ? "service"
            : "local",
      }
    : {}),
  ...(environment.runtimeModelSwitchEnabled
    ? {
        selectionStore: new FileRuntimeModelSelectionStore(
          resolve(environment.runtimeModelSelectionPath),
        ),
        validateProfile: async (config) => {
          await diagnoseLLMProvider(config, {
            timeoutMs: environment.runtimeModelSwitchValidationTimeoutMs,
          });
        },
        onPersistedSelectionError: (error: unknown) => {
          logger.warn("runtime_model_selection_ignored", serializeError(error));
        },
      }
    : {}),
});
const provider = runtimeModels.currentProvider();
const backendConfig = loadBackendConfig();
const store = new SqliteAgentStore(databasePath);
const runLimiter = createRunConcurrencyLimiterFromEnv(process.env, (error) => {
  logger.error("agent_concurrency_redis_error", serializeError(error));
});
const backendClient =
  backendConfig.toolsProvider === "echomere-backend"
    ? new EchomereBackendClient({
        baseUrl: backendConfig.baseUrl,
        timeoutMs: backendConfig.timeoutMs,
      })
    : undefined;
const tools = createAgentTools(backendConfig, {
  ...(backendClient ? { backendClient } : {}),
  hexagrams: store,
  mockUserId: "local-user",
});
const server = createAgentServer({
  provider,
  runtimeModels,
  tools,
  runs: store,
  conversations: store,
  ...(backendClient ? { conversationHistory: backendClient } : {}),
  toolRuns: store,
  runLimiter,
  readinessCheck: async () => {
    await Promise.all([store.healthCheck(), runLimiter.healthCheck()]);
  },
  logger,
  metrics,
  runtimePolicy: {
    maxModelInputCharacters: environment.maxModelInputCharacters,
    maxProviderRetries: environment.maxProviderRetries,
    maxQualityRewrites: environment.maxQualityRewrites,
    providerRetryBaseDelayMs: environment.providerRetryBaseDelayMs,
    providerRetryMaxDelayMs: environment.providerRetryMaxDelayMs,
  },
  ...(metricsToken ? { metricsToken } : {}),
  ...(backendConfig.localAccessToken
    ? { defaultAccessToken: backendConfig.localAccessToken }
    : {}),
  ...(sharedSecret ? { sharedSecret } : {}),
});

server.once("error", (error: NodeJS.ErrnoException) => {
  logger.error("server_start_failed", {
    errorCode: error.code,
    errorMessage:
      error.code === "EADDRINUSE"
        ? `Port ${environment.port} is already in use. Set AGENT_PORT to another local port.`
        : error.message,
  });
  void runLimiter.close();
  store.close();
  process.exitCode = 1;
});

server.listen(environment.port, environment.host, () => {
  logger.info("server_started", {
    host: environment.host,
    port: environment.port,
    provider: runtimeModels.currentProvider().name,
    model: runtimeModels.currentProvider().model,
    runtimeModelSwitchEnabled: environment.runtimeModelSwitchEnabled,
    runtimeModelSwitchMode: environment.runtimeModelSwitchMode,
    toolsProvider: backendConfig.toolsProvider,
    concurrencyStore: runLimiter.store,
  });
});

let shutdownStarted = false;
const shutdown = (signal: NodeJS.Signals): void => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  logger.info("server_shutdown_started", { signal });
  const forceTimer = setTimeout(() => {
    logger.error("server_shutdown_forced", {
      timeoutMs: environment.shutdownTimeoutMs,
    });
    server.closeAllConnections();
    process.exitCode = 1;
  }, environment.shutdownTimeoutMs);
  forceTimer.unref();
  server.closeIdleConnections();
  server.close(async (error) => {
    clearTimeout(forceTimer);
    const results = await Promise.allSettled([runLimiter.close()]);
    store.close();
    const cleanupFailed = results.some((result) => result.status === "rejected");
    if (error || cleanupFailed) {
      logger.error("server_shutdown_failed", {
        ...(error ? serializeError(error) : {}),
        cleanupFailed,
      });
      process.exitCode = 1;
      return;
    }
    logger.info("server_shutdown_completed");
  });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
