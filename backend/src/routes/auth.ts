import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signToken, blacklistToken } from "../lib/auth.js";
import { authMiddleware, type AuthenticatedRequest } from "../middleware.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().min(1),
  code: z.string().min(1),
});

router.post("/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const { email: rawInput, code } = parsed.data;
    const input = rawInput.trim().toLowerCase();

    if (code.trim() !== "123456") {
      res.status(401).json({ error: "Invalid code" });
      return;
    }

    const isEmail = input.includes("@");

    let user;
    if (isEmail) {
      user = await prisma.user.findUnique({ where: { email: input } });
      if (!user) {
        user = await prisma.user.create({
          data: { email: input, name: input.split("@")[0] },
        });
      }
    } else {
      const phone = input.replace(/\D/g, "");
      if (phone.length < 5) {
        res.status(400).json({ error: "Invalid phone number" });
        return;
      }
      user = await prisma.user.findUnique({ where: { phone } });
      if (!user) {
        user = await prisma.user.create({
          data: { phone, name: `用户${phone.slice(-4)}` },
        });
      }
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      phone: user.phone,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        name: user.name,
        locale: user.locale,
        defaultDestinySystem: user.defaultDestinySystem,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (token) {
      await blacklistToken(token);
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/me", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { _count: { select: { profiles: true, conversations: true } } },
    });

    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      locale: user.locale,
      defaultDestinySystem: user.defaultDestinySystem,
      profileCount: user._count.profiles,
      conversationCount: user._count.conversations,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
