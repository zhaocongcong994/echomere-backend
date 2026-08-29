import { randomUUID } from "node:crypto";

import { runAgent } from "./agent/run-agent.ts";
import { AGENT_MODES, type AgentMode } from "./agent/types.ts";
import { loadBackendConfig } from "./config/backend-config.ts";
import { loadLocalEnv } from "./config/load-local-env.ts";
import { loadModelProfileCatalog } from "./config/model-profiles.ts";
import { createLLMProvider } from "./providers/provider-factory.ts";
import { MemoryAgentRunRepository } from "./repositories/memory-repository.ts";
import { createAgentTools } from "./tools/tool-factory.ts";

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

loadLocalEnv();

function isAgentMode(value: string): value is AgentMode {
  return AGENT_MODES.some((mode) => mode === value);
}

if (process.argv.includes("--help")) {
  console.log(
    [
      "npm run agent -- --mode <kanyun|wenshi|qingting|suiyuan> --message <text>",
      "可选：--conversation <id> --profile <id> --without-profile",
    ].join("\n"),
  );
  process.exit(0);
}

const rawMode = readFlag("--mode") ?? "suiyuan";
const message = readFlag("--message");
const conversationId = readFlag("--conversation");
const profileId = readFlag("--profile");

if (!isAgentMode(rawMode) || !message) {
  console.error("参数错误。使用 --help 查看用法。");
  process.exit(1);
}

const provider = createLLMProvider(loadModelProfileCatalog().activeConfig);
const backendConfig = loadBackendConfig();
const runs = new MemoryAgentRunRepository();
const tools = createAgentTools(backendConfig, {
  mockUserId: "local-user",
  includeMockProfile: !process.argv.includes("--without-profile"),
});

for await (const event of runAgent(
  {
    userId: "local-user",
    clientRequestId: randomUUID(),
    mode: rawMode,
    message,
    ...(conversationId ? { conversationId } : {}),
    ...(profileId ? { profileId } : {}),
  },
  { provider, runs, tools },
  backendConfig.localAccessToken
    ? { accessToken: backendConfig.localAccessToken }
    : undefined,
)) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
  if (event.type === "run_failed") process.exitCode = 1;
}
