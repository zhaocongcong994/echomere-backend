import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import profileRoutes from "./routes/profile.js";
import profilesRoutes from "./routes/profiles.js";
import onboardingRoutes from "./routes/onboarding.js";
import baziRoutes from "./routes/bazi.js";
import conversationsRoutes from "./routes/conversations.js";
import chatRoutes from "./routes/chat.js";
import dailyFortuneRoutes from "./routes/dailyFortune.js";
import subscriptionRoutes from "./routes/subscription.js";
import agentToolsRoutes from "./routes/agentTools.js";
import agentRuntimeRoutes from "./routes/agentRuntime.js";
import { AgentServiceClient } from "./lib/agent-client.js";
import { checkChatRateLimiter } from "./lib/chat-rate-limit.js";
import { metricsAuthorization, observabilityMiddleware } from "./lib/metrics.js";
import { backendLogger, backendMetrics } from "./lib/observability.js";
import { prisma } from "./lib/prisma.js";
import { errorHandler, requestIdMiddleware } from "./middleware.js";

export interface AppOptions {
  readinessCheck?: () => Promise<{
    database: "ok" | "error";
    agent: "ok" | "error";
    rateLimit: "ok" | "error";
  }>;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
      exposedHeaders: [
        "X-Request-Id",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
        "Retry-After",
      ],
    }),
  );
  app.use(requestIdMiddleware);
  app.use(observabilityMiddleware(backendMetrics, backendLogger));
  app.use(express.json());

  app.get(
    "/api/metrics",
    metricsAuthorization(process.env.METRICS_TOKEN?.trim()),
    (_req, res) => {
      res.type("text/plain; version=0.0.4; charset=utf-8");
      res.send(backendMetrics.toPrometheus());
    },
  );

  app.use("/api/auth", authRoutes);
  app.use("/api/profile", profileRoutes);
  app.use("/api/profiles", profilesRoutes);
  app.use("/api/onboarding", onboardingRoutes);
  app.use("/api/bazi", baziRoutes);
  app.use("/api/conversations", conversationsRoutes);
  app.use("/api/chat", chatRoutes);
  app.use("/api/daily-fortune", dailyFortuneRoutes);
  app.use("/api/subscription", subscriptionRoutes);
  app.use("/api/agent", agentRuntimeRoutes);
  app.use("/api/agent/tools", agentToolsRoutes);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/api/ready", async (_req, res) => {
    const components = await (options.readinessCheck ?? checkReadiness)();
    const ready =
      components.database === "ok" &&
      components.agent === "ok" &&
      components.rateLimit === "ok";
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      components,
    });
  });

  app.use(errorHandler);
  return app;
}

async function checkReadiness(): Promise<{
  database: "ok" | "error";
  agent: "ok" | "error";
  rateLimit: "ok" | "error";
}> {
  const agent = new AgentServiceClient({
    baseUrl: process.env.AGENT_SERVICE_URL || "http://127.0.0.1:4310",
    connectTimeoutMs: Number(process.env.AGENT_CONNECT_TIMEOUT_MS) || 10_000,
  });
  const [databaseResult, agentResult, rateLimitResult] = await Promise.allSettled([
    prisma.user.count(),
    agent.health(),
    checkChatRateLimiter(),
  ]);
  return {
    database: databaseResult.status === "fulfilled" ? "ok" : "error",
    agent: agentResult.status === "fulfilled" ? "ok" : "error",
    rateLimit: rateLimitResult.status === "fulfilled" ? "ok" : "error",
  };
}
