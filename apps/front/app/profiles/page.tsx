"use client";

import { useEffect, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ChevronLeft, Plus, Star, Trash2, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

const YEARS = Array.from({ length: 100 }, (_, i) => 2026 - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

interface Profile {
  id: string;
  name: string | null;
  gender: string;
  birthDateTime: string;
  isPrimary: boolean;
  baziPillar: string;
  type: string;
}

export default function ProfilesPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    gender: "male",
    year: 1990,
    month: 1,
    day: 15,
    hour: 12,
    minute: 30,
    type: "others",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchProfiles();
  }, []);

  async function fetchProfiles() {
    const res = await apiFetch("/profiles");
    if (res.ok) {
      const data = await res.json();
      setProfiles(data);
    }
    setLoading(false);
  }

  const createProfile = async () => {
    setSubmitting(true);
    const res = await apiFetch("/profiles", {
      method: "POST",
      body: JSON.stringify({ ...form, isPrimary: true }),
    });
    setSubmitting(false);
    if (res.ok) {
      setDialogOpen(false);
      fetchProfiles();
    }
  };

  const setPrimary = async (id: string) => {
    await apiFetch(`/profiles/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ isPrimary: true }),
    });
    fetchProfiles();
  };

  const deleteProfile = async (id: string) => {
    await apiFetch(`/profiles/${id}`, { method: "DELETE" });
    fetchProfiles();
  };

  const parseBazi = (p: Profile) => {
    try {
      return JSON.parse(p.baziPillar);
    } catch {
      return null;
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-100">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/chat")}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="font-medium">命运档案</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-medium">我的命盘</h1>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger render={<Button size="sm" />}>
              <Plus className="w-4 h-4 mr-1" /> 新增档案
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>新增命盘档案</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <Label>称呼</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：小明" />
                </div>
                <div>
                  <Label>关系</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as string })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="self">自己</SelectItem>
                      <SelectItem value="others">他人</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>性别</Label>
                  <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v as string })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">男</SelectItem>
                      <SelectItem value="female">女</SelectItem>
                      <SelectItem value="other">其他</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>年</Label>
                    <Select value={String(form.year)} onValueChange={(v) => setForm({ ...form, year: Number(v) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-60">
                        {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>月</Label>
                    <Select value={String(form.month)} onValueChange={(v) => setForm({ ...form, month: Number(v) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m) => <SelectItem key={m} value={String(m)}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>日</Label>
                    <Select value={String(form.day)} onValueChange={(v) => setForm({ ...form, day: Number(v) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DAYS.map((d) => <SelectItem key={d} value={String(d)}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>时</Label>
                    <Select value={String(form.hour)} onValueChange={(v) => setForm({ ...form, hour: Number(v) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-60">
                        {HOURS.map((h) => <SelectItem key={h} value={String(h)}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>分</Label>
                    <Select value={String(form.minute)} onValueChange={(v) => setForm({ ...form, minute: Number(v) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-60">
                        {MINUTES.map((m) => <SelectItem key={m} value={String(m)}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button onClick={createProfile} disabled={submitting} className="w-full">
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存并设为主命盘"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="space-y-4">
          {profiles.map((p) => {
            const bazi = parseBazi(p);
            return (
              <div key={p.id} className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-medium">{p.name || "未命名"}</h2>
                      {p.isPrimary && <Star className="w-4 h-4 text-amber-500 fill-amber-500" />}
                    </div>
                    <p className="text-xs text-stone-400 mt-1">
                      {p.type === "self" ? "自己" : "他人"} · {p.gender === "male" ? "男" : p.gender === "female" ? "女" : "其他"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {!p.isPrimary && (
                      <Button variant="ghost" size="icon" onClick={() => setPrimary(p.id)}>
                        <Star className="w-4 h-4 text-stone-400" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => deleteProfile(p.id)}>
                      <Trash2 className="w-4 h-4 text-stone-400" />
                    </Button>
                  </div>
                </div>
                {bazi && (
                  <div className="mt-4 pt-4 border-t border-stone-50">
                    <div className="text-2xl tracking-widest font-medium text-center">
                      {bazi.year} · {bazi.month} · {bazi.day} · {bazi.hour}
                    </div>
                    <div className="text-sm text-stone-500 text-center mt-2">
                      日主：{bazi.dayMaster.gan}{bazi.dayMaster.zhi}（{bazi.dayMaster.wuxing}） · {bazi.genderLabel}
                    </div>
                    <div className="text-xs text-stone-400 text-center mt-1">
                      五行：{Object.entries(bazi.wuxing).map(([k, v]) => `${k}${v}`).join(" / ")}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
