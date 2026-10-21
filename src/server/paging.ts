import type { SQL } from 'drizzle-orm';
import { asc, desc } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

export type SortDir = 'asc' | 'desc';
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

const RESERVED = new Set(['page', 'pageSize', 'q', 'sort', 'dir', 'order', 'asc', 'deleted', 'all']);

/** A query as its operation parsed it (src/server/contract) → the URLSearchParams parsePageQuery and the list readers take. */
export function searchOf(query: Record<string, unknown>): URLSearchParams {
  return new URLSearchParams(
    Object.entries(query).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : [])),
  );
}

/** Parse ?page=&pageSize=&q=&sort=&dir= plus any other filters. */
export function parsePageQuery(sp: URLSearchParams, defaults: Partial<PageQuery> = {}): PageQuery {
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(
    500,
    Math.max(1, parseInt(sp.get('pageSize') ?? String(defaults.pageSize ?? 25), 10) || 25),
  );
  const q = (sp.get('q') ?? '').trim();
  const sortKey = sp.get('sort') ?? sp.get('order') ?? defaults.sort?.key ?? '';
  const dir: SortDir =
    (sp.get('dir') ??
      (sp.get('asc') === '0' ? 'desc' : sp.get('asc') === '1' ? 'asc' : (defaults.sort?.dir ?? 'asc'))) === 'desc'
      ? 'desc'
      : 'asc';
  const f: Record<string, string> = {};
  sp.forEach((v, k) => {
    if (!RESERVED.has(k) && v !== '') f[k] = v;
  });
  return { page, pageSize, q, sort: sortKey ? { key: sortKey, dir } : undefined, f };
}

/** Resolve a UI sort key to ORDER BY using a column map; falls back to `fallback`. */
export function orderBy(sort: Sort | undefined, map: Record<string, PgColumn | SQL>, fallback: SQL[]): SQL[] {
  // own keys only: "__proto__" / "constructor" must not resolve to Object.prototype members
  const col = sort && Object.hasOwn(map, sort.key) ? map[sort.key] : undefined;
  if (sort && col) return [sort.dir === 'desc' ? desc(col) : asc(col), ...fallback];
  return fallback;
}

/** A user's text for LIKE/ILIKE with its own backslash, `%`, `_` matched literally (Postgres' default LIKE escape is backslash). */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, '\\$&');
/** `%term%` — "contains" for ilike(); "%" or "J26121_4" typed in a search box are not wildcards. */
export const likeTerm = (s: string) => `%${likeEscape(s)}%`;

export const offsetOf = (p: PageQuery) => (p.page - 1) * p.pageSize;

/** `total` of a `select({ total: count() })` without GROUP BY — Postgres always returns exactly one row */
export function totalOf([r]: { total: number }[]): number {
  if (!r) throw new Error('count() returned no row');
  return Number(r.total);
}

/** Integer query param in 1..max; missing / junk → `def` (NaN would reach LIMIT → 500). */
export function clampInt(v: string | null | undefined, def: number, max: number): number {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : def;
}

/** `v` if it is a real calendar date "YYYY-MM-DD", else undefined (treated as no filter): a free-text
 *  date would reach a ::date / timestamp cast and fail the whole query (→ 500). */
export function ymd(v: string | null | undefined): string | undefined {
  const [s, y, mo, day] = /^([12]\d{3})-(\d{2})-(\d{2})$/.exec(v ?? '') ?? [];
  if (!s || !y || !mo || !day) return undefined;
  const d = new Date(Date.UTC(+y, +mo - 1, +day));
  return d.getUTCMonth() === +mo - 1 && d.getUTCDate() === +day ? s : undefined;
}
