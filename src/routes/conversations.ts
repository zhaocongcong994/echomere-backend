import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, type AuthenticatedRequest } from "../middleware.js";

const router = Router();

router.get("/", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { userId: req.user!.userId, status: "active" },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        _count: { select: { messages: true } },
      },
    });
    res.json(conversations);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const conversation = await prisma.conversation.findFirst({
      where: { id, userId: req.user!.userId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!conversation) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(conversation);
  } catch (err) {
    next(err);
  }
});

export default router;
