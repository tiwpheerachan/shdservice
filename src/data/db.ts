'use client';

import * as React from 'react';
import useSWR, { mutate, SWRConfig, useSWRConfig, type SWRConfiguration } from 'swr';
import { api, errMsg, onApiWrite } from '@/lib/api';
import { qs, tableKey, pagedKey, PREFETCH_ID, type Params } from './keys';
import type { Order, DeletedMode } from './queries';
import type {
  User,
  Permission,
  MasterRow,
  Symptom,
  Model,
  Product,
  Movement,
  Customer,
  Job,
  Quotation,
  SaleOrder,
  DashGroup,
  TatRow,
  MonthlyRow,
  TopSymptom,
} from './types';

export type { Order, DeletedMode, Params };

/* ------------------------------------------------------------------ *
 * React hooks over the app's read API (/api/data/<resource>); data comes from
 * the legacy tables through drizzle on the server.
 *
 * Caching (swr): every hook is keyed by its full URL, so components asking for
 * the same list share one request and one copy of the data. A key that is
 * already cached renders immediately and is only re-fetched when it is older
 * than `ttl` (master lookups: 5 min, everything else: 30 s), when the page
 * calls `refetch()`, or after ANY successful write through `api()` — which
 * marks every cached list stale so the next screen shows fresh rows without
 * a manual reload. No refresh on tab focus (by decision).
 * ------------------------------------------------------------------ */

export type TableState<T> = {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

/** how long a cached list is served without re-fetching */
export const TTL_MASTER = 5 * 60_000;
export const TTL_DEFAULT = 30_000;

const SWR_OPTS: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  revalidateIfStale: false, // staleness is decided by `ttl` below, not on every mount
  keepPreviousData: true, // page/filter change keeps the old rows on screen while loading
  dedupingInterval: 2_000,
  shouldRetryOnError: false,
};

const fetchedAt = new Map<string, number>();
const fetcher = async <T>(url: string): Promise<T> => {
  const d = await api<T>(url);
  fetchedAt.set(url, Date.now());
  return d;
};

/** Forget every list's age and re-fetch the ones on screen — called after each write. */
export function invalidateLists() {
  fetchedAt.clear();
  void mutate((key) => typeof key === 'string' && key.startsWith('/api/data/'));
}
onApiWrite(invalidateLists);

/**
 * A page's first answers, read on the server while it rendered (src/server/prefetch.ts, keyed by the
 * URLs in ./keys): the first render shows them through swr's `fallback` (so they are in the HTML), then
 * they are kept as reads that just finished — cached with their age, so no hook fetches them again on
 * mount and the usual ttl / refetch / invalidateLists rules apply from there. A key that is missing
 * (refused, failed, too slow) is simply fetched by its hook.
 *
 * Back/forward remounts the page with the SAME payload — answers older than what the cache got since
 * (a save, a re-read). A set whose id (PREFETCH_ID) was seeded before is such a replay: it seeds nothing
 * and offers no fallback, so the cache and its ttl rules decide, as on any client-side visit.
 */
const seeded = new Set<unknown>();
export function Prefetched({
  fallback: all,
  children,
}: {
  fallback: Record<string, unknown>;
  children: React.ReactNode;
}) {
  const { [PREFETCH_ID]: id, ...answers } = all;
  const fallback = id !== undefined && seeded.has(id) ? {} : answers;
  React.useEffect(() => {
    if (id !== undefined) seeded.add(id);
    const now = Date.now();
    for (const [key, data] of Object.entries(fallback)) {
      fetchedAt.set(key, now);
      void mutate(key, data, { revalidate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per answer set
  }, [all]);
  return React.createElement(SWRConfig, { value: { fallback } }, children); // .ts: no JSX
}

/** Re-fetch a cached key when it is older than `ttl` (or its age is unknown). */
function useStaleCheck(url: string | null, ttl: number, revalidate: () => Promise<unknown>) {
  const { cache } = useSWRConfig();
  React.useEffect(() => {
    // THIS key's own cache entry, not the hook's `data`: keepPreviousData hands the previous page's rows
    // to a new key, and revalidating then would fetch it a second time on top of swr's own first fetch
    if (!url || cache.get(url)?.data === undefined) return; // no cache → swr fetches on mount by itself
    const at = fetchedAt.get(url);
    if (!at || Date.now() - at > ttl) void revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
}

function sortRows<T>(rows: T[], order?: Order): T[] {
  if (!order?.column) return rows;
  const col = order.column as keyof T;
  const dir = order.ascending === false ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = a[col] as unknown;
    const y = b[col] as unknown;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x ?? '').localeCompare(String(y ?? ''), 'th') * dir;
  });
}

export function useTable<T>(
  table: string,
  order?: Order,
  deleted: DeletedMode = 'exclude',
  params: Params = {},
  ttl: number = TTL_DEFAULT,
  /** false = nothing loaded (yet) — e.g. a list only one mode of the screen needs */
  enabled = true,
): TableState<T> {
  const url = enabled ? tableKey(table, deleted, params) : null;
  const { data, error, isLoading, mutate: revalidate } = useSWR<T[]>(url, fetcher, SWR_OPTS);
  useStaleCheck(url, ttl, revalidate);

  const col = order?.column;
  const asc = order?.ascending;
  const rows = React.useMemo(
    () => sortRows(Array.isArray(data) ? data : [], col ? { column: col, ascending: asc } : undefined),
    [data, col, asc],
  );
  const refetch = React.useCallback(() => {
    void revalidate();
  }, [revalidate]);

  return { data: rows, loading: isLoading, error: error ? errMsg(error) : null, refetch };
}

/* ---- server-side paging (big tables) ---- */
export type PageState<T> = {
  rows: T[];
  total: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

export type PageParams = {
  page: number;
  pageSize: number;
  q?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
} & Params;

const EMPTY: never[] = [];

export function usePagedTable<T>(table: string, params: PageParams, deleted: DeletedMode = 'exclude'): PageState<T> {
  const url = pagedKey(table, params, deleted);
  const { data, error, isLoading, mutate: revalidate } = useSWR<{ rows: T[]; total: number }>(url, fetcher, SWR_OPTS);
  useStaleCheck(url, TTL_DEFAULT, revalidate);
  const refetch = React.useCallback(() => {
    void revalidate();
  }, [revalidate]);

  // on error drop the rows keepPreviousData kept from the PREVIOUS page/filter — otherwise the
  // table shows last filter's results under the new one and the error row never appears
  return {
    rows: error ? EMPTY : (data?.rows ?? EMPTY),
    total: error ? 0 : (data?.total ?? 0),
    loading: isLoading,
    error: error ? errMsg(error) : null,
    refetch,
  };
}

/* ------------------------------------------------------------------ *
 * Named hooks — one per resource, with the display order used by the UI.
 * ------------------------------------------------------------------ */

export const useUsers = (deleted: DeletedMode = 'exclude') =>
  useTable<User>('users', undefined, deleted, {}, TTL_MASTER); // server order: pending → active (name) → inactive
export const usePermissions = () => useTable<Permission>('permissions', { column: 'id' }, 'exclude', {}, TTL_MASTER);
// Master lookups feed dropdowns → ACTIVE rows only (INACTIVE stay visible on the admin pages).
export const useCategories = (mode: DeletedMode = 'active') =>
  useTable<MasterRow>('categories', { column: 'id' }, mode, {}, TTL_MASTER);
export const useManufacturers = (mode: DeletedMode = 'active') =>
  useTable<MasterRow>('manufacturers', { column: 'name' }, mode, {}, TTL_MASTER);
export const useColors = (mode: DeletedMode = 'active') =>
  useTable<MasterRow>('colors', { column: 'id' }, mode, {}, TTL_MASTER);
export const useJobTypes = (mode: DeletedMode = 'active') =>
  useTable<MasterRow>('job_types', { column: 'id' }, mode, {}, TTL_MASTER);
export const useProductTypes = (mode: DeletedMode = 'active') =>
  useTable<MasterRow>('product_types', { column: 'id' }, mode, {}, TTL_MASTER);
/** `enabled: false` → nothing loaded (yet): the symptom pickers load their lists once opened / focused */
export const useSymptoms = (mode: DeletedMode = 'active', enabled = true) =>
  useTable<Symptom>('symptoms', { column: 'id' }, mode, {}, TTL_MASTER, enabled);
/** the whole list is 1,171 rows (~140 KB): `brand` → only that brand's models; `enabled: false` → nothing loaded (yet) */
export const useModels = (mode: DeletedMode = 'active', { brand = '', enabled = true } = {}) =>
  useTable<Model>('models', { column: 'code' }, mode, brand ? { brand } : {}, TTL_MASTER, enabled);
export const useModelsPage = (params: PageParams, mode: DeletedMode = 'exclude') =>
  usePagedTable<Model>('models', params, mode);
/** Audit trail (System Admin) — see src/server/audit.ts */
export type AuditRow = {
  id: number;
  at: string;
  userId: number;
  user: string;
  action: string;
  module: string;
  entity: string;
  key: string;
  summary: string;
  changes: Record<string, [unknown, unknown]> | null;
};
export const useAuditPage = (params: PageParams) => usePagedTable<AuditRow>('audit_log', params, 'all');
export const useAuditModules = () => useTable<string>('audit_modules', undefined, 'exclude', {}, TTL_MASTER);
/** The whole ACTIVE catalog, lite fields only (code/name/onhand/price/brand/category) — for the screens whose
 *  lines ARE the catalog (รับเข้า, จ่ายออกอื่นๆ). Part pickers search instead: useProductSearch.
 *  `mode` 'exclude' = Inactive too (รับเข้า: stock still arrives for a part no new document may use). */
export const useProducts = (enabled = true, mode: DeletedMode = 'active') =>
  useTable<Product>('products', { column: 'sysCode' }, mode, { fields: 'lite' }, TTL_DEFAULT, enabled);
/** ACTIVE products (lite rows) whose code / part no / TH·EN·CN name contains `q`, searched on the server;
 *  '' = nothing loaded. Same rows and cache rules as useProducts (re-read after any write). */
export const useProductSearch = (q: string, opts: ApiOpts<Product[]> = {}) =>
  useApi<Product[]>(q ? `/api/data/products${qs({ deleted: 'active', fields: 'lite', q })}` : null, opts);
export const useProductsPage = (params: PageParams, mode: DeletedMode = 'exclude') =>
  usePagedTable<Product & { value: number }>('products', params, mode);
export type ProductStats = { total: number; qty: number; value: number; low: number; out: number; noPrice: number };
export const useProductStats = (params: Params = {}, mode: DeletedMode = 'exclude') =>
  useTable<ProductStats>('product_stats', undefined, mode, params);
export const useMovementsPage = (params: PageParams) => usePagedTable<Movement>('movements', params);
export const useCustomersPage = (params: PageParams, deleted: DeletedMode = 'exclude') =>
  usePagedTable<Customer>('customers', params, deleted);
/** Server-filtered job list (reports, dropdowns). Use useJobsPage for the big list. */
export const useJobs = (params: Params = {}) => useTable<Job>('jobs', undefined, 'exclude', params);
export const useJobsPage = (params: PageParams) => usePagedTable<Job>('jobs', params);
export const useQuotationsPage = (params: PageParams) => usePagedTable<Quotation>('quotations', params);
export const useSaleOrdersPage = (params: PageParams) => usePagedTable<SaleOrder>('sale_orders', params);

/** Dashboard — `range` = { from, to, type } (YYYY-MM-DD, both empty = all time; type = job type name); TAT is a live snapshot (date-independent, but follows `type`) */
export type DashRange = { from?: string; to?: string; type?: string };
export type Dashboard = {
  groups: DashGroup[];
  tat: TatRow[];
  monthly: MonthlyRow[];
  granularity: 'day' | 'month';
  topSymptoms: TopSymptom[];
};
/** the whole dashboard in ONE request — the server computes it once per range (30 s cache) */
export function useDashboard(range: DashRange = {}) {
  const { data, loading, error, refetch } = useTable<Dashboard>('dashboard', undefined, 'exclude', range);
  return { data: data[0] ?? null, loading, error, refetch };
}

/* ---- lookups ---- */
export type Staff = { id: number; name: string; userType: string; takesJobs: boolean; sells: boolean };
/** `usedAs` (report filters): also the people who left but are still on jobs / sale orders */
export const useStaff = (usedAs?: 'engineer' | 'sales') =>
  useTable<Staff>('staff', undefined, 'exclude', usedAs ? { usedAs } : {}, TTL_MASTER);
export const useRoles = () => useTable<string>('roles', undefined, 'exclude', {}, TTL_MASTER);
export const useProvinces = () =>
  useTable<{ id: number; name: string }>('provinces', undefined, 'exclude', {}, TTL_MASTER);
export const useJobStatuses = () =>
  useTable<{ id: number; name: string; group: string; order: number; active: boolean }>(
    'job_statuses',
    undefined,
    'exclude',
    {},
    TTL_MASTER,
  );
/** quotation_status (id, name) — status dropdowns / filters */
export const useQuotationStatuses = () =>
  useTable<{ id: number; name: string }>('quotation_statuses', undefined, 'exclude', {}, TTL_MASTER);
export const useVendors = () => useTable<string>('vendors', undefined, 'exclude', {}, TTL_MASTER);
/** งานย่อย / บริษัทขนส่ง — ค่าที่ใช้อยู่ใน DB สำหรับ datalist (พิมพ์ค่าใหม่ได้) */
export const useJobTypeDetails = () => useTable<string>('job_type_details', undefined, 'exclude', {}, TTL_MASTER);
export type DocumentProfileLite = {
  id: number;
  code: string;
  nameTh: string;
  nameEn: string;
  isDefault: boolean;
  logoUrl: string;
};
/** โปรไฟล์ผู้ออกเอกสาร (active) — dropdown "ออกเอกสารในนาม" */
export const useDocumentProfiles = () =>
  useTable<DocumentProfileLite>('document_profiles', undefined, 'exclude', {}, TTL_MASTER);
export const useShippers = () => useTable<string>('shippers', undefined, 'exclude', {}, TTL_MASTER);
/** โปรไฟล์บริษัทขนส่ง (active) — dropdown ตอนปิดงาน + โลโก้/ลิงก์ติดตามในหน้าลูกค้า */
export type ShippingProfileLite = {
  id: number;
  code: string;
  nameTh: string;
  nameEn: string;
  aliases: string;
  logoUrl: string;
  trackUrl: string;
};
export const useShippingProfiles = () =>
  useTable<ShippingProfileLite>('shipping_profiles', undefined, 'exclude', {}, TTL_MASTER);
/** อาการเสีย เรียงตามความถี่ที่ใช้จริง + อาการที่พบบ่อยของรุ่น (SymptomPicker) */
export type SymptomStat = { id: number; name: string; group: string; count: number };
export const useSymptomStats = (enabled = true) =>
  useTable<SymptomStat>('symptom_stats', undefined, 'exclude', {}, TTL_MASTER, enabled);
export const useModelSymptoms = (model: string, enabled = true) =>
  useTable<{ id: number; name: string; count: number }>(
    'model_symptoms',
    undefined,
    'exclude',
    { model },
    TTL_MASTER,
    enabled,
  );
/** qty < 0 = รับคืนจากการเบิก; value = qty × price (`priceBasis`: ราคา ณ วันเบิก, else ราคาปัจจุบัน) */
export type IssuedLine = Movement & {
  code: string;
  item: string;
  category: string;
  qty: number;
  price: number;
  priceBasis: string;
  value: number;
};
export const useIssuedLinesPage = (params: PageParams) => usePagedTable<IssuedLine>('issued_lines', params);
/** net of returns; `todayPriced` = lines valued at today's price (no price stored) */
export type IssuedStats = { lines: number; qty: number; value: number; todayPriced: number; top: string };
export const useIssuedStats = (params: Params = {}) =>
  useTable<IssuedStats>('issued_stats', undefined, 'exclude', params);

/* ---- report KPI summaries (same filters as the paged tables) ---- */
export type JobSummary = {
  total: number;
  fresh: number;
  done: number;
  amount: number;
  paid: number;
  avgTat: number;
  over30: number;
  topChannel: string;
};
export const useJobSummary = (params: Params = {}) => useTable<JobSummary>('job_summary', undefined, 'exclude', params);
export type QuotationSummary = {
  total: number;
  agreed: number;
  /** without cancelled quotations (5) — `cancelledAmount` is that part */
  amount: number;
  cancelledAmount: number;
  agreedAmount: number;
};
export const useQuotationSummary = (params: Params = {}) =>
  useTable<QuotationSummary>('quotation_summary', undefined, 'exclude', params);
export type SaleOrderSummary = {
  total: number;
  approved: number;
  /** approved orders only — `notApprovedAmount` = waiting / rejected / denied */
  amount: number;
  notApprovedAmount: number;
  avg: number;
};
export const useSaleOrderSummary = (params: Params = {}) =>
  useTable<SaleOrderSummary>('sale_order_summary', undefined, 'exclude', params);
export const useJobStats = () =>
  useTable<{ total: number; fresh: number; done: number; progress: number }>('job_stats');
/** Job numbers for reference dropdowns: recent open jobs (default), or `mode` = "pending_parts" / "returnable" (ตัดจ่าย / รับคืน). */
export const useJobNos = (limit = 50, mode?: 'pending_parts' | 'returnable') =>
  useTable<string>('job_nos', undefined, 'exclude', mode ? { limit, mode } : { limit });

/* ------------------------------------------------------------------ *
 * useApi — one read of any app API (not a /api/data list) through the same swr cache, so no
 * screen hand-writes useEffect + fetch + loading + "is this answer still current?" again.
 *   url = null        → nothing loaded (e.g. the dialog is closed, the search term too short)
 *   ttl               → how long a cached answer is served without re-fetching (default 30 s)
 *   fresh             → always re-read when the key appears (a dialog opened again, a new record)
 *   keepPrevious      → keep the last answer on screen while the next key loads (search boxes);
 *                       off by default so one record's data never shows under another's key
 *   refreshInterval   → poll (paused while the tab is hidden)
 *   quiet             → a failed read never redirects to /login (background widgets)
 *   onError           → e.g. a toast; called once per failed read
 *   onSuccess         → act on an answer outside render (e.g. prefill a form once)
 * ------------------------------------------------------------------ */
export type ApiOpts<T = unknown> = {
  ttl?: number;
  fresh?: boolean;
  keepPrevious?: boolean;
  refreshInterval?: number;
  revalidateOnFocus?: boolean;
  quiet?: boolean;
  onError?: (message: string) => void;
  onSuccess?: (data: T) => void;
};

/** background fetch: never redirects — a failure keeps the last answer on screen */
const quietFetcher = async <T>(url: string): Promise<T> => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = (await r.json()) as T;
  fetchedAt.set(url, Date.now());
  return d;
};

export function useApi<T>(url: string | null, opts: ApiOpts<T> = {}) {
  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: swrMutate,
  } = useSWR<T>(url, opts.quiet ? quietFetcher : fetcher, {
    ...SWR_OPTS,
    keepPreviousData: !!opts.keepPrevious,
    ...(opts.fresh ? { revalidateOnMount: true, revalidateIfStale: true } : {}),
    ...(opts.refreshInterval ? { refreshInterval: opts.refreshInterval } : {}),
    ...(opts.revalidateOnFocus
      ? { revalidateOnFocus: true, focusThrottleInterval: opts.refreshInterval ?? 5_000 }
      : {}),
    // only pass the callbacks a caller gave: swr spreads options over its defaults, so an explicit
    // `undefined` would replace its no-op and crash every read
    ...(opts.onError ? { onError: (e: unknown) => opts.onError?.(errMsg(e)) } : {}),
    ...(opts.onSuccess ? { onSuccess: (d: T) => opts.onSuccess?.(d) } : {}),
  });
  useStaleCheck(opts.fresh ? null : url, opts.ttl ?? TTL_DEFAULT, swrMutate);
  /** ms since this key was last read from the server (Infinity when never) */
  const ageMs = React.useCallback(() => {
    const at = url ? fetchedAt.get(url) : undefined;
    return at ? Date.now() - at : Infinity;
  }, [url]);
  return {
    data,
    error: error ? errMsg(error) : null,
    loading: isLoading,
    validating: isValidating,
    mutate: swrMutate,
    ageMs,
  };
}
