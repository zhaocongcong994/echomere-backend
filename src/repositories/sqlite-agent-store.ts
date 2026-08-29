import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  AgentResult,
  AgentRunRecord,
  AgentState,
  AgentContextSnapshot,
} from "../agent/types.ts";
import type { HexagramRepository, HexagramResult } from "../tools/types.ts";
import { ConversationModeConflictError } from "./types.ts";
import type {
  AgentRunRepository,
  ConversationMessageRecord,
  ConversationRecord,
  ConversationRepository,
  ConversationWithMessages,
  StoredToolRun,
  ToolRunRecord,
  ToolRunRepository,
} from "./types.ts";

type DatabaseRow = Record<string, unknown>;

export class SqliteAgentStore
  implements
    AgentRunRepository,
    ConversationRepository,
    ToolRunRepository,
    HexagramRepository
{
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(resolve(databasePath)), { recursive: true });
    }

    this.database = new DatabaseSync(databasePath, { timeout: 5_000 });
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA synchronous = NORMAL");
    this.migrate();
  }

  close(): void {
    if (this.database.isOpen) this.database.close();
  }

  healthCheck(): void {
    this.database.prepare("SELECT 1 AS ok").get();
  }

  async findByClientRequestId(
    clientRequestId: string,
  ): Promise<AgentRunRecord | null> {
    const row = this.database
      .prepare("SELECT * FROM agent_runs WHERE client_request_id = ?")
      .get(clientRequestId) as DatabaseRow | undefined;
    return row ? mapAgentRun(row) : null;
  }

  async create(record: AgentRunRecord): Promise<void> {
    this.database
      .prepare(`
        INSERT INTO agent_runs (
          id, client_request_id, user_id, conversation_id,
          requested_mode, resolved_mode, route_reason, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.clientRequestId,
        record.userId,
        record.conversationId,
        record.requestedMode,
        record.resolvedMode,
        record.routeReason,
        record.status,
        record.createdAt.toISOString(),
        record.updatedAt.toISOString(),
      );
  }

  async updateStatus(runId: string, status: AgentState): Promise<void> {
    const result = this.database
      .prepare("UPDATE agent_runs SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), runId);
    if (result.changes === 0) throw new Error(`Agent run not found: ${runId}`);
  }

  async saveContext(
    runId: string,
    promptVersion: string,
    snapshot: AgentContextSnapshot,
  ): Promise<void> {
    const result = this.database
      .prepare(`
        UPDATE agent_runs
        SET prompt_version = ?, context_snapshot_json = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        promptVersion,
        JSON.stringify(snapshot),
        new Date().toISOString(),
        runId,
      );
    if (result.changes === 0) throw new Error(`Agent run not found: ${runId}`);
  }

  async getMetadata(
    conversationId: string,
    userId: string,
  ): Promise<ConversationRecord | null> {
    const row = this.database
      .prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?")
      .get(conversationId, userId) as DatabaseRow | undefined;
    if (!row) return null;
    if (typeof row.resolved_mode !== "string") return null;
    return {
      id: asString(row.id),
      userId: asString(row.user_id),
      resolvedMode: asString(row.resolved_mode) as ConversationRecord["resolvedMode"],
      createdAt: new Date(asString(row.created_at)),
      updatedAt: new Date(asString(row.updated_at)),
    };
  }

  async complete(runId: string, result: AgentResult): Promise<void> {
    const update = this.database
      .prepare(`
        UPDATE agent_runs
        SET status = 'completed', result_json = ?, error_code = NULL, updated_at = ?
        WHERE id = ?
      `)
      .run(JSON.stringify(result), new Date().toISOString(), runId);
    if (update.changes === 0) throw new Error(`Agent run not found: ${runId}`);
  }

  async fail(runId: string, errorCode: string): Promise<void> {
    const result = this.database
      .prepare(`
        UPDATE agent_runs
        SET status = 'failed', error_code = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(errorCode, new Date().toISOString(), runId);
    if (result.changes === 0) throw new Error(`Agent run not found: ${runId}`);
  }

  async ensure(record: ConversationRecord): Promise<void> {
    this.database
      .prepare(`
        INSERT OR IGNORE INTO conversations (
          id, user_id, resolved_mode, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.userId,
        record.resolvedMode,
        record.createdAt.toISOString(),
        record.updatedAt.toISOString(),
      );

    const existing = this.database
      .prepare("SELECT user_id, resolved_mode FROM conversations WHERE id = ?")
      .get(record.id) as DatabaseRow | undefined;
    if (!existing || existing.user_id !== record.userId) {
      throw new Error("Conversation ownership mismatch.");
    }
    if (typeof existing.resolved_mode !== "string") {
      this.database
        .prepare("UPDATE conversations SET resolved_mode = ? WHERE id = ?")
        .run(record.resolvedMode, record.id);
    } else if (existing.resolved_mode !== record.resolvedMode) {
      throw new ConversationModeConflictError(
        existing.resolved_mode as ConversationRecord["resolvedMode"],
        record.resolvedMode,
      );
    }

    this.database
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(record.updatedAt.toISOString(), record.id);
  }

  async appendMessage(record: ConversationMessageRecord): Promise<void> {
    const conversation = this.database
      .prepare("SELECT user_id FROM conversations WHERE id = ?")
      .get(record.conversationId) as DatabaseRow | undefined;
    if (!conversation || conversation.user_id !== record.userId) {
      throw new Error("Conversation ownership mismatch.");
    }

    this.database
      .prepare(`
        INSERT INTO messages (
          id, conversation_id, user_id, role, content, agent_run_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.conversationId,
        record.userId,
        record.role,
        record.content,
        record.agentRunId,
        record.createdAt.toISOString(),
      );
    this.database
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(record.createdAt.toISOString(), record.conversationId);
  }

  async getWithMessages(
    conversationId: string,
    userId: string,
  ): Promise<ConversationWithMessages | null> {
    const conversation = this.database
      .prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?")
      .get(conversationId, userId) as DatabaseRow | undefined;
    if (!conversation) return null;
    if (typeof conversation.resolved_mode !== "string") return null;

    const messages = this.database
      .prepare(`
        SELECT * FROM messages
        WHERE conversation_id = ? AND user_id = ?
        ORDER BY rowid ASC
      `)
      .all(conversationId, userId) as DatabaseRow[];

    return {
      id: asString(conversation.id),
      userId: asString(conversation.user_id),
      resolvedMode: conversation.resolved_mode as ConversationRecord["resolvedMode"],
      createdAt: new Date(asString(conversation.created_at)),
      updatedAt: new Date(asString(conversation.updated_at)),
      messages: messages.map(mapMessage),
    };
  }

  async startTool(record: ToolRunRecord): Promise<void> {
    this.database
      .prepare(`
        INSERT INTO tool_runs (
          id, agent_run_id, tool_name, display_name, status,
          input_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.agentRunId,
        record.toolName,
        record.displayName,
        record.status,
        JSON.stringify(record.input ?? null),
        record.createdAt.toISOString(),
        record.updatedAt.toISOString(),
      );
  }

  async completeTool(
    toolRunId: string,
    output: { summary: string; evidenceRef?: string; result: unknown },
  ): Promise<void> {
    const update = this.database
      .prepare(`
        UPDATE tool_runs
        SET status = 'completed', summary = ?, evidence_ref = ?, result_json = ?,
            error_code = NULL, updated_at = ?
        WHERE id = ?
      `)
      .run(
        output.summary,
        output.evidenceRef ?? null,
        JSON.stringify(output.result ?? null),
        new Date().toISOString(),
        toolRunId,
      );
    if (update.changes === 0) throw new Error(`Tool run not found: ${toolRunId}`);
  }

  async failTool(toolRunId: string, errorCode: string): Promise<void> {
    const update = this.database
      .prepare(`
        UPDATE tool_runs
        SET status = 'failed', error_code = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(errorCode, new Date().toISOString(), toolRunId);
    if (update.changes === 0) throw new Error(`Tool run not found: ${toolRunId}`);
  }

  async listToolRunsByAgentRunId(agentRunId: string): Promise<StoredToolRun[]> {
    const rows = this.database
      .prepare("SELECT * FROM tool_runs WHERE agent_run_id = ? ORDER BY created_at, id")
      .all(agentRunId) as DatabaseRow[];
    return rows.map(mapToolRun);
  }

  async findByConversationId(
    conversationId: string,
  ): Promise<HexagramResult | null> {
    const row = this.database
      .prepare("SELECT result_json FROM hexagrams WHERE conversation_id = ?")
      .get(conversationId) as DatabaseRow | undefined;
    return row ? (JSON.parse(asString(row.result_json)) as HexagramResult) : null;
  }

  async insertIfAbsent(result: HexagramResult): Promise<HexagramResult> {
    this.database
      .prepare(`
        INSERT OR IGNORE INTO hexagrams (conversation_id, result_json, created_at)
        VALUES (?, ?, ?)
      `)
      .run(result.conversationId, JSON.stringify(result), result.createdAt);

    const stored = await this.findByConversationId(result.conversationId);
    if (!stored) throw new Error("Failed to persist hexagram.");
    return stored;
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        resolved_mode TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        client_request_id TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        requested_mode TEXT NOT NULL,
        resolved_mode TEXT NOT NULL,
        route_reason TEXT NOT NULL,
        status TEXT NOT NULL,
        result_json TEXT,
        error_code TEXT,
        prompt_version TEXT,
        context_snapshot_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        agent_run_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id),
        FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS tool_runs (
        id TEXT PRIMARY KEY,
        agent_run_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        input_json TEXT NOT NULL,
        result_json TEXT,
        summary TEXT,
        evidence_ref TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS hexagrams (
        conversation_id TEXT PRIMARY KEY,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation
        ON agent_runs(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_tool_runs_agent_run
        ON tool_runs(agent_run_id, created_at);
    `);

    const conversationColumns = this.database
      .prepare("PRAGMA table_info(conversations)")
      .all() as DatabaseRow[];
    if (!conversationColumns.some((column) => column.name === "resolved_mode")) {
      this.database.exec("ALTER TABLE conversations ADD COLUMN resolved_mode TEXT");
    }

    const runColumns = this.database
      .prepare("PRAGMA table_info(agent_runs)")
      .all() as DatabaseRow[];
    if (!runColumns.some((column) => column.name === "prompt_version")) {
      this.database.exec("ALTER TABLE agent_runs ADD COLUMN prompt_version TEXT");
    }
    if (!runColumns.some((column) => column.name === "context_snapshot_json")) {
      this.database.exec("ALTER TABLE agent_runs ADD COLUMN context_snapshot_json TEXT");
    }

    this.database.exec(`
      UPDATE conversations
      SET resolved_mode = (
        SELECT resolved_mode FROM agent_runs
        WHERE agent_runs.conversation_id = conversations.id
        ORDER BY agent_runs.created_at ASC
        LIMIT 1
      )
      WHERE resolved_mode IS NULL
    `);
  }
}

function mapAgentRun(row: DatabaseRow): AgentRunRecord {
  const resultJson = row.result_json;
  return {
    id: asString(row.id),
    clientRequestId: asString(row.client_request_id),
    userId: asString(row.user_id),
    conversationId: asString(row.conversation_id),
    requestedMode: asString(row.requested_mode) as AgentRunRecord["requestedMode"],
    resolvedMode: asString(row.resolved_mode) as AgentRunRecord["resolvedMode"],
    routeReason: asString(row.route_reason),
    status: asString(row.status) as AgentState,
    createdAt: new Date(asString(row.created_at)),
    updatedAt: new Date(asString(row.updated_at)),
    ...(typeof row.prompt_version === "string"
      ? { promptVersion: row.prompt_version }
      : {}),
    ...(typeof row.context_snapshot_json === "string"
      ? {
          contextSnapshot: JSON.parse(
            row.context_snapshot_json,
          ) as AgentContextSnapshot,
        }
      : {}),
    ...(typeof resultJson === "string"
      ? { result: JSON.parse(resultJson) as AgentResult }
      : {}),
    ...(typeof row.error_code === "string" ? { errorCode: row.error_code } : {}),
  };
}

function mapMessage(row: DatabaseRow): ConversationMessageRecord {
  return {
    id: asString(row.id),
    conversationId: asString(row.conversation_id),
    userId: asString(row.user_id),
    role: asString(row.role) as ConversationMessageRecord["role"],
    content: asString(row.content),
    agentRunId: asString(row.agent_run_id),
    createdAt: new Date(asString(row.created_at)),
  };
}

function mapToolRun(row: DatabaseRow): StoredToolRun {
  return {
    id: asString(row.id),
    agentRunId: asString(row.agent_run_id),
    toolName: asString(row.tool_name),
    displayName: asString(row.display_name),
    status: asString(row.status) as StoredToolRun["status"],
    input: JSON.parse(asString(row.input_json)) as unknown,
    createdAt: new Date(asString(row.created_at)),
    updatedAt: new Date(asString(row.updated_at)),
    ...(typeof row.summary === "string" ? { summary: row.summary } : {}),
    ...(typeof row.evidence_ref === "string"
      ? { evidenceRef: row.evidence_ref }
      : {}),
    ...(typeof row.result_json === "string"
      ? { result: JSON.parse(row.result_json) as unknown }
      : {}),
    ...(typeof row.error_code === "string" ? { errorCode: row.error_code } : {}),
  };
}

function asString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid SQLite row value.");
  return value;
}
