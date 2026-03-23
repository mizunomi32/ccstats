import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../index";
import dashboard from "../../routes/dashboard";

describe("GET /", () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", dashboard);

  it("HTMLを返す", async () => {
    const res = await app.request("/", { method: "GET" }, {} as Env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("ダッシュボードのタイトルを含む", async () => {
    const res = await app.request("/", { method: "GET" }, {} as Env);
    const html = await res.text();
    expect(html).toContain("ccstats");
    expect(html).toContain("Dashboard");
  });

  it("Chart.jsのCDNリンクを含む", async () => {
    const res = await app.request("/", { method: "GET" }, {} as Env);
    const html = await res.text();
    expect(html).toContain("chart.js");
  });

  it("フィルターボタンを含む", async () => {
    const res = await app.request("/", { method: "GET" }, {} as Env);
    const html = await res.text();
    expect(html).toContain("data-range");
    expect(html).toContain("Today");
    expect(html).toContain("30 Days");
  });

  it("コスト定数がHTMLに埋め込まれている", async () => {
    const res = await app.request("/", { method: "GET" }, {} as Env);
    const html = await res.text();
    expect(html).toContain("COST");
    expect(html).toContain("input:");
    expect(html).toContain("output:");
  });
});
