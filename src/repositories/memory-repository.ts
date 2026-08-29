import type {
  AgentContextSnapshot,
  AgentResult,
  AgentRunRecord,
  AgentState,
} from "../agent/types.ts";
import type { AgentRunRepository } from "./types.ts";

export class MemoryAgentRunRepository implements AgentRunRepository {
  private readonly runs = new Map<string, AgentRunRecord>();
  private readonly requestIndex = new Map<string, string>();

  async findByClientRequestId(clientRequestId: string): Promise<AgentRunRecord | null> {
    const runId = this.requestIndex.get(clientRequestId);
    if (!runId) return null;

    const record = this.runs.get(runId);
    return record ? structuredClone(record) : null;
  }

  async create(record: AgentRunRecord): Promise<void> {
    if (this.requestIndex.has(record.clientRequestId)) {
      throw new Error(`Duplicate clientRequestId: ${record.clientRequestId}`);
    }

    this.runs.set(record.id, structuredClone(record));
    this.requestIndex.set(record.clientRequestId, record.id);
  }

  async updateStatus(runId: string, status: AgentState): Promise<void> {
    const record = this.requireRun(runId);
    record.status = status;
    record.updatedAt = new Date();
  }

  async saveContext(
    runId: string,
    promptVersion: string,
    snapshot: AgentContextSnapshot,
  ): Promise<void> {
    const record = this.requireRun(runId);
    record.promptVersion = promptVersion;
    record.contextSnapshot = structuredClone(snapshot);
    record.updatedAt = new Date();
  }

  async complete(runId: string, result: AgentResult): Promise<void> {
    const record = this.requireRun(runId);
    record.status = "completed";
    record.result = structuredClone(result);
    record.updatedAt = new Date();
  }

  async fail(runId: string, errorCode: string): Promise<void> {
    const record = this.requireRun(runId);
    record.status = "failed";
    record.errorCode = errorCode;
    record.updatedAt = new Date();
  }

  private requireRun(runId: string): AgentRunRecord {
    const record = this.runs.get(runId);
    if (!record) throw new Error(`Agent run not found: ${runId}`);
    return record;
  }
}
