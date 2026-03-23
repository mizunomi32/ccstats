import { vi } from "vitest";
import type { D1Database, D1PreparedStatement, D1Result } from "@cloudflare/workers-types";

/**
 * D1Database のモック。
 * テストごとに .mockQuery() でクエリ結果を差し替える。
 */
export interface MockD1 extends D1Database {
  _mockResults: Map<string, { results: unknown[]; meta?: Record<string, unknown> }>;
  _mockFirst: Map<string, unknown>;
  mockQuery(pattern: string, results: unknown[]): void;
  mockFirst(pattern: string, result: unknown): void;
  _batchCalls: unknown[][];
}

export function createMockD1(): MockD1 {
  const mockResults = new Map<string, { results: unknown[] }>();
  const mockFirstResults = new Map<string, unknown>();
  const batchCalls: unknown[][] = [];

  const createMockStatement = (sql: string, boundValues: unknown[] = []): D1PreparedStatement => {
    const stmt: D1PreparedStatement = {
      bind(...values: unknown[]) {
        return createMockStatement(sql, values);
      },
      async first<T>(col?: string): Promise<T | null> {
        for (const [pattern, result] of mockFirstResults) {
          if (sql.includes(pattern)) {
            if (col && result && typeof result === "object") {
              return (result as Record<string, unknown>)[col] as T;
            }
            return result as T;
          }
        }
        return null;
      },
      async all<T>(): Promise<D1Result<T>> {
        for (const [pattern, data] of mockResults) {
          if (sql.includes(pattern)) {
            return {
              results: data.results as T[],
              success: true,
              meta: {} as D1Result<T>["meta"],
            } as D1Result<T>;
          }
        }
        return {
          results: [] as T[],
          success: true,
          meta: {} as D1Result<T>["meta"],
        } as D1Result<T>;
      },
      async run(): Promise<D1Result<unknown>> {
        return {
          results: [],
          success: true,
          meta: {} as D1Result<unknown>["meta"],
        } as D1Result<unknown>;
      },
      async raw<T>(): Promise<T[]> {
        return [];
      },
    } as D1PreparedStatement;
    return stmt;
  };

  const db: MockD1 = {
    _mockResults: mockResults,
    _mockFirst: mockFirstResults,
    _batchCalls: batchCalls,
    mockQuery(pattern: string, results: unknown[]) {
      mockResults.set(pattern, { results });
    },
    mockFirst(pattern: string, result: unknown) {
      mockFirstResults.set(pattern, result);
    },
    prepare(sql: string) {
      return createMockStatement(sql);
    },
    async batch<T>(stmts: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      batchCalls.push(stmts);
      return stmts.map(() => ({
        results: [] as T[],
        success: true,
        meta: {} as D1Result<T>["meta"],
      })) as D1Result<T>[];
    },
    async dump(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0);
    },
    async exec(query: string): Promise<D1Result<unknown>> {
      return {
        results: [],
        success: true,
        meta: {} as D1Result<unknown>["meta"],
      } as D1Result<unknown>;
    },
  } as unknown as MockD1;

  return db;
}

/** POST /api/sessions 用の有効なリクエストデータを生成 */
export function validSessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    session_id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    cwd: "/home/user/projects/my-app",
    git_branch: "main",
    claude_version: "2.1.2",
    model: "claude-opus-4-6",
    input_tokens: 5000,
    output_tokens: 1500,
    cache_read_tokens: 2000,
    duration_seconds: 600,
    started_at: "2026-03-23T10:00:00Z",
    ended_at: "2026-03-23T10:10:00Z",
    tool_calls: [
      { tool_name: "Read", call_count: 10 },
      { tool_name: "Edit", call_count: 5 },
    ],
    ...overrides,
  };
}
