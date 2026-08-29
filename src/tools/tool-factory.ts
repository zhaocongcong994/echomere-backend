import { EchomereBackendClient } from "../backend/backend-client.ts";
import type { BackendRuntimeConfig } from "../config/backend-config.ts";
import { BackendAgentTools } from "./backend-agent-tools.ts";
import {
  createLocalProfileFixture,
  LocalMockAgentTools,
} from "./local-mock-tools.ts";
import type { AgentTools, HexagramRepository } from "./types.ts";

export function createAgentTools(
  config: BackendRuntimeConfig,
  options?: {
    backendClient?: EchomereBackendClient;
    hexagrams?: HexagramRepository;
    mockUserId?: string;
    includeMockProfile?: boolean;
  },
): AgentTools {
  if (config.toolsProvider === "echomere-backend") {
    return new BackendAgentTools(
      options?.backendClient ??
        new EchomereBackendClient({
          baseUrl: config.baseUrl,
          timeoutMs: config.timeoutMs,
        }),
    );
  }

  return new LocalMockAgentTools(
    options?.includeMockProfile === false
      ? []
      : [createLocalProfileFixture(options?.mockUserId)],
    options?.hexagrams ? { hexagrams: options.hexagrams } : undefined,
  );
}
