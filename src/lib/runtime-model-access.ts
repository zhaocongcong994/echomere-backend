import type { JwtPayload } from "./auth.js";

type Environment = Record<string, string | undefined>;

export type RuntimeModelManagementAccess = "admin" | "read-only";

export interface RuntimeModelAccessDecision {
  controlEnabled: boolean;
  authorized: boolean;
  access: RuntimeModelManagementAccess;
  reason: "disabled" | "authorized" | "email_not_allowed" | "missing_admin_allowlist";
}

export function parseRuntimeModelAdminEmails(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const emails = value
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter(Boolean);
  for (const email of emails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      throw new Error(
        "AGENT_RUNTIME_MODEL_ADMIN_EMAILS must contain valid comma-separated email addresses.",
      );
    }
  }
  return [...new Set(emails)];
}

export function resolveRuntimeModelAccess(
  user: Pick<JwtPayload, "email"> | undefined,
  env: Environment = process.env,
): RuntimeModelAccessDecision {
  const controlEnabled =
    env.AGENT_RUNTIME_MODEL_CONTROL_ENABLED === "true";
  if (!controlEnabled) {
    return {
      controlEnabled: false,
      authorized: false,
      access: "read-only",
      reason: "disabled",
    };
  }

  const adminEmails = parseRuntimeModelAdminEmails(
    env.AGENT_RUNTIME_MODEL_ADMIN_EMAILS,
  );
  if (adminEmails.length === 0) {
    const authorized = env.NODE_ENV !== "production";
    return {
      controlEnabled: true,
      authorized,
      access: authorized ? "admin" : "read-only",
      reason: authorized ? "authorized" : "missing_admin_allowlist",
    };
  }

  const authorized = Boolean(
    user?.email && adminEmails.includes(normalizeEmail(user.email)),
  );
  return {
    controlEnabled: true,
    authorized,
    access: authorized ? "admin" : "read-only",
    reason: authorized ? "authorized" : "email_not_allowed",
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
