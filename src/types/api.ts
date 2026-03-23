import { z } from "zod";

export const CreateSessionSchema = z.object({
  session_id: z.string().min(1).max(128),
  cwd: z.string().min(1).max(1024),
  git_branch: z.string().max(256).nullish(),
  claude_version: z.string().max(64).nullish(),
  model: z.string().max(128).nullish(),
  input_tokens: z.number().int().min(0).max(100_000_000),
  output_tokens: z.number().int().min(0).max(100_000_000),
  cache_read_tokens: z.number().int().min(0).max(100_000_000).default(0),
  duration_seconds: z.number().int().min(0).max(86400).nullish(),
  started_at: z.string().datetime({ offset: true }),
  ended_at: z.string().datetime({ offset: true }),
  tool_calls: z
    .array(
      z.object({
        tool_name: z.string().min(1).max(128),
        call_count: z.number().int().min(0).max(1_000_000),
      })
    )
    .max(200)
    .default([]),
});

export type CreateSessionRequest = z.infer<typeof CreateSessionSchema>;

export interface CreateSessionResponse {
  id: string;
  session_id: string;
  created_at: string;
}

export interface SessionListQuery {
  from?: string;
  to?: string;
  cwd?: string;
  limit?: number;
  offset?: number;
}

export interface StatsSummary {
  period: { from: string; to: string };
  total_sessions: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_duration_seconds: number;
  avg_tokens_per_session: number;
  avg_duration_per_session: number;
  most_used_tools: { tool_name: string; total_calls: number }[];
  most_active_projects: { cwd: string; session_count: number }[];
}

export interface TokenTimeSeries {
  granularity: "daily" | "weekly" | "monthly";
  data: {
    period: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    session_count: number;
  }[];
}

export interface ToolStats {
  tools: {
    tool_name: string;
    total_calls: number;
    session_count: number;
    avg_calls_per_session: number;
  }[];
}
