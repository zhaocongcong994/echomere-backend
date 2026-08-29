import { createHash } from "node:crypto";

import type {
  AgentTools,
  HexagramResult,
  HexagramRepository,
  HexagramToolResult,
  ProfileSnapshot,
  TimeFlowResult,
  ToolResult,
} from "./types.ts";

const mockHexagramNames = [
  "乾为天",
  "坤为地",
  "水雷屯",
  "山水蒙",
  "水天需",
  "天水讼",
  "地水师",
  "水地比",
] as const;

export class LocalMockAgentTools implements AgentTools {
  readonly source = "mock" as const;
  private readonly profiles: ProfileSnapshot[];
  private readonly hexagrams: HexagramRepository;

  constructor(
    profiles: ProfileSnapshot[] = [],
    options?: { hexagrams?: HexagramRepository },
  ) {
    this.profiles = profiles.map((profile) => structuredClone(profile));
    this.hexagrams = options?.hexagrams ?? new MemoryHexagramRepository();
  }

  async getProfileSnapshot(input: {
    userId: string;
    profileId?: string;
  }): Promise<ToolResult<ProfileSnapshot> | null> {
    const profile = this.profiles.find(
      (candidate) =>
        candidate.userId === input.userId &&
        (!input.profileId || candidate.profileId === input.profileId),
    );

    if (!profile) return null;

    return {
      data: structuredClone(profile),
      summary: `已加载 ${profile.subjectName} 的本地档案快照 v${profile.version}。`,
      promptContext: [
        "【本地 Mock 档案快照】",
        `快照编号：${profile.id}`,
        ...profile.facts.map((fact) => `- ${fact}`),
      ].join("\n"),
      evidenceRef: `profile_snapshot:${profile.id}`,
    };
  }

  async getTimeFlow(input: {
    profile: ProfileSnapshot;
    at: Date;
  }): Promise<ToolResult<TimeFlowResult>> {
    const period = input.at.toISOString().slice(0, 10);
    const result: TimeFlowResult = {
      id: `mock-flow-${input.profile.id}-${period}`,
      profileSnapshotId: input.profile.id,
      period,
      source: "mock",
      facts: [
        "这是用于验证工具链的模拟时间流，不是真实排盘结果。",
        "解读时必须明确标注 Mock，不能据此作现实判断。",
      ],
    };

    return {
      data: result,
      summary: `已生成 ${period} 的本地模拟时间流。`,
      promptContext: [
        "【本地 Mock 时间流】",
        `日期：${period}`,
        ...result.facts.map((fact) => `- ${fact}`),
      ].join("\n"),
      evidenceRef: `time_flow:${result.id}`,
    };
  }

  async getOrCastHexagram(input: {
    conversationId: string;
    question: string;
    at: Date;
  }): Promise<HexagramToolResult> {
    const existing = await this.hexagrams.findByConversationId(input.conversationId);
    if (existing) {
      return this.toHexagramToolResult(existing, true);
    }

    const digest = createHash("sha256")
      .update(`${input.conversationId}:${input.question}`)
      .digest();
    const primaryIndex = (digest[0] ?? 0) % mockHexagramNames.length;
    const changedIndex = (digest[1] ?? 1) % mockHexagramNames.length;
    const movingLine = ((digest[2] ?? 0) % 6) + 1;
    const result: HexagramResult = {
      id: `mock-hexagram-${digest.toString("hex").slice(0, 12)}`,
      conversationId: input.conversationId,
      question: input.question,
      primaryHexagram: mockHexagramNames[primaryIndex] ?? "乾为天",
      changedHexagram: mockHexagramNames[changedIndex] ?? "坤为地",
      movingLines: [movingLine],
      source: "mock",
      createdAt: input.at.toISOString(),
    };

    const stored = await this.hexagrams.insertIfAbsent(result);
    return this.toHexagramToolResult(stored, stored.id !== result.id);
  }

  private toHexagramToolResult(
    result: HexagramResult,
    reused: boolean,
  ): HexagramToolResult {
    return {
      data: structuredClone(result),
      reused,
      summary: reused
        ? `已复用当前对话的本地模拟卦象 ${result.primaryHexagram}。`
        : `已创建本地模拟卦象 ${result.primaryHexagram}。`,
      promptContext: [
        "【本地 Mock 卦象】",
        `本卦：${result.primaryHexagram}`,
        `变卦：${result.changedHexagram}`,
        `动爻：${result.movingLines.join("、")}`,
        `原始问题：${result.question}`,
        "- 这是工具链测试数据，不是真实起卦结果。",
      ].join("\n"),
      evidenceRef: `hexagram:${result.id}`,
    };
  }
}

class MemoryHexagramRepository implements HexagramRepository {
  private readonly records = new Map<string, HexagramResult>();

  async findByConversationId(conversationId: string): Promise<HexagramResult | null> {
    const result = this.records.get(conversationId);
    return result ? structuredClone(result) : null;
  }

  async insertIfAbsent(result: HexagramResult): Promise<HexagramResult> {
    const existing = this.records.get(result.conversationId);
    if (existing) return structuredClone(existing);

    this.records.set(result.conversationId, structuredClone(result));
    return structuredClone(result);
  }
}

export function createLocalProfileFixture(userId = "local-user"): ProfileSnapshot {
  return {
    id: "local-profile-snapshot-v1",
    profileId: "local-profile",
    userId,
    subjectName: "本地测试用户",
    version: 1,
    timezone: "Asia/Shanghai",
    source: "mock",
    facts: [
      "档案数据为本地模拟数据。",
      "尚未连接真实出生信息和命盘计算引擎。",
    ],
    createdAt: "2026-08-27T00:00:00.000Z",
  };
}
