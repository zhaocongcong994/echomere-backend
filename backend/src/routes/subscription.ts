import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, type AuthenticatedRequest } from "../middleware.js";

const router = Router();

const PLANS = [
  {
    id: "free",
    name: "体验版",
    price: 0,
    period: "永久",
    features: ["每日运势", "八字星云图", "看运/倾听/问事 无限次测试"],
    cta: "当前方案",
    popular: false,
  },
  {
    id: "lite",
    name: "轻量版",
    price: 2900,
    period: "月",
    features: ["每月 30 次深度解读", "优先响应", "历史对话导出"],
    cta: "选择轻量版",
    popular: false,
  },
  {
    id: "pro",
    name: "专业版",
    price: 9900,
    period: "月",
    features: ["每月 100 次深度解读", "紫微斗数（敬请期待）", "真人 1v1 折扣"],
    cta: "选择专业版",
    popular: true,
  },
  {
    id: "ultra",
    name: "无限版",
    price: 29900,
    period: "月",
    features: ["无限次深度解读", "全部命理体系", "优先真人 1v1"],
    cta: "选择无限版",
    popular: false,
  },
];

router.get("/", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const count = await prisma.billingRecord.count({
      where: {
        userId: req.user!.userId,
        type: "interpretation",
        status: "completed",
      },
    });

    res.json({
      currentPlan: "free",
      used: count,
      limit: null,
      plans: PLANS,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    await prisma.billingRecord.create({
      data: {
        userId: req.user!.userId,
        type: "subscription",
        amount: 0,
        description: "MVP 测试期订阅占位",
        status: "completed",
      },
    });

    res.json({ success: true, note: "MVP 测试期不扣费" });
  } catch (err) {
    next(err);
  }
});

export default router;
