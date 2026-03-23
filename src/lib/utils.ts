import { DEFAULT_DAYS_BACK } from "./constants";

export function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - DEFAULT_DAYS_BACK);
  return d.toISOString();
}

export function defaultTo(): string {
  return new Date().toISOString();
}

export function clampLimit(limit: number | undefined, max: number): number {
  if (!limit || limit < 1) return 50;
  return Math.min(limit, max);
}

/** cwd からプロジェクト名を抽出 (末尾のディレクトリ名) */
export function projectName(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}
