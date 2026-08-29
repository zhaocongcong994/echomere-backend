import assert from "node:assert/strict";
import test from "node:test";
import { validateBackendEnvironment } from "../config/environment.js";

test("production environment rejects placeholder secrets", () => {
  assert.throws(
    () =>
      validateBackendEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "file:/data/backend.db",
        CORS_ORIGINS: "https://app.example.com",
        JWT_SECRET: "replace-with-a-secret",
        AGENT_SHARED_SECRET: "a".repeat(32),
        METRICS_TOKEN: "b".repeat(32),
      }),
    /JWT_SECRET/u,
  );
});

test("production environment reports the single-instance memory limit", () => {
  const result = validateBackendEnvironment({
    NODE_ENV: "production",
    DATABASE_URL: "file:/data/backend.db",
    CORS_ORIGINS: "https://app.example.com",
    JWT_SECRET: "j".repeat(32),
    AGENT_SHARED_SECRET: "a".repeat(32),
    METRICS_TOKEN: "m".repeat(32),
    CHAT_RATE_LIMIT_STORE: "memory",
  });
  assert.equal(result.port, 3_001);
  assert.equal(result.warnings.length, 1);
});

test("runtime model control requires an administrator allowlist in production", () => {
  const local = validateBackendEnvironment({
    AGENT_RUNTIME_MODEL_CONTROL_ENABLED: "true",
  });
  assert.equal(local.runtimeModelControlEnabled, true);
  assert.deepEqual(local.runtimeModelAdminEmails, []);

  assert.throws(
    () =>
      validateBackendEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "file:/data/backend.db",
        CORS_ORIGINS: "https://app.example.com",
        JWT_SECRET: "j".repeat(32),
        AGENT_SHARED_SECRET: "a".repeat(32),
        METRICS_TOKEN: "m".repeat(32),
        AGENT_RUNTIME_MODEL_CONTROL_ENABLED: "true",
      }),
    /ADMIN_EMAILS/u,
  );

  const production = validateBackendEnvironment({
    NODE_ENV: "production",
    DATABASE_URL: "file:/data/backend.db",
    CORS_ORIGINS: "https://app.example.com",
    JWT_SECRET: "j".repeat(32),
    AGENT_SHARED_SECRET: "a".repeat(32),
    METRICS_TOKEN: "m".repeat(32),
    AGENT_RUNTIME_MODEL_CONTROL_ENABLED: "true",
    AGENT_RUNTIME_MODEL_ADMIN_EMAILS: "Admin@Example.com",
  });
  assert.deepEqual(production.runtimeModelAdminEmails, ["admin@example.com"]);
});
