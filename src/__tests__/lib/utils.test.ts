import { describe, it, expect } from "vitest";
import { clampLimit, defaultFrom, defaultTo, projectName } from "../../lib/utils";
import { DEFAULT_DAYS_BACK } from "../../lib/constants";

describe("clampLimit", () => {
  it("undefined の場合はデフォルト50を返す", () => {
    expect(clampLimit(undefined, 200)).toBe(50);
  });

  it("0以下の場合はデフォルト50を返す", () => {
    expect(clampLimit(0, 200)).toBe(50);
    expect(clampLimit(-1, 200)).toBe(50);
  });

  it("max以下の値はそのまま返す", () => {
    expect(clampLimit(100, 200)).toBe(100);
  });

  it("maxを超える値はmaxにクランプする", () => {
    expect(clampLimit(300, 200)).toBe(200);
  });

  it("maxと同じ値はそのまま返す", () => {
    expect(clampLimit(200, 200)).toBe(200);
  });

  it("1を指定すると1を返す", () => {
    expect(clampLimit(1, 200)).toBe(1);
  });
});

describe("defaultFrom", () => {
  it("現在からDEFAULT_DAYS_BACK日前のISO文字列を返す", () => {
    const result = defaultFrom();
    const expected = new Date();
    expected.setDate(expected.getDate() - DEFAULT_DAYS_BACK);
    // 1秒以内の差を許容
    expect(Math.abs(new Date(result).getTime() - expected.getTime())).toBeLessThan(1000);
  });

  it("ISO 8601形式の文字列を返す", () => {
    const result = defaultFrom();
    expect(() => new Date(result)).not.toThrow();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("defaultTo", () => {
  it("現在時刻のISO文字列を返す", () => {
    const before = Date.now();
    const result = defaultTo();
    const after = Date.now();
    const resultMs = new Date(result).getTime();
    expect(resultMs).toBeGreaterThanOrEqual(before);
    expect(resultMs).toBeLessThanOrEqual(after);
  });

  it("ISO 8601形式の文字列を返す", () => {
    const result = defaultTo();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("projectName", () => {
  it("パスの末尾ディレクトリ名を返す", () => {
    expect(projectName("/Users/user/projects/my-app")).toBe("my-app");
  });

  it("深いパスでも末尾を返す", () => {
    expect(projectName("/a/b/c/d/e/project")).toBe("project");
  });

  it("末尾にスラッシュがあっても正しく返す", () => {
    expect(projectName("/Users/user/projects/my-app/")).toBe("my-app");
  });

  it("単一のディレクトリ名を正しく返す", () => {
    expect(projectName("/myproject")).toBe("myproject");
  });

  it("スラッシュのない文字列はそのまま返す", () => {
    expect(projectName("myproject")).toBe("myproject");
  });

  it("空文字の場合はそのまま返す", () => {
    expect(projectName("")).toBe("");
  });
});
