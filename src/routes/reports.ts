import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getBaziProfile } from "../lib/bazi.js";
import { ensureProfileName } from "../lib/profile-name.js";
import { authMiddleware, type AuthenticatedRequest } from "../middleware.js";

const router = Router();

const createSchema = z.object({
  profileId: z.string(),
});

function buildReportContent(profile: {
  birthDateTime: Date;
  gender: string;
  birthLocation: string | null;
}) {
  const bazi = getBaziProfile(profile.birthDateTime, profile.gender, {
    birthPlace: profile.birthLocation || undefined,
  });

  const wuxingEntries = Object.entries(bazi.wuxing)
    .sort((a, b) => b[1] - a[1])
    .map(([element, score]) => ({ element, score }));

  const dayMasterElement = bazi.dayMaster.wuxing;
  const strongest = wuxingEntries[0]?.element;
  const weakest = wuxingEntries[wuxingEntries.length - 1]?.element;

  const wuxingAnalysis = {
    scores: bazi.wuxing,
    ranking: wuxingEntries,
    dayMasterElement,
    bodyStrength: bazi.bodyStrength,
    xiYongShen: bazi.xiYongShen,
    assessment: `${bazi.dayMaster.gan}属${dayMasterElement}，日主${bazi.bodyStrength}。五行分布中${strongest}最旺，${weakest}最弱。喜用神为${bazi.xiYongShen.xi.join("、")}，忌神为${bazi.xiYongShen.ji.join("、")}。`,
  };

  return {
    dayun: bazi.dayunJson,
    wuxingAnalysis,
  };
}

function buildSummary(profileName: string, content: ReturnType<typeof buildReportContent>) {
  const dayMasterElement = content.wuxingAnalysis.dayMasterElement;
  const bodyStrength = content.wuxingAnalysis.bodyStrength;
  const topElements = content.wuxingAnalysis.ranking
    .slice(0, 3)
    .map((e) => `${e.element}${e.score}`)
    .join("，");
  return `${profileName} · 日主${dayMasterElement}${bodyStrength} · 五行：${topElements}`;
}

router.get("/", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const reports = await prisma.report.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: "desc" },
      include: { profile: true },
    });

    res.json(
      reports.map((report) => {
        const profile = ensureProfileName(report.profile);
        return {
          id: report.id,
          profileId: report.profileId,
          profileName: profile.name,
          title: report.title || "八字深度报告",
          summary: report.summary || "",
          status: report.status,
          createdAt: report.createdAt.toISOString(),
          updatedAt: report.updatedAt.toISOString(),
        };
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post("/", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.userId;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.format() });
      return;
    }

    const { profileId } = parsed.data;
    const profile = await prisma.profile.findFirst({
      where: { id: profileId, userId },
    });
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    const existing = await prisma.report.findUnique({
      where: { profileId },
    });

    const baseData = {
      userId,
      profileId,
      title: "八字深度报告",
      summary: "",
      content: null,
      status: "pending",
      errorMsg: null,
    };

    const report = existing
      ? await prisma.report.update({
          where: { id: existing.id },
          data: baseData,
        })
      : await prisma.report.create({ data: baseData });

    // 异步生成报告，不阻塞响应
    setImmediate(async () => {
      try {
        const content = buildReportContent(profile);
        const namedProfile = ensureProfileName(profile);
        const summary = buildSummary(namedProfile.name as string, content);
        await prisma.report.update({
          where: { id: report.id },
          data: {
            content: JSON.stringify(content),
            summary,
            status: "completed",
          },
        });
      } catch (e) {
        console.error("[report generation failed]", e);
        await prisma.report.update({
          where: { id: report.id },
          data: {
            status: "failed",
            errorMsg: e instanceof Error ? e.message : "生成失败",
          },
        });
      }
    });

    res.json({
      id: report.id,
      profileId: report.profileId,
      profileName: ensureProfileName(profile).name,
      title: report.title || "八字深度报告",
      summary: "",
      status: "pending",
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const report = await prisma.report.findFirst({
      where: { id, userId: req.user!.userId },
      include: { profile: true },
    });

    if (!report) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const profile = ensureProfileName(report.profile);
    const base = {
      id: report.id,
      profileId: report.profileId,
      profileName: profile.name,
      title: report.title || "八字深度报告",
      status: report.status,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    };

    if (report.status !== "completed" || !report.content) {
      res.json(base);
      return;
    }

    res.json({
      ...base,
      content: JSON.parse(report.content),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const existing = await prisma.report.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    await prisma.report.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
