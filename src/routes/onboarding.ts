import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getBaziProfile } from "../lib/bazi.js";
import { authMiddleware, type AuthenticatedRequest } from "../middleware.js";

const router = Router();

const schema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  birthLocation: z.string().optional(),
  gender: z.enum(["male", "female", "other"]),
  name: z.string().optional(),
});

router.post("/", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const { year, month, day, hour, minute, birthLocation, gender, name } = parsed.data;
    const birthDateTime = new Date(year, month - 1, day, hour, minute);
    const profile = getBaziProfile(birthDateTime, gender);

    await prisma.profile.updateMany({
      where: { userId: req.user!.userId, isPrimary: true },
      data: { isPrimary: false },
    });

    const created = await prisma.profile.create({
      data: {
        userId: req.user!.userId,
        type: "self",
        name: name || undefined,
        gender,
        birthDateTime,
        birthLocation,
        isPrimary: true,
        baziPillar: JSON.stringify(profile),
      },
    });

    res.json({ profile: created, bazi: profile });
  } catch (err) {
    next(err);
  }
});

export default router;
