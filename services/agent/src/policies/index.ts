import type { ResolvedAgentMode } from "../agent/types.ts";
import { kanyunPolicy } from "./kanyun.policy.ts";
import { qingtingPolicy } from "./qingting.policy.ts";
import type { ModePolicy } from "./types.ts";
import { wenshiPolicy } from "./wenshi.policy.ts";

const policies: Record<ResolvedAgentMode, ModePolicy> = {
  kanyun: kanyunPolicy,
  wenshi: wenshiPolicy,
  qingting: qingtingPolicy,
};

export function getModePolicy(mode: ResolvedAgentMode): ModePolicy {
  return policies[mode];
}
