import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";

// JWT_SECRET 必须来自环境变量。生产环境缺失时直接启动失败，
// 避免回退到任何可被猜测的默认值；开发环境则用进程级随机密钥兜底。
const JWT_SECRET =
  process.env.JWT_SECRET ||
  (() => {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET must be set in production");
    }
    const ephemeral = crypto.randomBytes(32).toString("hex");
    console.warn(
      "[backend] JWT_SECRET is not set. Using an ephemeral random secret for this process only."
    );
    return ephemeral;
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
