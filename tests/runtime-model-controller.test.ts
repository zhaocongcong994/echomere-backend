import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { LLMRuntimeConfig } from "../src/config/llm-config.ts";
import { loadModelProfileCatalog } from "../src/config/model-profiles.ts";
import type {
  LLMChunk,
  LLMProvider,
  LLMRequest,
} from "../src/providers/llm-provider.ts";
import {
  FileRuntimeModelSelectionStore,
  RuntimeModelController,
  RuntimeModelSwitchError,
} from "../src/server/runtime-model-controller.ts";

describe("RuntimeModelController", () => {
  it("validates and persists before atomically activating a profile", async () => {
    const saved: string[] = [];
    const validated: string[] = [];
    const controller = new RuntimeModelController({
      catalog: createCatalog(),
      createProvider: fakeProvider,
      enabled: true,
      selectionStore: {
        load: () => undefined,
        save: (profileId) => saved.push(profileId),
      },
      validateProfile: async (config) => {
        validated.push(config.model);
      },
    });
    const providerForExistingRun = controller.currentProvider();

    const runtime = await controller.switchProfile("deepseek-reasoner");

    assert.equal(providerForExistingRun.model, "deepseek-v4-flash");
    assert.equal(controller.currentProvider().model, "deepseek-reasoner");
    assert.equal(runtime.activeProfileId, "deepseek-reasoner");
    assert.equal(runtime.profiles.filter((profile) => profile.active).length, 1);
    assert.deepEqual(validated, ["deepseek-reasoner"]);
    assert.deepEqual(saved, ["deepseek-reasoner"]);
    assert.equal(runtime.restartRequiredToSwitch, false);
    assert.equal(runtime.switching.persistsAcrossRestart, true);
  });

  it("keeps the current provider when validation fails", async () => {
    const controller = new RuntimeModelController({
      catalog: createCatalog(),
      createProvider: fakeProvider,
      enabled: true,
      validateProfile: async () => {
        throw new Error("provider unavailable");
      },
    });

    await assert.rejects(
      () => controller.switchProfile("deepseek-reasoner"),
      (error: unknown) =>
        error instanceof RuntimeModelSwitchError &&
        error.code === "profile_validation_failed",
    );
    assert.equal(controller.currentProvider().model, "deepseek-v4-flash");
    assert.equal(controller.snapshot().activeProfileId, "deepseek-flash");
  });

  it("does not disclose the missing credential variable for an unconfigured profile", async () => {
    const controller = new RuntimeModelController({
      catalog: createCatalog(false),
      createProvider: fakeProvider,
      enabled: true,
    });

    await assert.rejects(
      () => controller.switchProfile("deepseek-reasoner"),
      (error: unknown) =>
        error instanceof RuntimeModelSwitchError &&
        error.code === "profile_not_configured" &&
        !error.message.includes("SECONDARY_PROFILE_KEY"),
    );
  });

  it("restores a persisted selection without storing credentials", () => {
    const directory = mkdtempSync(join(tmpdir(), "echomere-model-selection-"));
    try {
      const path = join(directory, "active.json");
      const store = new FileRuntimeModelSelectionStore(path);
      store.save("deepseek-reasoner");
      const controller = new RuntimeModelController({
        catalog: createCatalog(),
        createProvider: fakeProvider,
        enabled: true,
        selectionStore: store,
      });

      assert.equal(controller.snapshot().activeProfileId, "deepseek-reasoner");
      assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
        activeProfileId: "deepseek-reasoner",
      });
      assert.equal(statSync(path).mode & 0o777, 0o600);
      assert.equal(readFileSync(path, "utf8").includes("test-key"), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when runtime switching is disabled", async () => {
    const controller = new RuntimeModelController({
      catalog: createCatalog(),
      createProvider: fakeProvider,
    });
    await assert.rejects(
      () => controller.switchProfile("deepseek-reasoner"),
      (error: unknown) =>
        error instanceof RuntimeModelSwitchError &&
        error.code === "profile_switch_disabled",
    );
    assert.equal(controller.snapshot().restartRequiredToSwitch, true);
  });
});

function createCatalog(secondaryConfigured = true) {
  return loadModelProfileCatalog(
    {
      LLM_PROFILES_FILE: "profiles.json",
      LLM_ACTIVE_PROFILE: "deepseek-flash",
      PRIMARY_PROFILE_KEY: "primary-test-key",
      ...(secondaryConfigured
        ? { SECONDARY_PROFILE_KEY: "secondary-test-key" }
        : {}),
    },
    {
      readFile: () =>
        JSON.stringify({
          profiles: [
            {
              id: "deepseek-flash",
              label: "DeepSeek Flash",
              provider: "deepseek",
              baseUrl: "https://api.deepseek.com",
              model: "deepseek-v4-flash",
              apiKeyEnv: "PRIMARY_PROFILE_KEY",
            },
            {
              id: "deepseek-reasoner",
              label: "DeepSeek Reasoner",
              provider: "deepseek",
              baseUrl: "https://api.deepseek.com",
              model: "deepseek-reasoner",
              apiKeyEnv: "SECONDARY_PROFILE_KEY",
            },
          ],
        }),
    },
  );
}

function fakeProvider(config: LLMRuntimeConfig): LLMProvider {
  return {
    name: config.provider,
    model: config.model,
    async *stream(
      _request: LLMRequest,
      _options?: { signal?: AbortSignal },
    ): AsyncIterable<LLMChunk> {
      yield { type: "completed", finishReason: "stop" };
    },
  };
}
