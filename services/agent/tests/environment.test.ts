import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateAgentEnvironment } from "../src/config/environment.ts";

describe("Agent environment validation", () => {
  it("loads bounded model input and retry defaults", () => {
    const result = validateAgentEnvironment({});
    assert.equal(result.maxModelInputCharacters, 32_000);
    assert.equal(result.maxProviderRetries, 1);
    assert.equal(result.maxQualityRewrites, 1);
    assert.equal(result.providerRetryBaseDelayMs, 500);
    assert.equal(result.providerRetryMaxDelayMs, 4_000);
  });

  it("bounds automatic quality rewrites", () => {
    assert.equal(
      validateAgentEnvironment({ AGENT_MAX_QUALITY_REWRITES: "0" })
        .maxQualityRewrites,
      0,
    );
    assert.throws(
      () => validateAgentEnvironment({ AGENT_MAX_QUALITY_REWRITES: "3" }),
      /AGENT_MAX_QUALITY_REWRITES/u,
    );
  });

  it("rejects an inverted provider retry delay range", () => {
    assert.throws(
      () =>
        validateAgentEnvironment({
          AGENT_PROVIDER_RETRY_BASE_DELAY_MS: "2000",
          AGENT_PROVIDER_RETRY_MAX_DELAY_MS: "1000",
        }),
      /cannot be lower/u,
    );
  });

  it("requires a service secret when binding beyond loopback", () => {
    assert.throws(
      () => validateAgentEnvironment({ AGENT_HOST: "0.0.0.0" }),
      /AGENT_SHARED_SECRET/u,
    );
  });

  it("accepts a production configuration only with real providers", () => {
    const result = validateAgentEnvironment({
      NODE_ENV: "production",
      AGENT_HOST: "0.0.0.0",
      AGENT_DB_PATH: "/data/agent.db",
      AGENT_SHARED_SECRET: "s".repeat(32),
      AGENT_METRICS_TOKEN: "m".repeat(32),
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "k".repeat(32),
      AGENT_TOOLS_PROVIDER: "echomere-backend",
      AGENT_CONCURRENCY_STORE: "redis",
      REDIS_URL: "redis://127.0.0.1:6379",
    });
    assert.equal(result.port, 4_310);
  });

  it("defaults runtime model switching to local loopback mode", () => {
    const local = validateAgentEnvironment({
      AGENT_HOST: "127.0.0.1",
      AGENT_RUNTIME_MODEL_SWITCH_ENABLED: "true",
    });
    assert.equal(local.runtimeModelSwitchEnabled, true);
    assert.equal(local.runtimeModelSwitchMode, "local");
    assert.equal(
      local.runtimeModelSelectionPath,
      "./data/runtime-model-profile.json",
    );

    assert.throws(
      () =>
        validateAgentEnvironment({
          AGENT_HOST: "0.0.0.0",
          AGENT_RUNTIME_MODEL_SWITCH_ENABLED: "true",
          AGENT_SHARED_SECRET: "s".repeat(32),
        }),
      /MODE=local is restricted/u,
    );
  });

  it("requires an explicit private-network confirmation for service mode", () => {
    assert.throws(
      () =>
        validateAgentEnvironment({
          AGENT_HOST: "0.0.0.0",
          AGENT_RUNTIME_MODEL_SWITCH_ENABLED: "true",
          AGENT_RUNTIME_MODEL_SWITCH_MODE: "service",
          AGENT_SHARED_SECRET: "s".repeat(32),
          LLM_PROFILES_FILE: "/data/model-profiles.json",
        }),
      /SERVICE_CONFIRM/u,
    );
  });

  it("accepts production runtime switching only in confirmed service mode", () => {
    const result = validateAgentEnvironment({
      NODE_ENV: "production",
      AGENT_HOST: "0.0.0.0",
      AGENT_DB_PATH: "/data/agent.db",
      AGENT_SHARED_SECRET: "s".repeat(32),
      AGENT_METRICS_TOKEN: "m".repeat(32),
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "k".repeat(32),
      LLM_PROFILES_FILE: "/data/model-profiles.json",
      AGENT_TOOLS_PROVIDER: "echomere-backend",
      AGENT_CONCURRENCY_STORE: "redis",
      REDIS_URL: "redis://127.0.0.1:6379",
      AGENT_RUNTIME_MODEL_SWITCH_ENABLED: "true",
      AGENT_RUNTIME_MODEL_SWITCH_MODE: "service",
      AGENT_RUNTIME_MODEL_SWITCH_SERVICE_CONFIRM: "private-network",
      AGENT_RUNTIME_MODEL_SELECTION_PATH: "/data/runtime-model-profile.json",
    });
    assert.equal(result.runtimeModelSwitchEnabled, true);
    assert.equal(result.runtimeModelSwitchMode, "service");
  });

  it("rejects temporary production model-selection storage", () => {
    assert.throws(
      () =>
        validateAgentEnvironment({
          NODE_ENV: "production",
          AGENT_HOST: "0.0.0.0",
          AGENT_DB_PATH: "/data/agent.db",
          AGENT_SHARED_SECRET: "s".repeat(32),
          AGENT_METRICS_TOKEN: "m".repeat(32),
          LLM_PROVIDER: "deepseek",
          LLM_API_KEY: "k".repeat(32),
          LLM_PROFILES_FILE: "/data/model-profiles.json",
          AGENT_TOOLS_PROVIDER: "echomere-backend",
          AGENT_CONCURRENCY_STORE: "redis",
          REDIS_URL: "redis://127.0.0.1:6379",
          AGENT_RUNTIME_MODEL_SWITCH_ENABLED: "true",
          AGENT_RUNTIME_MODEL_SWITCH_MODE: "service",
          AGENT_RUNTIME_MODEL_SWITCH_SERVICE_CONFIRM: "private-network",
          AGENT_RUNTIME_MODEL_SELECTION_PATH: "/tmp/model-profile.json",
        }),
      /persistent path/u,
    );
  });

  it("rejects relative production databases and local fallback tokens", () => {
    const base = {
      NODE_ENV: "production",
      AGENT_SHARED_SECRET: "s".repeat(32),
      AGENT_METRICS_TOKEN: "m".repeat(32),
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "k".repeat(32),
      AGENT_TOOLS_PROVIDER: "echomere-backend",
      AGENT_CONCURRENCY_STORE: "redis",
      REDIS_URL: "redis://127.0.0.1:6379",
    };
    assert.throws(
      () => validateAgentEnvironment({ ...base, AGENT_DB_PATH: "./agent.db" }),
      /absolute path/u,
    );
    assert.throws(
      () =>
        validateAgentEnvironment({
          ...base,
          AGENT_DB_PATH: "/data/agent.db",
          ECHOMERE_BACKEND_TOKEN: "static-production-token",
        }),
      /local-only/u,
    );
  });

  it("rejects placeholder model credentials in production", () => {
    assert.throws(
      () =>
        validateAgentEnvironment({
          NODE_ENV: "production",
          AGENT_DB_PATH: "/data/agent.db",
          AGENT_SHARED_SECRET: "s".repeat(32),
          AGENT_METRICS_TOKEN: "m".repeat(32),
          LLM_PROVIDER: "deepseek",
          LLM_API_KEY: "replace-with-a-rotated-provider-key",
          AGENT_TOOLS_PROVIDER: "echomere-backend",
          AGENT_CONCURRENCY_STORE: "redis",
          REDIS_URL: "redis://127.0.0.1:6379",
        }),
      /LLM_API_KEY/u,
    );
  });

  it("rejects production Mock mode", () => {
    assert.throws(
      () =>
        validateAgentEnvironment({
          NODE_ENV: "production",
          AGENT_DB_PATH: "/data/agent.db",
          AGENT_SHARED_SECRET: "s".repeat(32),
          AGENT_METRICS_TOKEN: "m".repeat(32),
          LLM_PROVIDER: "mock",
          LLM_API_KEY: "k".repeat(32),
          AGENT_TOOLS_PROVIDER: "echomere-backend",
        }),
      /non-Mock/u,
    );
  });

  it("requires Redis concurrency in production", () => {
    assert.throws(
      () =>
        validateAgentEnvironment({
          NODE_ENV: "production",
          AGENT_DB_PATH: "/data/agent.db",
          AGENT_SHARED_SECRET: "s".repeat(32),
          AGENT_METRICS_TOKEN: "m".repeat(32),
          LLM_PROVIDER: "deepseek",
          LLM_API_KEY: "k".repeat(32),
          AGENT_TOOLS_PROVIDER: "echomere-backend",
          AGENT_CONCURRENCY_STORE: "memory",
        }),
      /AGENT_CONCURRENCY_STORE/u,
    );
  });
});
