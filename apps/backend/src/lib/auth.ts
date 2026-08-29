import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";
import { backendLogger } from "./observability.js";

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (() => {
    backendLogger.warn("development_jwt_secret_in_use", {
      message: "JWT_SECRET is not set; using the development-only default.",
    });
    return "__metasight_dev_secret__";
  })();

export interface JwtPayload {
  userId: string;
  email?: string | null;
  phone?: string | null;
  jti: string;
}

export function signToken(payload: Omit<JwtPayload, "jti">): string {
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

function hashJti(jti: string): string {
  return crypto.createHash("sha256").update(jti).digest("hex");
}

export async function isTokenBlacklisted(token: string): Promise<boolean> {
  const decoded = jwt.decode(token) as { jti?: string } | null;
  if (!decoded?.jti) return false;
  const record = await prisma.tokenBlacklist.findUnique({
    where: { tokenHash: hashJti(decoded.jti) },
  });
  return Boolean(record);
}

export async function blacklistToken(token: string): Promise<void> {
  const decoded = jwt.decode(token) as { jti?: string; exp?: number } | null;
  if (!decoded?.jti) return;
  const expiresAt = decoded?.exp
    ? new Date(decoded.exp * 1000)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.tokenBlacklist.create({
    data: {
      tokenHash: hashJti(decoded.jti),
      expiresAt,
    },
  });
}
