import { Router } from "express";
import { prisma } from "../lib/prisma.js";
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

    res.json({
      user,
      primaryProfile,
      bazi: primaryProfile?.baziPillar
        ? JSON.parse(primaryProfile.baziPillar)
        : null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
