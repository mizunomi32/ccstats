import { Hono } from "hono";
import type { Env } from "../index";
import { SessionRepository } from "../repositories/session";
import { CreateSessionSchema } from "../types/api";
import { defaultFrom, defaultTo, clampLimit } from "../lib/utils";
import { MAX_LIMIT } from "../lib/constants";

const sessions = new Hono<{ Bindings: Env }>();

// POST /api/sessions — Hook からのデータ受信
sessions.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = CreateSessionSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Validation Error", message: parsed.error.flatten() },
      400
    );
  }

  const repo = new SessionRepository(c.env.DB);

  try {
    const session = await repo.create(parsed.data);
    return c.json(
      {
        id: session.id,
        session_id: session.session_id,
        created_at: session.created_at,
      },
      201
    );
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("UNIQUE constraint failed")) {
      return c.json(
        {
          error: "Conflict",
          message: `Session ${parsed.data.session_id} already exists`,
        },
        409
      );
    }
    throw e;
  }
});

// GET /api/sessions — セッション一覧
sessions.get("/", async (c) => {
  const from = c.req.query("from") ?? defaultFrom();
  const to = c.req.query("to") ?? defaultTo();
  const cwd = c.req.query("cwd");
  const limit = clampLimit(Number(c.req.query("limit")) || undefined, MAX_LIMIT);
  const offset = Number(c.req.query("offset")) || 0;

  const repo = new SessionRepository(c.env.DB);
  const result = await repo.list({ from, to, cwd, limit, offset });

  return c.json({
    sessions: result.sessions.map((s) => ({
      ...s,
      total_tokens: s.input_tokens + s.output_tokens,
    })),
    total: result.total,
    limit,
    offset,
  });
});

// GET /api/sessions/:id — セッション詳細
sessions.get("/:id", async (c) => {
  const id = c.req.param("id");
  const repo = new SessionRepository(c.env.DB);
  const session = await repo.getById(id);

  if (!session) {
    return c.json({ error: "Not Found", message: "Session not found" }, 404);
  }

  return c.json({
    ...session,
    total_tokens: session.input_tokens + session.output_tokens,
  });
});

export default sessions;
