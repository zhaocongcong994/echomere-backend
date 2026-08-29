"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { apiFetch } from "@/lib/api";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "验证码错误，测试期固定为 123456");
        setLoading(false);
        return;
      }

      const { token, user } = await res.json();
      login(token, user);

      const callback = searchParams.get("callbackUrl") || "/chat";

      // 检查是否已创建主命盘档案
      const profileRes = await apiFetch("/profile");
      const profileData = await profileRes.json().catch(() => ({}));
      if (!profileData?.primaryProfile) {
        router.push(`/onboarding?callbackUrl=${encodeURIComponent(callback)}`);
        return;
      }

      router.push(callback);
    } catch {
      setError("网络异常，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-stone-100 p-8 shadow-sm">
        <div className="flex items-center justify-center gap-2 mb-6">
          <Sparkles className="w-5 h-5" />
          <span className="font-semibold text-lg tracking-[0.12em]">ECHOMERE｜洄映</span>
        </div>

        <h1 className="text-xl font-medium text-center mb-2">登录或注册</h1>
        <p className="text-sm text-stone-500 text-center mb-6">
          测试期使用邮箱 + 固定验证码 123456
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">邮箱 / 手机号</Label>
            <Input
              id="email"
              type="text"
              placeholder="you@example.com 或 13800138000"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="code">验证码</Label>
            <Input
              id="code"
              type="text"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "继续"}
          </Button>
        </form>

        <p className="text-xs text-stone-400 text-center mt-6">
          登录即表示你同意我们的服务条款与隐私政策
        </p>
      </div>
    </div>
  );
}
