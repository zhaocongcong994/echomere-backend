import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (() => {
    console.warn(
      "[backend] JWT_SECRET is not set. Using a development default. Do not use this in production!"
    );
    return "__metasight_dev_secret__";
  })();

export interface JwtPayload {
  userId: string;
  email?: string | null;
  phone?: string | null;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
