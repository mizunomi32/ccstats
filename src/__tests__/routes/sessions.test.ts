import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import type { Env } from "../../index";
import sessions from "../../routes/sessions";
import { createMockD1, validSessionPayload } from "../helpers/mock-d1";
import type { MockD1 } from "../helpers/mock-d1";

describe("POST /api/sessions", () => {
  let app: Hono<{ Bindings: Env }>;
  let mockDb: MockD1;

  beforeEach(() => {
    mockDb = createMockD1();
    app = new Hono<{ Bindings: Env }>();
    app.route("/api/sessions", sessions);
  });

  function post(body: unknown) {
    return app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, { DB: mockDb as unknown as D1Database });
  }

  it("正常なデータで201を返す", async () => {
    const res = await post(validSessionPayload());
    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    expect(json).toHaveProperty("id");
    expect(json).toHaveProperty("session_id");
    expect(json).toHaveProperty("created_at");
  });

  it("レスポンスにsession_idが含まれる", async () => {
    const payload = validSessionPayload({ session_id: "my-unique-session" });
    const res = await post(payload);
    const json = await res.json() as Record<string, unknown>;
    expect(json.session_id).toBe("my-unique-session");
  });

  it("tool_callsなしでも201を返す", async () => {
    const res = await post(validSessionPayload({ tool_calls: [] }));
    expect(res.status).toBe(201);
  });

  it("tool_calls省略でも201を返す", async () => {
    const { tool_calls, ...rest } = validSessionPayload();
    const res = await post(rest);
    expect(res.status).toBe(201);
  });

  it("session_id欠落で400を返す", async () => {
    const { session_id, ...rest } = validSessionPayload();
    const res = await post(rest);
    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe("Validation Error");
  });

  it("input_tokensが負数で400を返す", async () => {
    const res = await post(validSessionPayload({ input_tokens: -1 }));
    expect(res.status).toBe(400);
  });

  it("cwdが空文字で400を返す", async () => {
    const res = await post(validSessionPayload({ cwd: "" }));
    expect(res.status).toBe(400);
  });

  it("空ボディで400を返す", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
  });

  it("重複session_idで409を返す", async () => {
    // batch()がUNIQUE制約エラーを投げるようにモック
    const originalBatch = mockDb.batch.bind(mockDb);
    let batchCallCount = 0;
    mockDb.batch = async (stmts: unknown[]) => {
      batchCallCount++;
      if (batchCallCount > 1) {
        throw new Error("UNIQUE constraint failed: sessions.session_id");
      }
      return originalBatch(stmts as D1PreparedStatement[]);
    };

    const payload = validSessionPayload({ session_id: "dup-session" });
    await post(payload);
    const res = await post(payload);
    expect(res.status).toBe(409);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe("Conflict");
  });
});

describe("GET /api/sessions", () => {
  let app: Hono<{ Bindings: Env }>;
  let mockDb: MockD1;

  beforeEach(() => {
    mockDb = createMockD1();
    app = new Hono<{ Bindings: Env }>();
    app.route("/api/sessions", sessions);
  });

  function get(query = "") {
    return app.request(`/api/sessions${query ? "?" + query : ""}`, {
      method: "GET",
    }, { DB: mockDb as unknown as D1Database });
  }

  it("空の結果で200を返す", async () => {
    mockDb.mockFirst("COUNT", { count: 0 });
    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json).toHaveProperty("sessions");
    expect(json).toHaveProperty("total");
    expect(json).toHaveProperty("limit");
    expect(json).toHaveProperty("offset");
  });

  it("セッション一覧を返す", async () => {
    mockDb.mockFirst("COUNT", { count: 1 });
    mockDb.mockQuery("ORDER BY started_at", [
      {
        id: "id-1",
        session_id: "sess-1",
        cwd: "/project",
        git_branch: "main",
        claude_version: null,
        model: null,
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_tokens: 200,
        duration_seconds: 300,
        started_at: "2026-03-23T10:00:00Z",
        ended_at: "2026-03-23T10:05:00Z",
        created_at: "2026-03-23T10:05:01Z",
      },
    ]);
    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json() as { sessions: { total_tokens: number }[] };
    expect(json.sessions).toHaveLength(1);
    expect(json.sessions[0].total_tokens).toBe(1500);
  });

  it("limit/offsetパラメータを受け付ける", async () => {
    mockDb.mockFirst("COUNT", { count: 100 });
    const res = await get("limit=10&offset=20");
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.limit).toBe(10);
    expect(json.offset).toBe(20);
  });

  it("limitが上限を超えるとクランプされる", async () => {
    mockDb.mockFirst("COUNT", { count: 0 });
    const res = await get("limit=999");
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.limit).toBe(200);
  });
});

describe("GET /api/sessions/:id", () => {
  let app: Hono<{ Bindings: Env }>;
  let mockDb: MockD1;

  beforeEach(() => {
    mockDb = createMockD1();
    app = new Hono<{ Bindings: Env }>();
    app.route("/api/sessions", sessions);
  });

  it("存在するセッションを返す", async () => {
    mockDb.mockFirst("session_id = ?", {
      id: "id-1",
      session_id: "sess-1",
      cwd: "/project",
      git_branch: "main",
      claude_version: null,
      model: null,
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_tokens: 200,
      duration_seconds: 300,
      started_at: "2026-03-23T10:00:00Z",
      ended_at: "2026-03-23T10:05:00Z",
      created_at: "2026-03-23T10:05:01Z",
    });
    const res = await app.request("/api/sessions/sess-1", {
      method: "GET",
    }, { DB: mockDb as unknown as D1Database });
    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.session_id).toBe("sess-1");
    expect(json.total_tokens).toBe(1500);
  });

  it("存在しないセッションで404を返す", async () => {
    const res = await app.request("/api/sessions/nonexistent", {
      method: "GET",
    }, { DB: mockDb as unknown as D1Database });
    expect(res.status).toBe(404);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe("Not Found");
  });
});
