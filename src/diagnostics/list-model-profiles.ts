import { pathToFileURL } from "node:url";

import { loadLocalEnv } from "../config/load-local-env.ts";
import { loadModelProfileCatalog } from "../config/model-profiles.ts";

function main(): void {
  loadLocalEnv();
  const catalog = loadModelProfileCatalog();
  process.stdout.write(
    `${JSON.stringify(
      {
        source: catalog.source,
        activeProfileId: catalog.activeProfileId,
        profiles: catalog.profiles,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Unable to list model profiles."}\n`,
    );
    process.exitCode = 1;
  }
}
