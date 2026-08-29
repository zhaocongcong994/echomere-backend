"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ChevronLeft, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";

const YEARS = Array.from({ length: 100 }, (_, i) => 2026 - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const GENDER_OPTIONS = [
  { value: "male", label: "男" },
  { value: "female", label: "女" },
  { value: "other", label: "其他" },
];
const KNOWLEDGE_OPTIONS = [
  { value: "none", label: "初识" },
  { value: "basic", label: "略知一二" },
  { value: "advanced", label: "比较熟悉" },
];

interface BaziPreview {
  year: string;
  month: string;
  day: string;
  hour: string;
  dayMaster: { gan: string; zhi: string; wuxing: string };
  genderLabel: string;
  wuxing: Record<string, number>;
}

function OnboardingContent() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    year: 1990,
    month: 1,
    day: 15,
    hour: 12,
    minute: 30,
    gender: "male",
    relationship: "",
    industry: "",
    job: "",
    knowledge: "",
  });
  const [preview, setPreview] = useState<BaziPreview | null>(null);

  const fetchPreview = async () => {
    const res = await apiFetch("/bazi", {
      method: "POST",
      body: JSON.stringify({
        year: form.year,
        month: form.month,
        day: form.day,
        hour: form.hour,
        minute: form.minute,
        gender: form.gender,
      }),
    });
    return res.json();
  };

  const next = async () => {
    if (step === 2) {
      const data = await fetchPreview();
      setPreview(data);
    }
    setStep((s) => s + 1);
  };

  const back = () => setStep((s) => s - 1);

  const submit = async () => {
    setLoading(true);
    const res = await apiFetch("/onboarding", {
      method: "POST",
      body: JSON.stringify({
        year: form.year,
        month: form.month,
        day: form.day,
        hour: form.hour,
        minute: form.minute,
        birthLocation: "",
        gender: form.gender,
      }),
    });
    setLoading(false);
    if (res.ok) {
      router.push("/chat");
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <header className="bg-white border-b border-stone-100">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          <span className="font-semibold tracking-[0.12em]">ECHOMERE｜洄映</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-xl bg-white rounded-2xl border border-stone-100 p-8 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <span className="text-xs text-stone-400">步骤 {step} / 5</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={`h-1.5 w-6 rounded-full ${
                    i <= step ? "bg-stone-800" : "bg-stone-200"
                  }`}
                />
              ))}
            </div>
          </div>

          {step === 1 && (
            <div className="text-center space-y-4">
              <h1 className="text-2xl font-medium">欢迎来到 ECHOMERE</h1>
              <p className="text-stone-500">
                洄映会引导你建立命盘档案，开启 AI 命理分析之旅。
              </p>
              <Button className="mt-4" onClick={next}>
                开始设置
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="birth-step">
              <div className="birth-step-heading">
                <h2 className="text-xl font-medium">填写出生时间</h2>
                <p className="text-sm text-stone-500">时间越准确，映照越清晰</p>
              </div>

              <section className="birth-group" aria-labelledby="birth-date-heading">
                <div className="birth-group-heading">
                  <h3 id="birth-date-heading">出生日期</h3>
                  <span>阳历 / 公历</span>
                </div>
                <div className="birth-date-grid">
                <div className="birth-field birth-field-year">
                  <Label>年</Label>
                  <Select value={String(form.year)} onValueChange={(v) => setForm({ ...form, year: Number(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="birth-field">
                  <Label>月</Label>
                  <Select value={String(form.month)} onValueChange={(v) => setForm({ ...form, month: Number(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m) => <SelectItem key={m} value={String(m)}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="birth-field">
                  <Label>日</Label>
                  <Select value={String(form.day)} onValueChange={(v) => setForm({ ...form, day: Number(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DAYS.map((d) => <SelectItem key={d} value={String(d)}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                </div>
              </section>

              <section className="birth-group" aria-labelledby="birth-time-heading">
                <div className="birth-group-heading">
                  <h3 id="birth-time-heading">出生时刻</h3>
                  <span>24 小时制</span>
                </div>
                <div className="birth-time-grid">
                  <div className="birth-field">
                    <Label>时</Label>
                    <Select value={String(form.hour)} onValueChange={(v) => setForm({ ...form, hour: Number(v) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-60">
                        {HOURS.map((h) => <SelectItem key={h} value={String(h)}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="birth-field">
                    <Label>分</Label>
                    <Select value={String(form.minute)} onValueChange={(v) => setForm({ ...form, minute: Number(v) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-60">
                        {MINUTES.map((m) => <SelectItem key={m} value={String(m)}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>

              <div className="birth-actions">
                <Button variant="ghost" onClick={back}><ChevronLeft className="w-4 h-4" /> 返回</Button>
                <Button onClick={next}>下一步</Button>
              </div>
            </div>
          )}

          {step === 3 && preview && (
            <div className="space-y-4">
              <h2 className="text-xl font-medium">确认出生时间</h2>
              <div className="bg-stone-50 rounded-xl p-6 text-center space-y-2">
                <div className="text-2xl tracking-widest font-medium">
                  {preview.year} · {preview.month} · {preview.day} · {preview.hour}
                </div>
                <div className="text-sm text-stone-500">
                  日主：{preview.dayMaster.gan}{preview.dayMaster.zhi}（{preview.dayMaster.wuxing}） · {preview.genderLabel}
                </div>
                <div className="text-xs text-stone-400">
                  五行：{Object.entries(preview.wuxing).map(([k, v]) => `${k}${v}`).join(" / ")}
                </div>
              </div>
              <div className="flex justify-between pt-4">
                <Button variant="ghost" onClick={back}><ChevronLeft className="w-4 h-4" /> 返回修改</Button>
                <Button onClick={next}>确认</Button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="profile-step">
              <div className="profile-step-heading">
                <h2 className="text-xl font-medium">个人信息</h2>
                <p className="text-sm text-stone-500">让每一次回应，更贴近你此刻的处境</p>
              </div>

              <section className="profile-group" aria-labelledby="identity-heading">
                <div className="profile-group-heading">
                  <h3 id="identity-heading">身份轮廓</h3>
                  <span>仅用于个性化解读</span>
                </div>

                <div className="profile-field">
                  <Label>性别</Label>
                  <div className="choice-row" role="group" aria-label="性别">
                    {GENDER_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`choice-chip ${form.gender === option.value ? "is-selected" : ""}`}
                        aria-pressed={form.gender === option.value}
                        onClick={() => setForm({ ...form, gender: option.value })}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="profile-field">
                  <Label htmlFor="relationship">感情状态</Label>
                  <Input id="relationship" placeholder="如：单身、恋爱中、已婚" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} />
                </div>
              </section>

              <section className="profile-group" aria-labelledby="context-heading">
                <div className="profile-group-heading">
                  <h3 id="context-heading">当下语境</h3>
                  <span>选填</span>
                </div>

                <div className="profile-work-grid">
                  <div className="profile-field">
                    <Label htmlFor="industry">所在行业</Label>
                    <Input id="industry" placeholder="互联网、金融、教育…" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
                  </div>
                  <div className="profile-field">
                    <Label htmlFor="job">当前职业</Label>
                    <Input id="job" placeholder="产品、教师、设计师…" value={form.job} onChange={(e) => setForm({ ...form, job: e.target.value })} />
                  </div>
                </div>

                <div className="profile-field">
                  <Label>命理了解程度</Label>
                  <div className="choice-row" role="group" aria-label="命理了解程度">
                    {KNOWLEDGE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`choice-chip ${form.knowledge === option.value ? "is-selected" : ""}`}
                        aria-pressed={form.knowledge === option.value}
                        onClick={() => setForm({ ...form, knowledge: option.value })}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <div className="birth-actions profile-actions">
                <Button variant="ghost" onClick={back}><ChevronLeft className="w-4 h-4" /> 返回</Button>
                <Button onClick={next}>下一步</Button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="text-center space-y-4">
              <h2 className="text-2xl font-medium">设置完成</h2>
              <p className="text-stone-500">你的主命盘已创建，现在可以开始提问了。</p>
              <Button onClick={submit} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "进入 ECHOMERE"}
              </Button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-stone-400" /></div>}>
      <OnboardingContent />
    </Suspense>
  );
}
