import { Hono } from "hono";
import { cors } from "hono/cors";
import sessions from "./routes/sessions";
import stats from "./routes/stats";
import dashboard from "./routes/dashboard";

export interface Env {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Env }>();

// CORS (ローカル開発用)
app.use("/api/*", cors());

// ルート登録
app.route("/api/sessions", sessions);
app.route("/api/stats", stats);
app.route("/", dashboard);

export default app;
