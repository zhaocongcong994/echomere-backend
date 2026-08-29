import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadLLMConfig } from "../src/config/llm-config.ts";
import { loadModelProfileCatalog } from "../src/config/model-profiles.ts";
import { MockLLMProvider } from "../src/providers/mock-provider.ts";
import { OpenAICompatibleLLMProvider } from "../src/providers/openai-compatible-provider.ts";
import { createLLMProvider } from "../src/providers/provider-factory.ts";

describe("LLM configuration", () => {
  it("falls back to Mock when no API key is configured", () => {
    const config = loadLLMConfig({
      LLM_PROVIDER: "deepseek",
      LLM_BASE_URL: "https://api.deepseek.com",
      LLM_MODEL: "deepseek-v4-flash",
    });

    assert.equal(config.provider, "mock");
    assert.ok(createLLMProvider(config) instanceof MockLLMProvider);
  });

  it("creates the DeepSeek OpenAI-compatible provider from environment settings", () => {
    const config = loadLLMConfig({
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "test-key-that-is-not-a-real-secret",
      LLM_BASE_URL: "https://api.deepseek.com",
      LLM_MODEL: "deepseek-v4-flash",
      LLM_TIMEOUT_MS: "30000",
      LLM_MAX_TOKENS: "1024",
      LLM_THINKING: "disabled",
      LLM_REASONING_EFFORT: "high",
    });
    const provider = createLLMProvider(config);

    assert.ok(provider instanceof OpenAICompatibleLLMProvider);
    assert.equal(provider.name, "deepseek");
    assert.equal(provider.model, "deepseek-v4-flash");
    assert.equal(config.reasoningEffort, "high");
  });

  it("loads a named active model profile without exposing credentials in summaries", () => {
    const file = JSON.stringify({
      defaultProfile: "deepseek-fast",
      profiles: [
        {
          id: "deepseek-fast",
          label: "DeepSeek Fast",
          provider: "deepseek",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-flash",
          apiKeyEnv: "DEEPSEEK_PROFILE_KEY",
          maxTokens: 1024,
        },
        {
          id: "secondary",
          label: "Secondary",
          provider: "openai-compatible",
          baseUrl: "https://provider.example.com/v1",
          model: "secondary-model",
          apiKeyEnv: "SECONDARY_PROFILE_KEY",
        },
      ],
    });
    const catalog = loadModelProfileCatalog(
      {
        LLM_PROFILES_FILE: "model-profiles.local.json",
        LLM_ACTIVE_PROFILE: "secondary",
        DEEPSEEK_PROFILE_KEY: "deepseek-test-secret",
        SECONDARY_PROFILE_KEY: "secondary-test-secret",
      },
      { readFile: () => file },
    );

    assert.equal(catalog.source, "profile-file");
    assert.equal(catalog.activeProfileId, "secondary");
    assert.equal(catalog.activeConfig.provider, "openai-compatible");
    assert.equal(catalog.activeConfig.model, "secondary-model");
    assert.equal(catalog.activeConfig.apiKey, "secondary-test-secret");
    assert.equal(catalog.profiles.every((profile) => profile.configured), true);
    assert.equal(JSON.stringify(catalog.profiles).includes("test-secret"), false);
  });

  it("fails closed when the selected model profile has no credential", () => {
    const file = JSON.stringify({
      profiles: [
        {
          id: "missing-key",
          label: "Missing Key",
          provider: "deepseek",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-flash",
          apiKeyEnv: "MISSING_PROFILE_KEY",
        },
      ],
    });

    assert.throws(
      () =>
        loadModelProfileCatalog(
          { LLM_PROFILES_FILE: "model-profiles.local.json" },
          { readFile: () => file },
        ),
      /requires MISSING_PROFILE_KEY/u,
    );
  });
});
