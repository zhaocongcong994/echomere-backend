import "dotenv/config";
import { validateBackendEnvironment } from "./config/environment.js";

const environment = validateBackendEnvironment();
const [
  { createApp },
  { closeChatRateLimiter, chatRateLimitStore },
  { backendLogger },
  { prisma },
] = await Promise.all([
  import("./app.js"),
  import("./lib/chat-rate-limit.js"),
  import("./lib/observability.js"),
  import("./lib/prisma.js"),
]);

for (const warning of environment.warnings) {
  backendLogger.warn("environment_warning", { message: warning });
}

const app = createApp();
const server = app.listen(environment.port, () => {
  backendLogger.info("server_started", {
    port: environment.port,
    nodeEnv: process.env.NODE_ENV || "development",
    rateLimitStore: chatRateLimitStore(),
  });
});

server.once("error", (error: NodeJS.ErrnoException) => {
  backendLogger.error("server_start_failed", {
    errorCode: error.code,
    errorMessage: error.message,
  });
  process.exitCode = 1;
});

let shutdownStarted = false;
const shutdown = (signal: NodeJS.Signals): void => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  backendLogger.info("server_shutdown_started", { signal });

  const forceTimer = setTimeout(() => {
    backendLogger.error("server_shutdown_forced", {
      timeoutMs: environment.shutdownTimeoutMs,
    });
    server.closeAllConnections();
    process.exitCode = 1;
  }, environment.shutdownTimeoutMs);
  forceTimer.unref();
  server.closeIdleConnections();

  server.close(async (error) => {
    const results = await Promise.allSettled([
      closeChatRateLimiter(),
      prisma.$disconnect(),
    ]);
    clearTimeout(forceTimer);
    const cleanupFailed = results.some((result) => result.status === "rejected");
    if (error || cleanupFailed) {
      backendLogger.error("server_shutdown_failed", {
        ...(error ? { errorMessage: error.message } : {}),
        cleanupFailed,
      });
      process.exitCode = 1;
      return;
    }
    backendLogger.info("server_shutdown_completed");
  });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
