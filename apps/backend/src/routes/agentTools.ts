import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { castHexagram, type HexagramResult } from "../lib/liuyao.js";
import { sanitizeUserQuestion } from "../lib/prompt-builder.js";
import { authMiddleware, type AuthenticatedRequest } from "../middleware.js";

const router = Router();

const hexagramSchema = z.object({
  conversationId: z.string().min(1),
  question: z.string().min(1).max(4_000),
  at: z.string().datetime(),
});

router.post(
  "/hexagram",
  authMiddleware,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = hexagramSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.format() });
        return;
      }

      const userId = req.user!.userId;
      const conversation = await prisma.conversation.findFirst({
        where: { id: parsed.data.conversationId, userId },
      });
      if (!conversation) {
        res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
        return;
      }
      if (conversation.mode !== "wenshi") {
        res.status(409).json({ error: "CONVERSATION_MODE_MISMATCH" });
        return;
      }

      const existing = await prisma.hexagram.findUnique({
        where: { conversationId: conversation.id },
      });
      if (existing) {
        res.json({
          reused: true,
          evidenceRef: `backend:hexagram:${conversation.id}:${existing.id}`,
          hexagram: parseStoredHexagram(existing.resultJson),
        });
        return;
      }

      const question = sanitizeUserQuestion(parsed.data.question);
      const hexagram = await castHexagram(
        conversation.title || question,
        conversation.createdAt.getTime(),
        { seed: `echomere-conversation:${conversation.id}` },
      );

      try {
        const created = await prisma.hexagram.create({
          data: {
            conversationId: conversation.id,
            userId,
            question,
            resultJson: JSON.stringify(hexagram),
          },
        });
        res.json({
          reused: false,
          evidenceRef: `backend:hexagram:${conversation.id}:${created.id}`,
          hexagram,
        });
      } catch (error) {
        const raced = await prisma.hexagram.findUnique({
          where: { conversationId: conversation.id },
        });
        if (!raced) throw error;
        res.json({
          reused: true,
          evidenceRef: `backend:hexagram:${conversation.id}:${raced.id}`,
          hexagram: parseStoredHexagram(raced.resultJson),
        });
      }
    } catch (error) {
      next(error);
    }
  },
);

function parseStoredHexagram(value: string): HexagramResult {
  const parsed = JSON.parse(value) as Partial<HexagramResult>;
  if (
    parsed.schemaVersion !== 2 ||
    typeof parsed.originalName !== "string" ||
    typeof parsed.canonicalText !== "string"
  ) {
    throw new Error("Stored hexagram does not match schema version 2.");
  }
  return parsed as HexagramResult;
}

export default router;
