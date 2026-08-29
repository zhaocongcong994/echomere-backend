import { Router } from "express";

import {
  AgentServiceClient,
  AgentServiceError,
} from "../lib/agent-client.js";
import {
  authMiddleware,
  type AuthenticatedRequest,
} from "../middleware.js";
import { serializeError } from "../lib/logger.js";
import { backendLogger, backendMetrics } from "../lib/observability.js";
import { resolveRuntimeModelAccess } from "../lib/runtime-model-access.js";

const router = Router();
const agentClient = new AgentServiceClient({
  baseUrl: process.env.AGENT_SERVICE_URL || "http://127.0.0.1:4310",
  sharedSecret: process.env.AGENT_SHARED_SECRET || undefined,
  connectTimeoutMs: Number(process.env.AGENT_CONNECT_TIMEOUT_MS) || 10_000,
});

router.get(
  "/runtime",
  authMiddleware,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const runtime = await agentClient.runtime();
      const decision = resolveRuntimeModelAccess(req.user);
      const enabled =
        decision.controlEnabled &&
        decision.authorized &&
        runtime.switching.enabled;
      res.json({
        ...runtime,
        restartRequiredToSwitch: !enabled,
        switching: {
          ...runtime.switching,
          enabled,
          access: decision.access,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/runtime/profile",
  authMiddleware,
  async (req: AuthenticatedRequest, res, next) => {
    const decision = resolveRuntimeModelAccess(req.user);
    if (!decision.controlEnabled) {
      auditSwitch(req, "denied", undefined, "control_disabled");
      res.status(403).json({
        error: "agent_profile_switch_disabled",
        message: "Runtime model switching is disabled on this Backend.",
        retryable: false,
      });
      return;
    }
    if (!decision.authorized) {
      auditSwitch(req, "denied", undefined, decision.reason);
      res.status(403).json({
        error: "agent_profile_switch_forbidden",
        message: "This account is not allowed to switch runtime model profiles.",
        retryable: false,
      });
      return;
    }
    const profileId = req.body?.profileId;
    if (
      typeof profileId !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(profileId)
    ) {
      auditSwitch(req, "denied", undefined, "invalid_profile_id");
      res.status(400).json({
        error: "invalid_profile_id",
        message: "A valid model profile id is required.",
        retryable: false,
      });
      return;
    }

    try {
      const runtime = await agentClient.switchRuntimeProfile(profileId);
      auditSwitch(req, "succeeded", profileId, "switched", {
        activeProfileId: runtime.activeProfileId,
        provider: runtime.provider,
        model: runtime.model,
      });
      res.json({
        ...runtime,
        switching: {
          ...runtime.switching,
          enabled: runtime.switching.enabled,
          access: decision.access,
        },
      });
    } catch (error) {
      if (error instanceof AgentServiceError) {
        auditSwitch(req, "failed", profileId, error.code, {
          retryable: error.retryable,
          statusCode: error.status ?? 503,
        });
        res.status(error.status ?? 503).json({
          error: error.code,
          message: error.message,
          retryable: error.retryable,
        });
        return;
      }
      auditSwitch(req, "failed", profileId, "unexpected_error", {
        ...serializeError(error),
      });
      next(error);
    }
  },
);

function auditSwitch(
  req: AuthenticatedRequest,
  outcome: "succeeded" | "denied" | "failed",
  targetProfileId: string | undefined,
  reason: string,
  fields: Record<string, unknown> = {},
): void {
  backendMetrics.runtimeModelSwitch(outcome);
  const log = outcome === "succeeded" ? backendLogger.info : backendLogger.warn;
  log("runtime_model_switch_audit", {
    requestId: req.requestId,
    actorUserId: req.user?.userId ?? "unknown",
    outcome,
    reason,
    ...(targetProfileId ? { targetProfileId } : {}),
    ...fields,
  });
}

export default router;
