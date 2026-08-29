import { pathToFileURL } from "node:url";

import { validateAgentProductionPreflight } from "../config/production-preflight.ts";

function main(): void {
  const report = validateAgentProductionPreflight();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          ok: false,
          code: "production_preflight_failed",
          message:
            error instanceof Error
              ? error.message
              : "Agent production preflight failed.",
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}
