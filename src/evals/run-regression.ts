import { pathToFileURL } from "node:url";

import { runAgent } from "../agent/run-agent.ts";
import type {
  AgentAnalysisTopic,
  AgentEvent,
  AgentMode,
  ResolvedAgentMode,
} from "../agent/types.ts";
import { loadLocalEnv } from "../config/load-local-env.ts";
import { loadModelProfileCatalog } from "../config/model-profiles.ts";
import type { LLMProvider } from "../providers/llm-provider.ts";
import { MockLLMProvider } from "../providers/mock-provider.ts";
import { createLLMProvider } from "../providers/provider-factory.ts";
import { SqliteAgentStore } from "../repositories/sqlite-agent-store.ts";
import {
  createLocalProfileFixture,
  LocalMockAgentTools,
} from "../tools/local-mock-tools.ts";

interface RegressionCase {
  id: string;
  mode: AgentMode;
  message: string;
  expectedMode: ResolvedAgentMode;
  expectedToolRuns: number;
  expectedTopic: AgentAnalysisTopic;
}

export interface RegressionCaseResult {
  id: string;
  passed: boolean;
  requestedMode: AgentMode;
  resolvedMode?: ResolvedAgentMode;
  durationMs: number;
  toolRuns: number;
  evidenceCount: number;
  contentCharacters: number;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
  failureCode?: string;
  checks: Record<string, boolean>;
}

export interface RegressionReport {
  provider: string;
  model: string;
  live: boolean;
  passed: number;
  failed: number;
  totalDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cases: RegressionCaseResult[];
}

const regressionCases: RegressionCase[] = [
  {
    id: "qingting-support",
    mode: "qingting",
    message: "最近工作压力很大，总觉得自己做得不够好。",
    expectedMode: "qingting",
    expectedToolRuns: 0,
    expectedTopic: "emotion",
  },
  {
    id: "kanyun-career",
    mode: "kanyun",
    message: "请结合档案看看今年的事业节奏和需要注意的风险。",
    expectedMode: "kanyun",
    expectedToolRuns: 2,
    expectedTopic: "career",
  },
  {
    id: "kanyun-timeless-strengths",
    mode: "kanyun",
    message: "我在职场中的核心优势是什么？",
    expectedMode: "kanyun",
    expectedToolRuns: 1,
    expectedTopic: "career",
  },
  {
    id: "wenshi-decision",
    mode: "wenshi",
    message: "我是否应该接受这份新工作？请说明可以验证的风险。",
    expectedMode: "wenshi",
    expectedToolRuns: 1,
    expectedTopic: "decision",
  },
  {
    id: "suiyuan-routing",
    mode: "suiyuan",
    message: "最近心里很乱，想先找人聊聊。",
    expectedMode: "qingting",
    expectedToolRuns: 0,
    expectedTopic: "emotion",
  },
  {
    id: "suiyuan-fortune-routing",
    mode: "suiyuan",
    message: "我想看看明年的财运节奏。",
    expectedMode: "kanyun",
    expectedToolRuns: 2,
    expectedTopic: "wealth",
  },
  {
    id: "suiyuan-decision-routing",
    mode: "suiyuan",
    message: "我是否应该接受这份合作？",
    expectedMode: "wenshi",
    expectedToolRuns: 1,
    expectedTopic: "decision",
  },
  {
    id: "kanyun-relationship-window",
    mode: "kanyun",
    message: "2028 年感情关系中有哪些值得观察的信号？",
    expectedMode: "kanyun",
    expectedToolRuns: 2,
    expectedTopic: "relationship",
  },
];

export async function runRegressionSuite(
  provider: LLMProvider = new MockLLMProvider(),
  options: { live?: boolean } = {},
): Promise<RegressionReport> {
  const store = new SqliteAgentStore(":memory:");
  const tools = new LocalMockAgentTools([createLocalProfileFixture("eval-user")], {
    hexagrams: store,
  });
  const results: RegressionCaseResult[] = [];

  try {
    for (const regressionCase of regressionCases) {
      const startedAt = performance.now();
      const events: AgentEvent[] = [];
      for await (const event of runAgent(
        {
          userId: "eval-user",
          conversationId: `eval-conversation-${regressionCase.id}`,
          clientRequestId: `eval-request-${regressionCase.id}-${Date.now()}`,
          mode: regressionCase.mode,
          message: regressionCase.message,
        },
        {
          provider,
          runs: store,
          conversations: store,
          toolRuns: store,
          tools,
        },
      )) {
        events.push(event);
      }

      const completed = events.find((event) => event.type === "run_completed");
      const failed = events.find((event) => event.type === "run_failed");
      const toolRuns = events.filter((event) => event.type === "tool_completed").length;
      const checks = {
        completed: completed?.type === "run_completed",
        mode:
          completed?.type === "run_completed" &&
          completed.result.resolvedMode === regressionCase.expectedMode,
        toolRuns: toolRuns === regressionCase.expectedToolRuns,
        content:
          completed?.type === "run_completed" &&
          completed.result.contentMarkdown.trim().length >= 20,
        promptVersion:
          completed?.type === "run_completed" &&
          completed.result.promptVersion.length > 0,
        analysisPlan:
          completed?.type === "run_completed" &&
          completed.result.analysisPlan.topics.includes(regressionCase.expectedTopic) &&
          completed.result.analysisPlan.requiredTools.length ===
            regressionCase.expectedToolRuns,
        quality:
          completed?.type === "run_completed" && completed.result.quality.passed,
      };
      results.push({
        id: regressionCase.id,
        passed: Object.values(checks).every(Boolean),
        requestedMode: regressionCase.mode,
        ...(completed?.type === "run_completed"
          ? { resolvedMode: completed.result.resolvedMode }
          : {}),
        durationMs: Math.round(performance.now() - startedAt),
        toolRuns,
        evidenceCount:
          completed?.type === "run_completed" ? completed.result.evidenceRefs.length : 0,
        contentCharacters:
          completed?.type === "run_completed"
            ? completed.result.contentMarkdown.length
            : 0,
        ...(completed?.type === "run_completed" && completed.result.usage
          ? {
              inputTokens: completed.result.usage.inputTokens,
              outputTokens: completed.result.usage.outputTokens,
            }
          : {}),
        ...(completed?.type === "run_completed" && completed.result.finishReason
          ? { finishReason: completed.result.finishReason }
          : {}),
        ...(failed?.type === "run_failed" ? { failureCode: failed.code } : {}),
        checks,
      });
    }
  } finally {
    store.close();
  }

  return {
    provider: provider.name,
    model: provider.model,
    live: options.live === true,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    totalDurationMs: results.reduce((total, result) => total + result.durationMs, 0),
    totalInputTokens: results.reduce(
      (total, result) => total + (result.inputTokens ?? 0),
      0,
    ),
    totalOutputTokens: results.reduce(
      (total, result) => total + (result.outputTokens ?? 0),
      0,
    ),
    cases: results,
  };
}

async function main(): Promise<void> {
  loadLocalEnv();
  const live = process.argv.includes("--live");
  const provider = live
    ? createLLMProvider(loadModelProfileCatalog().activeConfig)
    : new MockLLMProvider();
  if (live && provider.name === "mock") {
    throw new Error(
      "Live regression requires a newly generated LLM_API_KEY in .env.local.",
    );
  }
  const report = await runRegressionSuite(provider, { live });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Regression run failed."}\n`,
    );
    process.exitCode = 1;
  });
}
