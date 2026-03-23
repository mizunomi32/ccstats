import type { D1Database } from "@cloudflare/workers-types";
import type { SessionRow } from "../types/db";
import type { CreateSessionRequest } from "../types/api";
import { ulid } from "ulid";

export class SessionRepository {
  constructor(private db: D1Database) {}

  async create(data: CreateSessionRequest): Promise<SessionRow> {
    const id = ulid();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO sessions (id, session_id, cwd, git_branch, claude_version, model,
         input_tokens, output_tokens, cache_read_tokens, duration_seconds,
         started_at, ended_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        data.session_id,
        data.cwd,
        data.git_branch ?? null,
        data.claude_version ?? null,
        data.model ?? null,
        data.input_tokens,
        data.output_tokens,
        data.cache_read_tokens,
        data.duration_seconds ?? null,
        data.started_at,
        data.ended_at,
        now
      )
      .run();

    // ツール呼び出しを一括INSERT
    if (data.tool_calls.length > 0) {
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO tool_calls (session_id, tool_name, call_count)
         VALUES (?, ?, ?)`
      );
      await this.db.batch(
        data.tool_calls.map((tc) =>
          stmt.bind(data.session_id, tc.tool_name, tc.call_count)
        )
      );
    }

    return {
      id,
      session_id: data.session_id,
      cwd: data.cwd,
      git_branch: data.git_branch ?? null,
      claude_version: data.claude_version ?? null,
      model: data.model ?? null,
      input_tokens: data.input_tokens,
      output_tokens: data.output_tokens,
      cache_read_tokens: data.cache_read_tokens,
      duration_seconds: data.duration_seconds ?? null,
      started_at: data.started_at,
      ended_at: data.ended_at,
      created_at: now,
    };
  }

  async list(params: {
    from: string;
    to: string;
    cwd?: string;
    limit: number;
    offset: number;
  }): Promise<{ sessions: SessionRow[]; total: number }> {
    const conditions = ["started_at >= ?", "started_at <= ?"];
    const binds: unknown[] = [params.from, params.to];

    if (params.cwd) {
      conditions.push("cwd = ?");
      binds.push(params.cwd);
    }

    const where = conditions.join(" AND ");

    const countResult = await this.db
      .prepare(`SELECT COUNT(*) as count FROM sessions WHERE ${where}`)
      .bind(...binds)
      .first<{ count: number }>();

    const sessions = await this.db
      .prepare(
        `SELECT * FROM sessions WHERE ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`
      )
      .bind(...binds, params.limit, params.offset)
      .all<SessionRow>();

    return {
      sessions: sessions.results,
      total: countResult?.count ?? 0,
    };
  }

  async getById(sessionId: string): Promise<SessionRow | null> {
    return this.db
      .prepare(`SELECT * FROM sessions WHERE session_id = ?`)
      .bind(sessionId)
      .first<SessionRow>();
  }
}
