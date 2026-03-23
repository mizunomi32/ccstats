import { describe, it, expect } from "vitest";
import app from "../index";
import { createMockD1 } from "./helpers/mock-d1";

describe("app", () => {
  it("GET / がダッシュボードHTMLを返す", async () => {
    const res = await app.request("/", { method: "GET" }, { DB: createMockD1() as unknown as D1Database });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("存在しないパスで404を返す", async () => {
    const res = await app.request("/nonexistent", { method: "GET" }, { DB: createMockD1() as unknown as D1Database });
    expect(res.status).toBe(404);
  });

  it("API ルートにCORSヘッダーが含まれる", async () => {
    const mockDb = createMockD1();
    mockDb.mockFirst("COUNT", { count: 0 });
    const res = await app.request("/api/sessions", {
      method: "GET",
      headers: { Origin: "http://localhost:3000" },
    }, { DB: mockDb as unknown as D1Database });
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
  });
});
