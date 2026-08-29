import { pathToFileURL } from "node:url";

import { loadLocalEnv } from "../config/load-local-env.ts";
import { loadModelProfileCatalog } from "../config/model-profiles.ts";
import { LLMProviderError } from "../providers/llm-provider.ts";
import { diagnoseLLMProvider } from "../providers/provider-diagnostics.ts";

async function main(): Promise<void> {
  loadLocalEnv();
  const result = await diagnoseLLMProvider(
    loadModelProfileCatalog().activeConfig,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const payload =
      error instanceof LLMProviderError
        ? {
            ok: false,
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            ...(error.status === undefined ? {} : { status: error.status }),
          }
        : {
            ok: false,
            code: "provider_diagnostic_failed",
            message:
              error instanceof Error
                ? error.message
                : "The model provider diagnostic failed.",
            retryable: false,
          };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = 1;
  });
}
