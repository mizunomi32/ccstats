import type { D1Database } from "@cloudflare/workers-types";

interface SummaryRow {
  total_sessions: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_duration_seconds: number;
}

interface ToolSummaryRow {
  tool_name: string;
  total_calls: number;
  session_count: number;
}

interface ProjectSummaryRow {
  cwd: string;
  session_count: number;
}

interface TokenTimeSeriesRow {
  period: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  session_count: number;
}

export class StatsRepository {
  constructor(private db: D1Database) {}

  async getSummary(from: string, to: string): Promise<SummaryRow | null> {
    return this.db
      .prepare(
        `SELECT
          COUNT(*) as total_sessions,
          COALESCE(SUM(input_tokens), 0) as total_input_tokens,
          COALESCE(SUM(output_tokens), 0) as total_output_tokens,
          COALESCE(SUM(cache_read_tokens), 0) as total_cache_read_tokens,
          COALESCE(SUM(duration_seconds), 0) as total_duration_seconds
        FROM sessions
        WHERE started_at >= ? AND started_at <= ?`
      )
      .bind(from, to)
      .first<SummaryRow>();
  }

  async getTopTools(
    from: string,
    to: string,
    limit = 10
  ): Promise<ToolSummaryRow[]> {
    const result = await this.db
      .prepare(
        `SELECT
          tc.tool_name,
          SUM(tc.call_count) as total_calls,
          COUNT(DISTINCT tc.session_id) as session_count
        FROM tool_calls tc
        JOIN sessions s ON s.session_id = tc.session_id
        WHERE s.started_at >= ? AND s.started_at <= ?
        GROUP BY tc.tool_name
        ORDER BY total_calls DESC
        LIMIT ?`
      )
      .bind(from, to, limit)
      .all<ToolSummaryRow>();
    return result.results;
  }

  async getTopProjects(
    from: string,
    to: string,
    limit = 10
  ): Promise<ProjectSummaryRow[]> {
    const result = await this.db
      .prepare(
        `SELECT cwd, COUNT(*) as session_count
        FROM sessions
        WHERE started_at >= ? AND started_at <= ?
        GROUP BY cwd
        ORDER BY session_count DESC
        LIMIT ?`
      )
      .bind(from, to, limit)
      .all<ProjectSummaryRow>();
    return result.results;
  }

  async getTokenTimeSeries(
    from: string,
    to: string,
    granularity: "daily" | "weekly" | "monthly"
  ): Promise<TokenTimeSeriesRow[]> {
    let dateExpr: string;
    switch (granularity) {
      case "daily":
        dateExpr = "date(started_at)";
        break;
      case "weekly":
        dateExpr = "strftime('%Y-W%W', started_at)";
        break;
      case "monthly":
        dateExpr = "strftime('%Y-%m', started_at)";
        break;
      default:
        throw new Error(`Unexpected granularity: ${granularity satisfies never}`);
    }

    const result = await this.db
      .prepare(
        `SELECT
          ${dateExpr} as period,
          SUM(input_tokens) as input_tokens,
          SUM(output_tokens) as output_tokens,
          SUM(cache_read_tokens) as cache_read_tokens,
          COUNT(*) as session_count
        FROM sessions
        WHERE started_at >= ? AND started_at <= ?
        GROUP BY period
        ORDER BY period ASC`
      )
      .bind(from, to)
      .all<TokenTimeSeriesRow>();
    return result.results;
  }

  async getToolStats(from: string, to: string): Promise<ToolSummaryRow[]> {
    const result = await this.db
      .prepare(
        `SELECT
          tc.tool_name,
          SUM(tc.call_count) as total_calls,
          COUNT(DISTINCT tc.session_id) as session_count
        FROM tool_calls tc
        JOIN sessions s ON s.session_id = tc.session_id
        WHERE s.started_at >= ? AND s.started_at <= ?
        GROUP BY tc.tool_name
        ORDER BY total_calls DESC`
      )
      .bind(from, to)
      .all<ToolSummaryRow>();
    return result.results;
  }
}
