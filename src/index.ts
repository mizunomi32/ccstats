import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import sessions from "./routes/sessions";
import stats from "./routes/stats";
import dashboard from "./routes/dashboard";

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN?: string;
}

const app = new Hono<{ Bindings: Env }>();

// セキュリティヘッダー
app.use("*", secureHeaders());

// CORS (ALLOWED_ORIGIN 未設定時はsame-originのみ)
app.use("/api/*", async (c, next) => {
  const origin = c.env.ALLOWED_ORIGIN;
  return cors({ origin: origin || "" })(c, next);
});

// ルート登録
app.route("/api/sessions", sessions);
app.route("/api/stats", stats);
app.route("/", dashboard);

export default app;
