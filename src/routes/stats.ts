import { Hono } from "hono";
import type { Env } from "../index";
import { StatsRepository } from "../repositories/stats";
import { defaultFrom, defaultTo } from "../lib/utils";

const stats = new Hono<{ Bindings: Env }>();

// GET /api/stats/summary
stats.get("/summary", async (c) => {
  const from = c.req.query("from") ?? defaultFrom();
  const to = c.req.query("to") ?? defaultTo();

  const repo = new StatsRepository(c.env.DB);
  const [summary, tools, projects] = await Promise.all([
    repo.getSummary(from, to),
    repo.getTopTools(from, to, 5),
    repo.getTopProjects(from, to, 5),
  ]);

  const totalSessions = summary?.total_sessions ?? 0;

  return c.json({
    period: { from, to },
    total_sessions: totalSessions,
    total_input_tokens: summary?.total_input_tokens ?? 0,
    total_output_tokens: summary?.total_output_tokens ?? 0,
    total_cache_read_tokens: summary?.total_cache_read_tokens ?? 0,
    total_duration_seconds: summary?.total_duration_seconds ?? 0,
    avg_tokens_per_session:
      totalSessions > 0
        ? Math.round(
            ((summary?.total_input_tokens ?? 0) +
              (summary?.total_output_tokens ?? 0)) /
              totalSessions
          )
        : 0,
    avg_duration_per_session:
      totalSessions > 0
        ? Math.round((summary?.total_duration_seconds ?? 0) / totalSessions)
        : 0,
    most_used_tools: tools,
    most_active_projects: projects,
  });
});

// GET /api/stats/tokens
stats.get("/tokens", async (c) => {
  const from = c.req.query("from") ?? defaultFrom();
  const to = c.req.query("to") ?? defaultTo();
  const granularity =
    (c.req.query("granularity") as "daily" | "weekly" | "monthly") ?? "daily";

  if (!["daily", "weekly", "monthly"].includes(granularity)) {
    return c.json({ error: "Bad Request", message: "Invalid granularity" }, 400);
  }

  const repo = new StatsRepository(c.env.DB);
  const data = await repo.getTokenTimeSeries(from, to, granularity);

  return c.json({ granularity, data });
});

// GET /api/stats/tools
stats.get("/tools", async (c) => {
  const from = c.req.query("from") ?? defaultFrom();
  const to = c.req.query("to") ?? defaultTo();

  const repo = new StatsRepository(c.env.DB);
  const tools = await repo.getToolStats(from, to);

  return c.json({
    tools: tools.map((t) => ({
      ...t,
      avg_calls_per_session:
        t.session_count > 0
          ? Math.round((t.total_calls / t.session_count) * 10) / 10
          : 0,
    })),
  });
});

export default stats;
