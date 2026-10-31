/** the data hooks' URLs = their swr keys, pure so the server prefetch builds byte-identical keys (a mismatch only means the hook fetches itself) */

import type { DeletedMode } from './queries';

export type Params = Record<string, string | number | boolean | undefined | null>;

export function qs(params: Params): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** useTable */
export const tableKey = (table: string, deleted: DeletedMode = 'exclude', params: Params = {}) =>
  `/api/data/${table}${qs({ deleted, ...params })}`;

/** usePagedTable */
export const pagedKey = (table: string, params: Params, deleted: DeletedMode = 'exclude') =>
  `/api/data/${table}${qs({ paged: 1, deleted, ...params })}`;

/** the page sizes a server-paged table offers (legacy lists: 50 / 75 / 100) */
export const PAGE_SIZES = [10, 25, 50, 75, 100];

type TableState = { page: number; pageSize: number; q: string; sort: { key: string; dir: 'asc' | 'desc' } | null };
/** where useServerTable starts when the page passes nothing */
export const FIRST_PAGE: TableState = { page: 1, pageSize: 25, q: '', sort: null };
/** page / pageSize / q / sort / dir — what a paged hook is given (useServerTable's pageArgs) */
export const pageArgsOf = (t: TableState) => ({
  page: t.page,
  pageSize: t.pageSize,
  q: t.q,
  sort: t.sort?.key,
  dir: t.sort?.dir,
});

/** a record number as the "ระบุหมายเลข…" screens look it up */
export const recordNo = (v: string) => v.trim().toUpperCase();
/** a job's own URL: its uuid (ADR 0008), one spelling whatever case the caller holds it in */
export const jobKey = (id: string) => `/api/jobs/${encodeURIComponent(id.toLowerCase())}`;
export const quotationKey = (no: string) => `/api/quotations/${encodeURIComponent(no)}`;
/** the job a job screen opens with: ?id=<the job's uuid> (ADR 0008) — an old ?job=<number> link opens none */
export const jobIdParam = (sp: Pick<URLSearchParams, 'get'>) => sp.get('id') || '';
/** not a URL: the id prefetch() stamps on each answer set, so <Prefetched> seeds one set only once */
export const PREFETCH_ID = 'prefetch:id';
/** not a URL: prefetch()'s answers, packed (src/lib/obscure.ts — no e-mail address in the server HTML) */
export const PREFETCH_PACKED = 'prefetch:packed';
