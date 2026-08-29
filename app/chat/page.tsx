"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { apiFetch } from "@/lib/api";
import {
  describeChatHttpError,
  describeStreamError,
  JsonSSEParser,
  type ParsedSSEEvent,
} from "@/lib/chat-stream";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  MessageCircle,
  Sparkles,
  User,
  Menu,
  X,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  ChevronDown,
  ChevronUp,
  CalendarDays,
  Orbit,
  CreditCard,
  Home,
  ArrowUp,
} from "lucide-react";

const MODES = [
  { id: "suiyuan", label: "随缘", sub: "AI 自动匹配最佳解读模式" },
  { id: "kanyun", label: "看运", sub: "根据生辰，解读过去、现在与未来" },
  { id: "qingting", label: "倾听", sub: "陪你聊聊，不急于给建议" },
  { id: "wenshi", label: "问事", sub: "一事一占，六爻解读" },
];

const RECOMMENDED_QUESTIONS: Record<string, string[]> = {
  suiyuan: ["我天生适合做什么", "最近感觉不太顺", "这个 offer 该不该接", "我的桃花运怎么样"],
  kanyun: ["分析一下我今年的年度运势", "我的桃花运怎么样", "今年适合换工作吗", "我的财运如何"],
  qingting: ["最近压力好大", "感觉人生没有方向", "和家里人关系很紧张", "最近总是睡不好"],
  wenshi: ["这个 offer 该不该接", "要不要离开这份工作", "今年适合创业吗", "和 TA 合适吗"],
};

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: string;
  thinkingSummary?: string;
  routeReason?: string;
  action?: { label: string; href: string };
}

interface ToolRunEvent {
  type: "tool_started" | "tool_completed";
  toolRunId: string;
  toolName?: string;
  displayName?: string;
  summary?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeToolEvent(data: Record<string, unknown>): ToolRunEvent | null {
  if (
    (data.type !== "tool_started" && data.type !== "tool_completed") ||
    typeof data.toolRunId !== "string"
  ) {
    return null;
  }
  return {
    type: data.type,
    toolRunId: data.toolRunId,
    ...(typeof data.toolName === "string" ? { toolName: data.toolName } : {}),
    ...(typeof data.displayName === "string"
      ? { displayName: data.displayName }
      : {}),
    ...(typeof data.summary === "string" ? { summary: data.summary } : {}),
  };
}

interface Conversation {
  id: string;
  mode: string;
  title: string;
  updatedAt: string;
}

const NAV_ITEMS = [
  { id: "chat", icon: MessageCircle, label: "新对话", href: "/chat" },
  { id: "nebula", icon: Orbit, label: "人生星云图", href: "/nebula" },
  { id: "profiles", icon: User, label: "命运档案", href: "/profiles" },
  { id: "daily-fortune", icon: CalendarDays, label: "每日运势", href: "/daily-fortune" },
  { id: "subscription", icon: CreditCard, label: "订阅", href: "/subscription" },
];

function ChatContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState("suiyuan");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user) fetchConversations();
  }, [user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => () => activeRequestRef.current?.abort(), []);

  useEffect(() => {
    const q = searchParams.get("question");
    if (!q) {
      sessionStorage.removeItem("_ms_autosend_lock");
      return;
    }
    if (!user) return;
    if (sessionStorage.getItem("_ms_autosend_lock")) return;
    sessionStorage.setItem("_ms_autosend_lock", "1");
    const decoded = decodeURIComponent(q);
    // 清除 URL query，避免刷新重复发送
    router.replace("/chat");
    // 使用 setTimeout 确保 input 已更新且组件已渲染
    setTimeout(() => sendMessage(decoded), 0);
  // `sendMessage` intentionally reads the latest conversation state after the
  // query has been consumed; including it would retrigger the one-shot send.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, user, router]);

  async function fetchConversations() {
    const res = await apiFetch("/conversations");
    if (res.ok) {
      const data = await res.json();
      setConversations(data);
    }
  }

  const loadConversation = async (id: string) => {
    const res = await apiFetch(`/conversations/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setCurrentConversationId(data.id);
    setMode(data.mode);
    setMessages(
      data.messages.map((m: Message) => ({
        ...m,
        routeReason: m.toolCalls ? extractRouteReason(m.toolCalls) : undefined,
      }))
    );
    setSidebarOpen(false);
  };

  const startNewChat = () => {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setCurrentConversationId(null);
    setMessages([]);
    setMode("suiyuan");
  };

  const stopStreaming = () => activeRequestRef.current?.abort();

  const extractRouteReason = (): string | undefined => {
    try {
      return undefined;
    } catch {
      return undefined;
    }
  };

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;
    setLoading(true);
    setInput("");

    const userMessage: Message = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMessage]);

    const controller = new AbortController();
    activeRequestRef.current = controller;
    const clientRequestId = globalThis.crypto.randomUUID();
    let assistantMessage: Message | null = null;

    try {
      const res = await apiFetch("/chat/stream", {
        method: "POST",
        headers: { "X-Request-Id": clientRequestId },
        signal: controller.signal,
        body: JSON.stringify({
          mode,
          message: text,
          conversationId: currentConversationId,
          clientRequestId,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: "请求失败" }))) as Record<
          string,
          unknown
        >;
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: describeChatHttpError(res.status, err),
            ...(err.error === "NO_PROFILE"
              ? { action: { label: "前往命运档案", href: "/profiles" } }
              : {}),
          },
        ]);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      const parser = new JsonSSEParser();
      const toolEvents: ToolRunEvent[] = [];
      let terminalSeen = false;
      assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: "",
        thinkingSummary: "思考了片刻",
      };
      setMessages((prev) => [...prev, assistantMessage]);

      if (!reader) {
        throw new Error("Streaming response body is unavailable.");
      }

      const syncAssistant = () => {
        if (!assistantMessage) return;
        const snapshot = { ...assistantMessage };
        setMessages((prev) =>
          prev.map((message) => (message.id === snapshot.id ? snapshot : message))
        );
      };

      const handleEvent = (parsedEvent: ParsedSSEEvent) => {
        if (!assistantMessage) return;
        const data = asRecord(parsedEvent.data);

        if (parsedEvent.event === "meta") {
          if (typeof data.conversationId === "string") {
            setCurrentConversationId(data.conversationId);
          }
          assistantMessage.routeReason =
            typeof data.routeReason === "string" ? data.routeReason : undefined;
          syncAssistant();
          void fetchConversations();
          return;
        }

        if (parsedEvent.event === "tool") {
          const toolEvent = normalizeToolEvent(data);
          if (!toolEvent) return;
          const existingIndex = toolEvents.findIndex(
            (event) => event.toolRunId === toolEvent.toolRunId
          );
          if (existingIndex >= 0) toolEvents[existingIndex] = toolEvent;
          else toolEvents.push(toolEvent);
          assistantMessage.toolCalls = JSON.stringify([
            { name: "Agent执行", result: { events: toolEvents } },
          ]);
          syncAssistant();
          return;
        }

        if (parsedEvent.event === "chunk") {
          assistantMessage.content +=
            typeof data.content === "string" ? data.content : "";
          syncAssistant();
          return;
        }

        if (parsedEvent.event === "waiting_input") {
          terminalSeen = true;
          assistantMessage.thinkingSummary = "需要补充信息后继续";
          assistantMessage.content =
            typeof data.message === "string"
              ? data.message
              : describeStreamError(data);
          const requiredFields = Array.isArray(data.requiredFields)
            ? data.requiredFields
            : [];
          if (requiredFields.includes("profileId")) {
            assistantMessage.action = {
              label: "选择或创建命运档案",
              href: "/profiles",
            };
          }
          syncAssistant();
          return;
        }

        if (parsedEvent.event === "error") {
          terminalSeen = true;
          const errorMessage = describeStreamError(data);
          assistantMessage.thinkingSummary = "本次运行未完成";
          assistantMessage.content = assistantMessage.content
            ? `${assistantMessage.content}\n\n${errorMessage}`
            : errorMessage;
          syncAssistant();
          return;
        }

        if (parsedEvent.event === "done") {
          terminalSeen = true;
          void fetchConversations();
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of parser.push(decoder.decode(value, { stream: true }))) {
          handleEvent(event);
        }
      }
      for (const event of parser.finish(decoder.decode())) {
        handleEvent(event);
      }
      if (!terminalSeen && assistantMessage) {
        assistantMessage.thinkingSummary = "回答意外中断";
        assistantMessage.content = assistantMessage.content
          ? `${assistantMessage.content}\n\n回答意外中断，请重新发送。`
          : "回答意外中断，请重新发送。";
        syncAssistant();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (assistantMessage) {
          const assistantId = assistantMessage.id;
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    content: message.content || "本次回答已停止。",
                    thinkingSummary: "已停止",
                  }
                : message
            )
          );
        }
        return;
      }
      if (assistantMessage) {
        const assistantId = assistantMessage.id;
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: message.content || "网络异常，请重试。",
                  thinkingSummary: "连接已中断",
                }
              : message
          )
        );
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: "网络异常，请重试。",
          },
        ]);
      }
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
      setLoading(false);
    }
  }

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
      </div>
    );
  }

  const renderToolCalls = (msg: Message) => {
    if (!msg.toolCalls && !msg.routeReason) return null;
    try {
      const calls = (msg.toolCalls ? JSON.parse(msg.toolCalls) : []) as Array<{
        name: string;
        parameters?: unknown;
        result?: {
          ganZhi?: string;
          shiShen?: string;
          naYin?: string;
          year?: number;
          originalName?: string;
          changedName?: string;
          originalNumber?: number;
          changedNumber?: number;
          changingYaos?: number[];
          yaos?: Array<{ index: number; type: string; yin: boolean; changing: boolean }>;
          events?: ToolRunEvent[];
        };
      }>;

      const kanyunCalls = calls.filter((c) => c.name === "查询命盘" || c.name === "查询时间流");
      const hexagramCall = calls.find((c) => c.name === "起卦服务");
      const agentTools = calls
        .flatMap((call) => call.result?.events ?? [])
        .filter(
          (event, index, events) =>
            events.findLastIndex((candidate) => candidate.toolRunId === event.toolRunId) ===
            index
        );

      return (
        <div className="space-y-2 my-3">
          {msg.routeReason && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2 text-sm text-blue-700">
              {msg.routeReason}
            </div>
          )}

          {agentTools.map((tool) => (
            <div
              key={tool.toolRunId}
              className="bg-stone-50 border border-stone-100 rounded-lg px-4 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium text-stone-700">
                  {tool.displayName || tool.toolName || "Agent 工具"}
                </span>
                <span className="text-xs text-stone-400">
                  {tool.type === "tool_completed" ? "已完成" : "执行中"}
                </span>
              </div>
              {tool.summary && (
                <div className="text-stone-500 text-xs mt-1">{tool.summary}</div>
              )}
            </div>
          ))}

          {kanyunCalls.map((call, i) => (
            <div key={i} className="bg-stone-50 border border-stone-100 rounded-lg px-4 py-2 text-sm">
              <div className="font-medium text-stone-700">{call.name}</div>
              {call.name === "查询时间流" && call.result && (
                <div className="text-stone-500 text-xs mt-1">
                  {call.result.year}年流年{call.result.ganZhi}{call.result.shiShen}
                  {call.result.naYin}
                </div>
              )}
            </div>
          ))}

          {hexagramCall && hexagramCall.result && (
            <div className="bg-stone-50 border border-stone-100 rounded-lg px-4 py-3 text-sm">
              <div className="font-medium text-stone-700 mb-2">
                起卦结果：{hexagramCall.result.originalName}（第 {hexagramCall.result.originalNumber} 卦）
                {hexagramCall.result.changingYaos && hexagramCall.result.changingYaos.length > 0 && (
                  <span className="text-stone-500 ml-2">
                    → 变卦 {hexagramCall.result.changedName}，动爻 {hexagramCall.result.changingYaos.join(", ")}
                  </span>
                )}
              </div>
              <div className="flex gap-2 text-xs">
                {hexagramCall.result.yaos?.map((y) => (
                  <div
                    key={y.index}
                    className={`px-2 py-1 rounded ${
                      y.changing ? "bg-stone-200 text-stone-800" : "bg-white text-stone-500"
                    }`}
                  >
                    {y.index}爻 {y.type}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    } catch {
      return null;
    }
  };

  return (
    <div className="h-screen flex bg-white">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 bg-stone-50 border-r border-stone-100 transform transition-transform duration-200 md:translate-x-0 md:static ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="h-14 flex items-center justify-between px-4 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            <span className="font-semibold text-sm tracking-[0.12em]">ECHOMERE｜洄映</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 space-y-2">
          <Button variant="outline" className="w-full justify-start gap-2" onClick={() => router.push("/")}>
            <Home className="w-4 h-4" /> 返回首页
          </Button>
          <Button variant="outline" className="w-full justify-start gap-2" onClick={startNewChat}>
            <MessageCircle className="w-4 h-4" /> 新对话
          </Button>
        </div>

        <div className="px-4 py-2 text-xs font-medium text-stone-400">对话记录</div>
        <div className="overflow-y-auto flex-1 px-2 pb-4 space-y-1">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => loadConversation(c.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors ${
                currentConversationId === c.id ? "bg-stone-200" : "hover:bg-stone-100"
              }`}
            >
              <div className="truncate">{c.title}</div>
              <div className="text-xs text-stone-400">
                {c.mode === "kanyun" ? "看运" : c.mode === "qingting" ? "倾听" : c.mode === "wenshi" ? "问事" : "随缘"}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/20 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-stone-100 flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="md:hidden p-2">
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-xs text-emerald-600 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              聊天服务正常，随时为你解惑
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-stone-600 hidden md:inline">{user?.name || user?.email}</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center px-4 text-center">
              <h1 className="text-3xl md:text-5xl font-light mb-4">
                {user?.name || "你好"}
              </h1>
              <p className="text-stone-500 mb-8">慢慢来，洄映会引导你找到答案</p>

              <div className="flex flex-wrap justify-center gap-2 mb-6">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className={`px-4 py-2 rounded-full text-sm border transition-colors ${
                      mode === m.id
                        ? "bg-stone-900 text-white border-stone-900"
                        : "bg-white text-stone-600 border-stone-200 hover:border-stone-300"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div className="w-full max-w-2xl mb-4">
                <div className="relative chat-composer">
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="心有所问，洄映为答…"
                    className="h-12 pr-14 rounded-full border-stone-200 bg-stone-50 chat-composer-input"
                    onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
                    disabled={loading}
                  />
                  <Button
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full chat-composer-send"
                    onClick={() => (loading ? stopStreaming() : sendMessage(input))}
                    disabled={!loading && !input.trim()}
                    aria-label={loading ? "停止回答" : "发送消息"}
                  >
                    {loading ? (
                      <X className="w-[17px] h-[17px]" strokeWidth={1.45} />
                    ) : (
                      <ArrowUp className="w-[17px] h-[17px]" strokeWidth={1.45} />
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-2 max-w-xl">
                {(RECOMMENDED_QUESTIONS[mode as keyof typeof RECOMMENDED_QUESTIONS] || []).map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="px-4 py-2 rounded-full bg-stone-50 border border-stone-100 text-sm text-stone-600 hover:bg-stone-100"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[90%] md:max-w-[80%] rounded-2xl px-5 py-3 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-stone-900 text-white"
                        : "bg-stone-50 text-stone-800 border border-stone-100"
                    }`}
                  >
                    {msg.role === "assistant" && (
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-4 h-4 text-stone-400" />
                        <span className="text-xs text-stone-400">洄映</span>
                      </div>
                    )}

                    {msg.role === "assistant" && msg.thinkingSummary && (
                      <div className="mb-3">
                        <button
                          onClick={() => setExpandedThinking(expandedThinking === msg.id ? null : msg.id)}
                          className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600"
                        >
                          {expandedThinking === msg.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          思考了片刻
                        </button>
                        {expandedThinking === msg.id && (
                          <div className="mt-1 text-xs text-stone-400 bg-white rounded p-2 border border-stone-100">
                            {msg.thinkingSummary}
                          </div>
                        )}
                      </div>
                    )}

                    {msg.role === "assistant" && renderToolCalls(msg)}

                    <div className="whitespace-pre-wrap">{msg.content}</div>

                    {msg.role === "assistant" && msg.action && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => router.push(msg.action!.href)}
                      >
                        {msg.action.label}
                      </Button>
                    )}

                    {msg.role === "assistant" && msg.content && (
                      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-stone-200/60">
                        <button className="text-stone-400 hover:text-stone-600">
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>
                        <button className="text-stone-400 hover:text-stone-600">
                          <ThumbsDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-stone-50 border border-stone-100 rounded-2xl px-5 py-3 text-sm text-stone-400 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> 洄映正在思考…
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {messages.length > 0 && (
          <>
            <Separator />

            <div className="p-4 bg-white">
              <div className="max-w-3xl mx-auto">
                <div className="relative chat-composer">
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="心有所问，洄映为答…"
                    className="h-12 pr-14 rounded-full border-stone-200 bg-stone-50 chat-composer-input"
                    onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
                    disabled={loading}
                  />
                  <Button
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full chat-composer-send"
                    onClick={() => (loading ? stopStreaming() : sendMessage(input))}
                    disabled={!loading && !input.trim()}
                    aria-label={loading ? "停止回答" : "发送消息"}
                  >
                    {loading ? (
                      <X className="w-[17px] h-[17px]" strokeWidth={1.45} />
                    ) : (
                      <ArrowUp className="w-[17px] h-[17px]" strokeWidth={1.45} />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}

        <div className="border-t border-stone-100 py-2">
          <div className="max-w-3xl mx-auto flex justify-center gap-6 text-stone-400">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <button
                  key={item.id}
                  onClick={() => item.href !== "/chat" && router.push(item.href)}
                  title={item.label}
                  className={`hover:text-stone-600 transition-colors ${
                    isActive ? "text-stone-900" : ""
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </button>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-stone-400" /></div>}>
      <ChatContent />
    </Suspense>
  );
}
