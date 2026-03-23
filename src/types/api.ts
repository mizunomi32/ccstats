import { z } from "zod";

export const CreateSessionSchema = z.object({
  session_id: z.string().min(1),
  cwd: z.string().min(1),
  git_branch: z.string().nullish(),
  claude_version: z.string().nullish(),
  model: z.string().nullish(),
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  cache_read_tokens: z.number().int().min(0).default(0),
  duration_seconds: z.number().int().min(0).nullish(),
  started_at: z.string().min(1),
  ended_at: z.string().min(1),
  tool_calls: z
    .array(
      z.object({
        tool_name: z.string().min(1),
        call_count: z.number().int().min(0),
      })
    )
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
