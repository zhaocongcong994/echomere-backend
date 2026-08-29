"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, CheckCircle2, ChevronLeft, Loader2, Orbit, User, CalendarDays, CreditCard, LogOut, Cpu } from "lucide-react";

interface SettingsProfile {
  user?: { email?: string | null; name?: string | null };
  primaryProfile?: { id: string } | null;
  bazi?: {
    year?: string;
    month?: string;
    day?: string;
    hour?: string;
    dayMaster?: { gan?: string; zhi?: string; wuxing?: string };
    genderLabel?: string;
  } | null;
}

interface AgentRuntime {
  provider: string;
  model: string;
  modelSelection: "legacy-env" | "profile-file";
  activeProfileId: string;
  profiles: Array<{
    id: string;
    label: string;
    provider: string;
    model: string;
    configured: boolean;
    active: boolean;
  }>;
  restartRequiredToSwitch: boolean;
  switching: {
    enabled: boolean;
    access: "admin" | "read-only";
    mode?: "disabled" | "local" | "service";
    persistsAcrossRestart: boolean;
    validation: "provider-model-list" | "none";
  };
  limits: {
    maxInputCharacters: number | null;
    maxOutputTokens: number | null;
  };
  retry: {
    maxRetries: number;
    onlyBeforeFirstOutput: boolean;
  };
  quality?: {
    maxRewrites: number;
    buffersDraftUntilValidated: boolean;
  };
  thinking: { mode: "enabled" | "disabled" };
}

export default function SettingsPage() {
  const router = useRouter();
  const { logout } = useAuth();
  const [profile, setProfile] = useState<SettingsProfile | null>(null);
  const [agentRuntime, setAgentRuntime] = useState<AgentRuntime | null>(null);
  const [switchingProfileId, setSwitchingProfileId] = useState<string | null>(null);
  const [modelSwitchMessage, setModelSwitchMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch("/profile")
        .then((response) => response.json())
        .then((data) => setProfile(data))
        .catch(() => setProfile(null)),
      apiFetch("/agent/runtime")
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => setAgentRuntime(data))
        .catch(() => setAgentRuntime(null)),
    ]).finally(() => setLoading(false));
  }, []);

  const switchModelProfile = async (profileId: string) => {
    setSwitchingProfileId(profileId);
    setModelSwitchMessage(null);
    try {
      const response = await apiFetch("/agent/runtime/profile", {
        method: "POST",
        body: JSON.stringify({ profileId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(modelSwitchErrorMessage(data?.error));
      }
      const runtime = data as AgentRuntime;
      setAgentRuntime(runtime);
      const selected = runtime.profiles.find((item) => item.active);
      setModelSwitchMessage({
        type: "success",
        text: `已切换到 ${selected?.label ?? runtime.model}，新的对话请求会立即使用该模型。`,
      });
    } catch (error) {
      setModelSwitchMessage({
        type: "error",
        text: error instanceof Error ? error.message : "模型切换失败，请稍后重试。",
      });
    } finally {
      setSwitchingProfileId(null);
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
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/chat")}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="font-medium">设置</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <section className="bg-white rounded-2xl border border-stone-100 p-6">
          <h2 className="text-lg font-medium mb-4">个人资料</h2>
          <div className="space-y-4">
            <div>
              <Label>邮箱</Label>
              <Input value={profile?.user?.email || ""} disabled />
            </div>
            <div>
              <Label>昵称</Label>
              <Input value={profile?.user?.name || ""} disabled />
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-stone-100 p-6">
          <h2 className="text-lg font-medium mb-4">命理档案</h2>
          {profile?.primaryProfile ? (
            <div className="space-y-2 text-sm">
              <div className="text-2xl tracking-widest font-medium">
                {profile.bazi?.year} · {profile.bazi?.month} · {profile.bazi?.day} · {profile.bazi?.hour}
              </div>
              <div className="text-stone-500">
                日主：{profile.bazi?.dayMaster?.gan}{profile.bazi?.dayMaster?.zhi}（{profile.bazi?.dayMaster?.wuxing}） · {profile.bazi?.genderLabel}
              </div>
            </div>
          ) : (
            <p className="text-stone-500 text-sm">尚未创建命盘档案</p>
          )}
          <Button className="mt-4" onClick={() => router.push("/onboarding")}>
            {profile?.primaryProfile ? "重新创建" : "创建命盘"}
          </Button>
        </section>

        <section className="bg-white rounded-2xl border border-stone-100 p-6 space-y-3">
          <h2 className="text-lg font-medium mb-2">功能入口</h2>
          <Button variant="outline" className="w-full justify-start gap-2" onClick={() => router.push("/nebula")}>
            <Orbit className="w-4 h-4" /> 人生星云图
          </Button>
          <Button variant="outline" className="w-full justify-start gap-2" onClick={() => router.push("/profiles")}>
            <User className="w-4 h-4" /> 命运档案
          </Button>
          <Button variant="outline" className="w-full justify-start gap-2" onClick={() => router.push("/daily-fortune")}>
            <CalendarDays className="w-4 h-4" /> 每日运势
          </Button>
          <Button variant="outline" className="w-full justify-start gap-2" onClick={() => router.push("/subscription")}>
            <CreditCard className="w-4 h-4" /> 订阅管理
          </Button>
        </section>

        <section className="bg-white rounded-2xl border border-stone-100 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Cpu className="w-5 h-5 text-stone-500" />
            <h2 className="text-lg font-medium">Agent 运行状态</h2>
          </div>
          {agentRuntime ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <RuntimeItem label="当前模型" value={agentRuntime.model} />
                <RuntimeItem label="Provider" value={agentRuntime.provider} />
                <RuntimeItem
                  label="输入预算"
                  value={agentRuntime.limits.maxInputCharacters?.toLocaleString() ?? "未设置"}
                />
                <RuntimeItem
                  label="输出上限"
                  value={agentRuntime.limits.maxOutputTokens?.toLocaleString() ?? "未设置"}
                />
                <RuntimeItem
                  label="故障重试"
                  value={`${agentRuntime.retry.maxRetries} 次`}
                />
                <RuntimeItem
                  label="质量重写"
                  value={`${agentRuntime.quality?.maxRewrites ?? 0} 次`}
                />
                <RuntimeItem
                  label="首稿保护"
                  value={
                    agentRuntime.quality?.buffersDraftUntilValidated
                      ? "验证后展示"
                      : "未开启"
                  }
                />
                <RuntimeItem
                  label="思考模式"
                  value={agentRuntime.thinking.mode === "enabled" ? "已开启" : "已关闭"}
                />
              </div>

              <div>
                <div className="text-xs text-stone-400 mb-2">模型配置档案</div>
                <div className="space-y-2">
                  {agentRuntime.profiles.map((modelProfile) => (
                    <div
                      key={modelProfile.id}
                      className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2"
                    >
                      <div>
                        <div className="font-medium text-stone-700">
                          {modelProfile.label}
                        </div>
                        <div className="text-xs text-stone-400">
                          {modelProfile.provider} · {modelProfile.model}
                        </div>
                      </div>
                      {modelProfile.active ? (
                        <span className="text-xs rounded-full px-2 py-1 bg-emerald-50 text-emerald-700">
                          使用中
                        </span>
                      ) : modelProfile.configured && agentRuntime.switching.enabled ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={switchingProfileId !== null}
                          onClick={() => switchModelProfile(modelProfile.id)}
                        >
                          {switchingProfileId === modelProfile.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : null}
                          {switchingProfileId === modelProfile.id ? "校验中" : "切换"}
                        </Button>
                      ) : (
                        <span
                          className={`text-xs rounded-full px-2 py-1 ${
                            modelProfile.configured
                              ? "bg-stone-100 text-stone-500"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {modelProfile.configured
                            ? agentRuntime.switching.access === "read-only"
                              ? "仅管理员"
                              : "重启后可用"
                            : "待配置 Key"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {modelSwitchMessage ? (
                <div
                  role="status"
                  className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs leading-5 ${
                    modelSwitchMessage.type === "success"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-600"
                  }`}
                >
                  {modelSwitchMessage.type === "success" ? (
                    <CheckCircle2 className="mt-0.5 w-4 h-4" />
                  ) : (
                    <AlertCircle className="mt-0.5 w-4 h-4" />
                  )}
                  <span>{modelSwitchMessage.text}</span>
                </div>
              ) : null}

              <p className="text-xs leading-5 text-stone-400">
                {agentRuntime.switching.access === "read-only"
                  ? "你可以查看 Agent 运行状态；只有模型管理员可以切换运行中的模型。"
                  : agentRuntime.switching.enabled
                  ? `切换前会校验目标模型，成功后立即生效${agentRuntime.switching.persistsAcrossRestart ? "并在重启后保留" : ""}；正在生成的回答不受影响。`
                  : "运行时切换开关尚未完全开启；密钥不会返回到浏览器。"}
              </p>
            </div>
          ) : (
            <p className="text-sm text-stone-500">
              暂时无法读取 Agent 运行信息，聊天功能不一定受影响。
            </p>
          )}
        </section>

        <Separator />

        <Button variant="outline" className="w-full" onClick={() => router.push("/chat")}>
          返回聊天
        </Button>

        <Button variant="ghost" className="w-full text-stone-500" onClick={logout}>
          <LogOut className="w-4 h-4 mr-2" /> 退出登录
        </Button>
      </main>
    </div>
  );
}

function modelSwitchErrorMessage(code: unknown): string {
  switch (code) {
    case "agent_profile_switch_disabled":
      return "本地模型切换开关尚未启用。";
    case "agent_profile_switch_forbidden":
      return "当前账号不在模型管理员名单中。";
    case "agent_profile_switch_in_progress":
      return "已有模型正在切换，请稍后重试。";
    case "agent_profile_not_found":
      return "目标模型档案不存在，请刷新页面后重试。";
    case "agent_profile_not_configured":
      return "目标模型尚未配置 API Key。";
    case "agent_profile_validation_failed":
      return "目标模型连接或可用性校验失败，当前模型保持不变。";
    case "agent_profile_persistence_failed":
      return "目标模型通过校验，但本地选择无法保存，当前模型保持不变。";
    default:
      return "模型切换失败，当前模型保持不变。";
  }
}

function RuntimeItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-stone-50 px-3 py-3">
      <div className="text-xs text-stone-400 mb-1">{label}</div>
      <div className="font-medium text-stone-700 break-all">{value}</div>
    </div>
  );
}
