import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { getBaziProfile } from "../lib/bazi.js";
import { authMiddleware, type AuthenticatedRequest } from "../middleware.js";

const router = Router();

router.get("/", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });
    const primaryProfile = await prisma.profile.findFirst({
      where: { userId: req.user!.userId, isPrimary: true },
    });

    const bazi = primaryProfile
      ? getBaziProfile(primaryProfile.birthDateTime, primaryProfile.gender, {
          birthPlace: primaryProfile.birthLocation || undefined,
        })
      : null;
    if (primaryProfile && bazi) {
      const stored = primaryProfile.baziPillar ? JSON.parse(primaryProfile.baziPillar) : null;
      if (stored?.schemaVersion !== bazi.schemaVersion) {
        await prisma.profile.update({
          where: { id: primaryProfile.id },
          data: { baziPillar: JSON.stringify(bazi) },
        });
      }
    }

    res.json({
      user,
      primaryProfile,
      bazi,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
