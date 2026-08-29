import { createHash } from "node:crypto";

import type {
  BackendBazi,
  BackendProfileBundle,
  EchomereBackendClient,
} from "../backend/backend-client.ts";
import {
  AgentToolError,
  type AgentToolExecutionContext,
  type AgentTools,
  type HexagramToolResult,
  type ProfileSnapshot,
  type TimeFlowResult,
  type ToolResult,
} from "./types.ts";

interface CachedBackendProfile {
  bundle: BackendProfileBundle;
  snapshot: ProfileSnapshot;
}

export class BackendAgentTools implements AgentTools {
  readonly source = "backend" as const;
  private readonly profiles = new Map<string, CachedBackendProfile>();
  private readonly client: EchomereBackendClient;
  private readonly options: { timezone?: string; maxCachedProfiles?: number };

  constructor(
    client: EchomereBackendClient,
    options: { timezone?: string; maxCachedProfiles?: number } = {},
  ) {
    this.client = client;
    this.options = options;
  }

  async getProfileSnapshot(
    input: { userId: string; profileId?: string },
    context?: AgentToolExecutionContext,
  ): Promise<ToolResult<ProfileSnapshot> | null> {
    const bundle = input.profileId
      ? await this.client.getProfile({
          profileId: input.profileId,
          ...(context?.accessToken ? { accessToken: context.accessToken } : {}),
          ...(context?.requestId ? { requestId: context.requestId } : {}),
          ...(context?.signal ? { signal: context.signal } : {}),
        })
      : await this.client.getPrimaryProfile({
          ...(context?.accessToken ? { accessToken: context.accessToken } : {}),
          ...(context?.requestId ? { requestId: context.requestId } : {}),
          ...(context?.signal ? { signal: context.signal } : {}),
        });
    if (!bundle) return null;
    if (bundle.profile.userId !== input.userId) {
      throw new AgentToolError({
        code: "backend_identity_mismatch",
        message: "The authenticated backend profile does not belong to the Agent user.",
        retryable: false,
      });
    }

    const snapshot: ProfileSnapshot = {
      id: `backend-profile:${bundle.profile.id}:${bundle.profile.updatedAt}`,
      profileId: bundle.profile.id,
      userId: bundle.profile.userId,
      subjectName: bundle.profile.name?.trim() || "当前用户",
      version: bundle.bazi.schemaVersion,
      timezone: this.options.timezone ?? "Asia/Shanghai",
      source: "backend",
      facts: [
        `排盘引擎：${bundle.bazi.engine.name} ${bundle.bazi.engine.version}`,
        `四柱：${bundle.bazi.year} ${bundle.bazi.month} ${bundle.bazi.day} ${bundle.bazi.hour}`,
        `日主：${bundle.bazi.dayMaster.gan}${bundle.bazi.dayMaster.wuxing ? `（${bundle.bazi.dayMaster.wuxing}）` : ""}`,
      ],
      createdAt: bundle.profile.updatedAt,
    };

    this.cacheProfile(snapshot.id, { bundle, snapshot });
    return {
      data: snapshot,
      summary: `已从后端加载 ${snapshot.subjectName} 的真实档案和八字盘。`,
      promptContext: [
        `【后端真实排盘】${bundle.bazi.engine.name} ${bundle.bazi.engine.version}（结构版本 ${bundle.bazi.schemaVersion}）`,
        bundle.bazi.canonicalText,
        "【事实边界】以上是后端计算结果；事件判断和现实建议属于解释，必须保留不确定性。",
      ].join("\n\n"),
      evidenceRef: `backend:profile:${bundle.profile.id}:schema:${bundle.bazi.schemaVersion}:updated:${bundle.profile.updatedAt}`,
    };
  }

  async getTimeFlow(
    input: { profile: ProfileSnapshot; at: Date; question?: string },
    _context?: AgentToolExecutionContext,
  ): Promise<ToolResult<TimeFlowResult>> {
    const cached = this.profiles.get(input.profile.id);
    if (!cached) {
      throw new AgentToolError({
        code: "backend_context_missing",
        message: "The backend profile calculation is no longer available in this run.",
        retryable: true,
      });
    }

    const year = extractTargetYear(input.question ?? "", input.at);
    const flow = findYearlyFlow(cached.bundle.bazi, year);
    if (!flow) {
      throw new AgentToolError({
        code: "backend_context_missing",
        message: `The backend profile does not contain a yearly flow for ${year}.`,
        retryable: false,
      });
    }

    const facts = formatFlowFacts(flow);
    const result: TimeFlowResult = {
      id: `backend-flow:${cached.bundle.profile.id}:${year}`,
      profileSnapshotId: input.profile.id,
      period: String(year),
      source: "backend",
      facts,
    };
    return {
      data: result,
      summary: `已从后端排盘结果读取 ${year} 年时间流。`,
      promptContext: [
        `【后端时间流：${year}】`,
        JSON.stringify(flow, null, 2),
        "【事实边界】以上字段来自后端排盘引擎，不得篡改。",
      ].join("\n"),
      evidenceRef: `backend:time-flow:${cached.bundle.profile.id}:${year}:schema:${cached.bundle.bazi.schemaVersion}`,
    };
  }

  async getOrCastHexagram(
    input: { conversationId: string; question: string; at: Date },
    context?: AgentToolExecutionContext,
  ): Promise<HexagramToolResult> {
    const bundle = await this.client.getOrCastHexagram({
      ...input,
      ...(context?.accessToken ? { accessToken: context.accessToken } : {}),
      ...(context?.requestId ? { requestId: context.requestId } : {}),
      ...(context?.signal ? { signal: context.signal } : {}),
    });
    const digest = createHash("sha256")
      .update(bundle.hexagram.canonicalText)
      .digest("hex")
      .slice(0, 16);
    const result = {
      id: `backend-hexagram:${digest}`,
      conversationId: input.conversationId,
      question: input.question,
      primaryHexagram: bundle.hexagram.originalName,
      changedHexagram: bundle.hexagram.changedName,
      movingLines: bundle.hexagram.changingYaos,
      source: "backend" as const,
      createdAt: input.at.toISOString(),
    };
    return {
      data: result,
      reused: bundle.reused,
      summary: bundle.reused
        ? `已复用后端保存的卦象 ${result.primaryHexagram}。`
        : `已由后端起卦服务生成 ${result.primaryHexagram}。`,
      promptContext: [
        `【后端真实六爻盘】${bundle.hexagram.engine.name} ${bundle.hexagram.engine.version}（结构版本 ${bundle.hexagram.schemaVersion}）`,
        bundle.hexagram.canonicalText,
        "【事实边界】卦象与排盘字段是工具事实；吉凶和应期是解释性推断。",
      ].join("\n\n"),
      evidenceRef:
        bundle.evidenceRef ??
        `backend:hexagram:${input.conversationId}:schema:${bundle.hexagram.schemaVersion}:${digest}`,
    };
  }

  private cacheProfile(key: string, value: CachedBackendProfile): void {
    this.profiles.set(key, value);
    const maxSize = this.options.maxCachedProfiles ?? 100;
    while (this.profiles.size > maxSize) {
      const oldest = this.profiles.keys().next().value as string | undefined;
      if (!oldest) break;
      this.profiles.delete(oldest);
    }
  }
}

function extractTargetYear(question: string, at: Date): number {
  const currentYear = at.getFullYear();
  const normalized = question
    .replace(/今年/gu, String(currentYear))
    .replace(/明年/gu, String(currentYear + 1));
  const explicit = normalized.match(/(?:19|20)\d{2}/u);
  return explicit ? Number(explicit[0]) : currentYear;
}

function findYearlyFlow(bazi: BackendBazi, year: number): Record<string, unknown> | null {
  if (!isRecord(bazi.dayun) || !Array.isArray(bazi.dayun.list)) return null;
  for (const period of bazi.dayun.list) {
    if (!isRecord(period) || !Array.isArray(period.liunianList)) continue;
    for (const candidate of period.liunianList) {
      if (isRecord(candidate) && candidate.year === year) return candidate;
    }
  }
  return null;
}

function formatFlowFacts(flow: Record<string, unknown>): string[] {
  const facts: string[] = [];
  if (typeof flow.ganZhi === "string") facts.push(`干支：${flow.ganZhi}`);
  if (typeof flow.tenGod === "string") facts.push(`十神：${flow.tenGod}`);
  if (typeof flow.nayin === "string") facts.push(`纳音：${flow.nayin}`);
  if (typeof flow.diShi === "string") facts.push(`地势：${flow.diShi}`);
  if (Array.isArray(flow.shenSha)) facts.push(`神煞：${flow.shenSha.join("、")}`);
  return facts.length > 0 ? facts : ["后端已返回该年的结构化时间流。"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
