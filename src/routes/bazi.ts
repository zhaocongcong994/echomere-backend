import { Router } from "express";
import { z } from "zod";
import { getBaziProfile } from "../lib/bazi.js";

const router = Router();

const schema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  gender: z.enum(["male", "female", "other"]),
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const { year, month, day, hour, minute, gender } = parsed.data;
    const profile = getBaziProfile(
      new Date(year, month - 1, day, hour, minute),
      gender
    );
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

export default router;
