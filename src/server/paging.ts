import type { SQL } from "drizzle-orm";
import { asc, desc } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export type SortDir = "asc" | "desc";
export type Sort = { key: string; dir: SortDir };

export type PageQuery = {
  page: number;
  pageSize: number;
  q: string;
  sort?: Sort;
  /** free-form filters from the query string (status, from, to, …) */
  f: Record<string, string>;
};

export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number };

const RESERVED = new Set(["page", "pageSize", "q", "sort", "dir", "order", "asc", "deleted", "all"]);

/** Parse ?page=&pageSize=&q=&sort=&dir= plus any other filters. */
export function parsePageQuery(sp: URLSearchParams, defaults: Partial<PageQuery> = {}): PageQuery {
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(sp.get("pageSize") ?? String(defaults.pageSize ?? 25), 10) || 25));
  const q = (sp.get("q") ?? "").trim();
  const sortKey = sp.get("sort") ?? sp.get("order") ?? defaults.sort?.key ?? "";
  const dir: SortDir = (sp.get("dir") ?? (sp.get("asc") === "0" ? "desc" : sp.get("asc") === "1" ? "asc" : defaults.sort?.dir ?? "asc")) === "desc" ? "desc" : "asc";
  const f: Record<string, string> = {};
  sp.forEach((v, k) => {
    if (!RESERVED.has(k) && v !== "") f[k] = v;
  });
  return { page, pageSize, q, sort: sortKey ? { key: sortKey, dir } : undefined, f };
}

/** Resolve a UI sort key to ORDER BY using a column map; falls back to `fallback`. */
export function orderBy(sort: Sort | undefined, map: Record<string, PgColumn | SQL>, fallback: SQL[]): SQL[] {
  if (sort && map[sort.key]) {
    const col = map[sort.key];
    return [sort.dir === "desc" ? desc(col) : asc(col), ...fallback];
  }
  return fallback;
}

export const offsetOf = (p: PageQuery) => (p.page - 1) * p.pageSize;
