// Claude API の概算単価 (USD per token)
// モデルやプランで変わるため、目安として使用
export const COST_PER_INPUT_TOKEN = 3.0 / 1_000_000;
export const COST_PER_OUTPUT_TOKEN = 15.0 / 1_000_000;
export const COST_PER_CACHE_TOKEN = 0.3 / 1_000_000;

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
export const DEFAULT_DAYS_BACK = 30;
