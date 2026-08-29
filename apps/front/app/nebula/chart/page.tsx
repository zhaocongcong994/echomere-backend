"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface Profile {
  bazi: {
    year: string;
    month: string;
    day: string;
    hour: string;
    dayMaster: { gan: string; zhi: string; wuxing: string };
    genderLabel: string;
    wuxing: Record<string, number>;
  };
}

export default function NebulaChartPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/profile")
      .then((r) => r.json())
      .then((d) => {
        setProfile(d);
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

  if (!profile?.bazi) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col">
        <header className="bg-white border-b border-stone-100">
          <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.push("/nebula")}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <span className="font-medium">人生星云图</span>
          </div>
        </header>
        <main className="flex-1 flex flex-col items-center justify-center p-4 text-center">
          <p className="text-stone-500">需要先建立命盘档案</p>
          <Button className="mt-4" onClick={() => router.push("/onboarding?callbackUrl=/nebula/chart")}>
            创建命盘
          </Button>
        </main>
      </div>
    );
  }

  const bazi = profile.bazi;
  const wuxingEntries = Object.entries(bazi.wuxing).sort((a, b) => b[1] - a[1]);
  const keyYears = [1990, 2000, 2010, 2020, 2030, 2040, 2050];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-900 text-white">
      <header className="border-b border-white/10 bg-black/20 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="text-white" onClick={() => router.push("/nebula")}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="font-medium">人生星云图</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-xs text-white/70">
            八字命理 · 免费开放
          </div>
          <h1 className="text-3xl font-light">{bazi.year} · {bazi.month} · {bazi.day} · {bazi.hour}</h1>
          <p className="text-white/60">
            日主 {bazi.dayMaster.gan}{bazi.dayMaster.zhi}（{bazi.dayMaster.wuxing}） · {bazi.genderLabel}
          </p>
        </div>

        <div className="relative h-80 rounded-3xl overflow-hidden border border-white/10 bg-gradient-to-br from-violet-500/20 via-fuchsia-500/20 to-cyan-500/20">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative w-64 h-64">
              {wuxingEntries.map(([wx, count], i) => {
                const angle = (i / wuxingEntries.length) * Math.PI * 2;
                const radius = 80 + count * 15;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                const colors: Record<string, string> = {
                  金: "bg-amber-300",
                  木: "bg-emerald-400",
                  水: "bg-blue-400",
                  火: "bg-rose-400",
                  土: "bg-amber-600",
                };
                return (
                  <div
                    key={wx}
                    className={`absolute w-12 h-12 rounded-full ${colors[wx]} blur-md opacity-80 flex items-center justify-center text-xs font-bold text-black`}
                    style={{
                      left: `calc(50% + ${x}px - 24px)`,
                      top: `calc(50% + ${y}px - 24px)`,
                    }}
                  >
                    {wx}
                  </div>
                );
              })}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-24 h-24 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-lg font-medium">
                  {bazi.dayMaster.gan}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {wuxingEntries.map(([wx, count]) => (
            <div key={wx} className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
              <div className="text-2xl font-medium">{wx}</div>
              <div className="text-xs text-white/50">{count} 个</div>
            </div>
          ))}
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h2 className="font-medium mb-4">百年大运关键年份</h2>
          <div className="flex flex-wrap gap-2">
            {keyYears.map((year) => (
              <div key={year} className="px-3 py-1 rounded-full bg-white/10 text-sm text-white/80">
                {year}
              </div>
            ))}
          </div>
          <p className="text-sm text-white/50 mt-4">
            完整 3D 运势可视化、大运排布与关键年份解读正在迭代中。当前已免费开放八字命理基础视图。
          </p>
        </div>
      </main>
    </div>
  );
}
