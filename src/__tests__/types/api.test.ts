import { describe, it, expect } from "vitest";
import { CreateSessionSchema } from "../../types/api";

describe("CreateSessionSchema", () => {
  const validData = {
    session_id: "abc-123",
    cwd: "/home/user/project",
    input_tokens: 1000,
    output_tokens: 500,
    started_at: "2026-03-23T10:00:00Z",
    ended_at: "2026-03-23T10:10:00Z",
  };

  it("必須フィールドのみで有効", () => {
    const result = CreateSessionSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("全フィールド指定で有効", () => {
    const result = CreateSessionSchema.safeParse({
      ...validData,
      git_branch: "main",
      claude_version: "2.1.2",
      model: "claude-opus-4-6",
      cache_read_tokens: 2000,
      duration_seconds: 600,
      tool_calls: [
        { tool_name: "Read", call_count: 10 },
        { tool_name: "Edit", call_count: 5 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("tool_calls省略時は空配列がデフォルト", () => {
    const result = CreateSessionSchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tool_calls).toEqual([]);
    }
  });

  it("cache_read_tokens省略時は0がデフォルト", () => {
    const result = CreateSessionSchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cache_read_tokens).toBe(0);
    }
  });

  it("session_idが空文字で無効", () => {
    const result = CreateSessionSchema.safeParse({ ...validData, session_id: "" });
    expect(result.success).toBe(false);
  });

  it("cwdが空文字で無効", () => {
    const result = CreateSessionSchema.safeParse({ ...validData, cwd: "" });
    expect(result.success).toBe(false);
  });

  it("input_tokensが負数で無効", () => {
    const result = CreateSessionSchema.safeParse({ ...validData, input_tokens: -1 });
    expect(result.success).toBe(false);
  });

  it("output_tokensが負数で無効", () => {
    const result = CreateSessionSchema.safeParse({ ...validData, output_tokens: -1 });
    expect(result.success).toBe(false);
  });

  it("input_tokensが小数で無効", () => {
    const result = CreateSessionSchema.safeParse({ ...validData, input_tokens: 1.5 });
    expect(result.success).toBe(false);
  });

  it("session_id欠落で無効", () => {
    const { session_id, ...rest } = validData;
    const result = CreateSessionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("started_at欠落で無効", () => {
    const { started_at, ...rest } = validData;
    const result = CreateSessionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("tool_callsのtool_nameが空文字で無効", () => {
    const result = CreateSessionSchema.safeParse({
      ...validData,
      tool_calls: [{ tool_name: "", call_count: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("tool_callsのcall_countが負数で無効", () => {
    const result = CreateSessionSchema.safeParse({
      ...validData,
      tool_calls: [{ tool_name: "Read", call_count: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it("git_branchがnullで有効", () => {
    const result = CreateSessionSchema.safeParse({ ...validData, git_branch: null });
    expect(result.success).toBe(true);
  });

  it("duration_secondsがnullで有効", () => {
    const result = CreateSessionSchema.safeParse({ ...validData, duration_seconds: null });
    expect(result.success).toBe(true);
  });
});
