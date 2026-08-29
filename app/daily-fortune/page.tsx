"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Loader2, Sun } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface DailyFortuneData {
  error?: string;
  date: string;
  profile: {
    bazi: {
      year: string;
      month: string;
      day: string;
      hour: string;
      dayMaster: { gan: string; zhi: string; wuxing: string };
    };
  };
  today: {
    yearGanZhi: string;
    monthGanZhi: string;
    dayGanZhi: string;
    dayShiShen: string;
    dayWuXing: string;
  };
  year: { ganZhi: string; shiShen: string; naYin: string };
}

export default function DailyFortunePage() {
  const router = useRouter();
  const [data, setData] = useState<DailyFortuneData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/daily-fortune")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
      </div>
    );
  }

  if (data?.error === "NO_PROFILE") {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col">
        <header className="bg-white border-b border-stone-100">
          <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.push("/chat")}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <span className="font-medium">每日运势</span>
          </div>
        </header>
        <main className="flex-1 flex flex-col items-center justify-center p-4 text-center">
          <p className="text-stone-500">需要先建立命盘档案</p>
          <Button className="mt-4" onClick={() => router.push("/onboarding")}>创建命盘</Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-100">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/chat")}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="font-medium">每日运势</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="text-center space-y-2">
          <Sun className="w-8 h-8 mx-auto text-amber-500" />
          <h1 className="text-2xl font-medium">今日运势</h1>
          <p className="text-stone-500">{data.date}</p>
        </div>

        <div className="bg-white rounded-2xl border border-stone-100 p-6 shadow-sm text-center">
          <div className="text-2xl tracking-widest font-medium">
            {data.profile.bazi.year} · {data.profile.bazi.month} · {data.profile.bazi.day} · {data.profile.bazi.hour}
          </div>
          <div className="text-sm text-stone-500 mt-2">
            日主：{data.profile.bazi.dayMaster.gan}{data.profile.bazi.dayMaster.zhi}（{data.profile.bazi.dayMaster.wuxing}）
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm">
            <div className="text-xs text-stone-400 mb-1">年柱</div>
            <div className="text-xl font-medium">{data.today.yearGanZhi}</div>
          </div>
          <div className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm">
            <div className="text-xs text-stone-400 mb-1">月柱</div>
            <div className="text-xl font-medium">{data.today.monthGanZhi}</div>
          </div>
          <div className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm">
            <div className="text-xs text-stone-400 mb-1">日柱</div>
            <div className="text-xl font-medium">{data.today.dayGanZhi}</div>
            <div className="text-xs text-stone-500 mt-1">{data.today.dayShiShen}</div>
          </div>
          <div className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm">
            <div className="text-xs text-stone-400 mb-1">流年</div>
            <div className="text-xl font-medium">{data.year.ganZhi}</div>
            <div className="text-xs text-stone-500 mt-1">{data.year.shiShen} · {data.year.naYin}</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-stone-100 p-6 shadow-sm">
          <h2 className="font-medium mb-3">今日提示</h2>
          <p className="text-sm text-stone-600 leading-relaxed">
            今日日柱为 {data.today.dayGanZhi}，五行属{data.today.dayWuXing}，对日主「{data.profile.bazi.dayMaster.gan}」而言为「{data.today.dayShiShen}」。
            适合顺势而为，保持觉察。AI 解读功能已接入，可在聊天中进一步提问。
          </p>
        </div>
      </main>
    </div>
  );
}
