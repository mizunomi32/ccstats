import { describe, it, expect } from "vitest";
import {
  COST_PER_INPUT_TOKEN,
  COST_PER_OUTPUT_TOKEN,
  COST_PER_CACHE_TOKEN,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  DEFAULT_DAYS_BACK,
} from "../../lib/constants";

describe("constants", () => {
  it("コスト定数が正の数値", () => {
    expect(COST_PER_INPUT_TOKEN).toBeGreaterThan(0);
    expect(COST_PER_OUTPUT_TOKEN).toBeGreaterThan(0);
    expect(COST_PER_CACHE_TOKEN).toBeGreaterThan(0);
  });

  it("output > input > cache の単価順序", () => {
    expect(COST_PER_OUTPUT_TOKEN).toBeGreaterThan(COST_PER_INPUT_TOKEN);
    expect(COST_PER_INPUT_TOKEN).toBeGreaterThan(COST_PER_CACHE_TOKEN);
  });

  it("limit定数が妥当な値", () => {
    expect(DEFAULT_LIMIT).toBe(50);
    expect(MAX_LIMIT).toBe(200);
    expect(MAX_LIMIT).toBeGreaterThan(DEFAULT_LIMIT);
  });

  it("DEFAULT_DAYS_BACKが30", () => {
    expect(DEFAULT_DAYS_BACK).toBe(30);
  });
});
