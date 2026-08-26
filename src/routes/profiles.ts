import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getBaziProfile } from "../lib/bazi.js";
import { authMiddleware, type AuthenticatedRequest } from "../middleware.js";

const router = Router();

const createSchema = z.object({
  type: z.enum(["self", "others"]).default("others"),
  name: z.string().optional(),
  gender: z.enum(["male", "female", "other"]),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  birthLocation: z.string().optional(),
  isPrimary: z.boolean().default(false),
});

const updateSchema = z.object({
  name: z.string().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  year: z.number().int().optional(),
  month: z.number().int().min(1).max(12).optional(),
  day: z.number().int().min(1).max(31).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  minute: z.number().int().min(0).max(59).optional(),
  birthLocation: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

router.get("/", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const profiles = await prisma.profile.findMany({
      where: { userId: req.user!.userId },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
    });
    res.json(profiles);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const profile = await prisma.profile.findFirst({
      where: { id, userId: req.user!.userId },
    });
    if (!profile) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const bazi = getBaziProfile(profile.birthDateTime, profile.gender, {
      birthPlace: profile.birthLocation || undefined,
    });
    const stored = profile.baziPillar ? JSON.parse(profile.baziPillar) : null;
    if (stored?.schemaVersion !== bazi.schemaVersion) {
      await prisma.profile.update({
        where: { id: profile.id },
        data: { baziPillar: JSON.stringify(bazi) },
      });
    }

    res.json({ ...profile, baziPillar: JSON.stringify(bazi), bazi });
  } catch (err) {
    next(err);
  }
});

router.post("/", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const { type, name, gender, year, month, day, hour, minute, birthLocation, isPrimary } =
      parsed.data;
    const birthDateTime = new Date(year, month - 1, day, hour, minute);
    const bazi = getBaziProfile(birthDateTime, gender, { birthPlace: birthLocation });

    if (isPrimary) {
      await prisma.profile.updateMany({
        where: { userId: req.user!.userId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const profile = await prisma.profile.create({
      data: {
        userId: req.user!.userId,
        type,
        name,
        gender,
        birthDateTime,
        birthLocation,
        isPrimary,
        baziPillar: JSON.stringify(bazi),
      },
    });

    res.json(profile);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const existing = await prisma.profile.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.birthLocation !== undefined)
      data.birthLocation = parsed.data.birthLocation;

    if (
      parsed.data.year !== undefined ||
      parsed.data.month !== undefined ||
      parsed.data.day !== undefined ||
      parsed.data.hour !== undefined ||
      parsed.data.minute !== undefined ||
      parsed.data.gender !== undefined ||
      parsed.data.birthLocation !== undefined
    ) {
      const birth = existing.birthDateTime;
      const year = parsed.data.year ?? birth.getFullYear();
      const month = parsed.data.month ?? birth.getMonth() + 1;
      const day = parsed.data.day ?? birth.getDate();
      const hour = parsed.data.hour ?? birth.getHours();
      const minute = parsed.data.minute ?? birth.getMinutes();
      const gender = parsed.data.gender ?? existing.gender;
      data.birthDateTime = new Date(year, month - 1, day, hour, minute);
      data.baziPillar = JSON.stringify(getBaziProfile(data.birthDateTime as Date, gender, {
        birthPlace: (data.birthLocation as string | undefined) ?? existing.birthLocation ?? undefined,
      }));
      if (parsed.data.gender) data.gender = gender;
    }

    if (parsed.data.isPrimary) {
      await prisma.profile.updateMany({
        where: { userId, isPrimary: true },
        data: { isPrimary: false },
      });
      data.isPrimary = true;
    }

    const updated = await prisma.profile.update({ where: { id }, data });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const existing = await prisma.profile.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    await prisma.profile.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
