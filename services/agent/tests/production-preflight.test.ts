import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateAgentProductionPreflight } from "../src/config/production-preflight.ts";

const profiles = JSON.stringify({
  defaultProfile: "primary",
  profiles: [
    {
      id: "primary",
      label: "Primary",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKeyEnv: "LLM_API_KEY",
    },
    {
      id: "unconfigured",
      label: "Unconfigured",
      provider: "openai-compatible",
      baseUrl: "https://provider.example.com/v1",
      model: "secondary",
      apiKeyEnv: "SECONDARY_LLM_API_KEY",
    },
  ],
});

function productionEnvironment(): Record<string, string> {
  return {
    NODE_ENV: "production",
    AGENT_HOST: "0.0.0.0",
    AGENT_DB_PATH: "/data/agent.db",
    AGENT_SHARED_SECRET: "s".repeat(32),
    AGENT_METRICS_TOKEN: "m".repeat(32),
    AGENT_TOOLS_PROVIDER: "echomere-backend",
    AGENT_CONCURRENCY_STORE: "redis",
    REDIS_URL: "redis://redis:6379",
    LLM_API_KEY: "k".repeat(32),
    LLM_PROFILES_FILE: "/run/echomere/model-profiles.json",
    LLM_ACTIVE_PROFILE: "primary",
    AGENT_RUNTIME_MODEL_SWITCH_ENABLED: "true",
    AGENT_RUNTIME_MODEL_SWITCH_MODE: "service",
    AGENT_RUNTIME_MODEL_SWITCH_SERVICE_CONFIRM: "private-network",
    AGENT_RUNTIME_MODEL_SELECTION_PATH: "/data/runtime-model-profile.json",
  };
}

describe("Agent production preflight", () => {
  it("returns a credential-free production summary", () => {
    const report = validateAgentProductionPreflight(productionEnvironment(), {
      readFile: () => profiles,
    });
    assert.equal(report.ok, true);
    assert.equal(report.modelProfiles.configured, 1);
    assert.equal(report.runtimeModelSwitchMode, "service");
    assert.deepEqual(report.quality, {
      maxRewrites: 1,
      buffersDraftUntilValidated: true,
    });
    assert.equal(report.concurrencyStore, "redis");
    assert.equal(JSON.stringify(report).includes("k".repeat(32)), false);
  });

  it("rejects a non-production invocation", () => {
    assert.throws(
      () => validateAgentProductionPreflight({ NODE_ENV: "development" }),
      /NODE_ENV must be production/u,
    );
  });

  it("rejects overlapping database and runtime-selection files", () => {
    const env = productionEnvironment();
    env.AGENT_RUNTIME_MODEL_SELECTION_PATH = env.AGENT_DB_PATH!;
    assert.throws(
      () =>
        validateAgentProductionPreflight(env, { readFile: () => profiles }),
      /must be different files/u,
    );
  });
});
