import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRuntimeModelAdminEmails,
  resolveRuntimeModelAccess,
} from "./runtime-model-access.js";

test("runtime model control keeps local development convenient without an allowlist", () => {
  const decision = resolveRuntimeModelAccess(
    { email: "developer@local.test" },
    { AGENT_RUNTIME_MODEL_CONTROL_ENABLED: "true" },
  );
  assert.equal(decision.authorized, true);
  assert.equal(decision.access, "admin");
});

test("runtime model admin allowlist is exact and case insensitive", () => {
  const env = {
    AGENT_RUNTIME_MODEL_CONTROL_ENABLED: "true",
    AGENT_RUNTIME_MODEL_ADMIN_EMAILS: " Admin@Example.com,ops@example.com ",
  };
  assert.equal(
    resolveRuntimeModelAccess({ email: "admin@example.com" }, env).authorized,
    true,
  );
  assert.equal(
    resolveRuntimeModelAccess({ email: "other@example.com" }, env).authorized,
    false,
  );
  assert.deepEqual(parseRuntimeModelAdminEmails(env.AGENT_RUNTIME_MODEL_ADMIN_EMAILS), [
    "admin@example.com",
    "ops@example.com",
  ]);
});

test("production fails closed if validation was bypassed without an allowlist", () => {
  const decision = resolveRuntimeModelAccess(
    { email: "admin@example.com" },
    {
      NODE_ENV: "production",
      AGENT_RUNTIME_MODEL_CONTROL_ENABLED: "true",
    },
  );
  assert.equal(decision.authorized, false);
  assert.equal(decision.reason, "missing_admin_allowlist");
});

test("runtime model admin allowlist rejects malformed email entries", () => {
  assert.throws(
    () => parseRuntimeModelAdminEmails("admin@example.com,not-an-email"),
    /valid comma-separated email/u,
  );
});
