export interface SessionRow {
  id: string;
  session_id: string;
  cwd: string;
  git_branch: string | null;
  claude_version: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  duration_seconds: number | null;
  started_at: string;
  ended_at: string;
  created_at: string;
}

export interface ToolCallRow {
  id: number;
  session_id: string;
  tool_name: string;
  call_count: number;
}
