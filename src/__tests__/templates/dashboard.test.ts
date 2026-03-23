import { describe, it, expect } from "vitest";
import { renderDashboard } from "../../templates/dashboard";

describe("renderDashboard", () => {
  it("有効なHTML文字列を返す", () => {
    const html = renderDashboard();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  it("グラフ用のcanvas要素を含む", () => {
    const html = renderDashboard();
    expect(html).toContain('id="tokenChart"');
    expect(html).toContain('id="toolChart"');
  });

  it("APIフェッチのロジックを含む", () => {
    const html = renderDashboard();
    expect(html).toContain("/api/stats/summary");
    expect(html).toContain("/api/stats/tokens");
    expect(html).toContain("/api/stats/tools");
    expect(html).toContain("/api/sessions");
  });

  it("セッション一覧テーブルを含む", () => {
    const html = renderDashboard();
    expect(html).toContain("sessionsBody");
    expect(html).toContain("Recent Sessions");
  });

  it("日本語ロケール設定を含む", () => {
    const html = renderDashboard();
    expect(html).toContain('lang="ja"');
  });
});
