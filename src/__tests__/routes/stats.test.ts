import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../index";
import stats from "../../routes/stats";
import { createMockD1 } from "../helpers/mock-d1";
import type { MockD1 } from "../helpers/mock-d1";

describe("GET /api/stats/summary", () => {
  let app: Hono<{ Bindings: Env }>;
  let mockDb: MockD1;

  beforeEach(() => {
    mockDb = createMockD1();
    app = new Hono<{ Bindings: Env }>();
    app.route("/api/stats", stats);
  });

  function get(query = "") {
    return app.request(`/api/stats/summary${query ? "?" + query : ""}`, {
      method: "GET",
    }, { DB: mockDb as unknown as D1Database });
  }

  it("データなしで200とゼロ値を返す", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json).toHaveProperty("period");
    expect(json.total_sessions).toBe(0);
    expect(json.total_input_tokens).toBe(0);
    expect(json.avg_tokens_per_session).toBe(0);
    expect(json.avg_duration_per_session).toBe(0);
  });

  it("集計データを正しく返す", async () => {
    mockDb.mockFirst("SUM(input_tokens)", {
      total_sessions: 10,
      total_input_tokens: 50000,
      total_output_tokens: 15000,
      total_cache_read_tokens: 20000,
      total_duration_seconds: 6000,
    });
    mockDb.mockQuery("tc.tool_name", [
      { tool_name: "Read", total_calls: 100, session_count: 8 },
    ]);
    mockDb.mockQuery("GROUP BY cwd", [
      { cwd: "/project-a", session_count: 7 },
    ]);

    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.total_sessions).toBe(10);
    expect(json.total_input_tokens).toBe(50000);
    expect(json.total_output_tokens).toBe(15000);
    expect(json.avg_tokens_per_session).toBe(6500); // (50000+15000)/10
    expect(json.avg_duration_per_session).toBe(600); // 6000/10
    expect(json.most_used_tools).toHaveLength(1);
    expect(json.most_active_projects).toHaveLength(1);
  });

  it("期間パラメータを受け付ける", async () => {
    const res = await get("from=2026-03-01T00:00:00Z&to=2026-03-31T23:59:59Z");
    expect(res.status).toBe(200);
    const json = await res.json() as { period: { from: string; to: string } };
    expect(json.period.from).toBe("2026-03-01T00:00:00Z");
    expect(json.period.to).toBe("2026-03-31T23:59:59Z");
  });
});

describe("GET /api/stats/tokens", () => {
  let app: Hono<{ Bindings: Env }>;
  let mockDb: MockD1;

  beforeEach(() => {
    mockDb = createMockD1();
    app = new Hono<{ Bindings: Env }>();
    app.route("/api/stats", stats);
  });

  function get(query = "") {
    return app.request(`/api/stats/tokens${query ? "?" + query : ""}`, {
      method: "GET",
    }, { DB: mockDb as unknown as D1Database });
  }

  it("デフォルトでdaily粒度を返す", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.granularity).toBe("daily");
    expect(json).toHaveProperty("data");
  });

  it("weekly粒度を指定できる", async () => {
    const res = await get("granularity=weekly");
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.granularity).toBe("weekly");
  });

  it("monthly粒度を指定できる", async () => {
    const res = await get("granularity=monthly");
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.granularity).toBe("monthly");
  });

  it("不正なgranularityで400を返す", async () => {
    const res = await get("granularity=yearly");
    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe("Bad Request");
  });

  it("時系列データを返す", async () => {
    mockDb.mockQuery("GROUP BY period", [
      { period: "2026-03-22", input_tokens: 5000, output_tokens: 1500, cache_read_tokens: 2000, session_count: 3 },
      { period: "2026-03-23", input_tokens: 8000, output_tokens: 2500, cache_read_tokens: 3000, session_count: 5 },
    ]);
    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json() as { data: unknown[] };
    expect(json.data).toHaveLength(2);
  });
});

describe("GET /api/stats/tools", () => {
  let app: Hono<{ Bindings: Env }>;
  let mockDb: MockD1;

  beforeEach(() => {
    mockDb = createMockD1();
    app = new Hono<{ Bindings: Env }>();
    app.route("/api/stats", stats);
  });

  function get(query = "") {
    return app.request(`/api/stats/tools${query ? "?" + query : ""}`, {
      method: "GET",
    }, { DB: mockDb as unknown as D1Database });
  }

  it("空のツール統計を返す", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json() as { tools: unknown[] };
    expect(json.tools).toEqual([]);
  });

  it("ツール統計にavg_calls_per_sessionを含める", async () => {
    mockDb.mockQuery("GROUP BY tc.tool_name", [
      { tool_name: "Read", total_calls: 100, session_count: 10 },
      { tool_name: "Edit", total_calls: 30, session_count: 10 },
    ]);
    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json() as { tools: { tool_name: string; avg_calls_per_session: number }[] };
    expect(json.tools).toHaveLength(2);
    expect(json.tools[0].avg_calls_per_session).toBe(10); // 100/10
    expect(json.tools[1].avg_calls_per_session).toBe(3);  // 30/10
  });

  it("session_countが0の場合avgは0", async () => {
    mockDb.mockQuery("GROUP BY tc.tool_name", [
      { tool_name: "Read", total_calls: 0, session_count: 0 },
    ]);
    const res = await get();
    const json = await res.json() as { tools: { avg_calls_per_session: number }[] };
    expect(json.tools[0].avg_calls_per_session).toBe(0);
  });
});
