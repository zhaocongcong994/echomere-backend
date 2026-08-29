import { z } from "zod";

import { AGENT_MODES } from "./types.ts";

export const agentInputSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  conversationId: z.string().trim().min(1).max(128).optional(),
  clientRequestId: z.string().trim().min(1).max(128),
  mode: z.enum(AGENT_MODES),
  message: z.string().trim().min(1).max(4_000),
  profileId: z.string().trim().min(1).max(128).optional(),
});
