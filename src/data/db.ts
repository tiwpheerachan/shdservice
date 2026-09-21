"use client";

import * as React from "react";
import useSWR, { mutate, type SWRConfiguration } from "swr";
import { api, qs, errMsg, onApiWrite } from "@/lib/api";
import type { Order, DeletedMode } from "./queries";
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
} from "./mock";

export type { Order, DeletedMode };

/* ------------------------------------------------------------------ *
 * React hooks over the app's read API (/api/data/<resource>). The hook names
 * and return shapes are the ones the pages already use; data now comes from
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

export type Params = Record<string, string | number | boolean | undefined | null>;

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
const fetcher = async <T,>(url: string): Promise<T> => {
  const d = await api<T>(url);
  fetchedAt.set(url, Date.now());
  return d;
};

/** Forget every list's age and re-fetch the ones on screen — called after each write. */
export function invalidateLists() {
  fetchedAt.clear();
  void mutate((key) => typeof key === "string" && key.startsWith("/api/data/"));
}
onApiWrite(invalidateLists);

/** Re-fetch a cached key when it is older than `ttl` (or its age is unknown). */
function useStaleCheck(url: string, hasData: boolean, ttl: number, revalidate: () => Promise<unknown>) {
  React.useEffect(() => {
    if (!hasData) return; // no cache → swr fetches on mount by itself
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
    if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
    return String(x ?? "").localeCompare(String(y ?? ""), "th") * dir;
  });
}

export function useTable<T>(
  table: string,
  order?: Order,
  deleted: DeletedMode = "exclude",
  params: Params = {},
  ttl: number = TTL_DEFAULT
): TableState<T> {
  const url = `/api/data/${table}${qs({ deleted, ...params })}`;
  const { data, error, isLoading, mutate: revalidate } = useSWR<T[]>(url, fetcher, SWR_OPTS);
  useStaleCheck(url, data !== undefined, ttl, revalidate);

  const col = order?.column;
  const asc = order?.ascending;
  const rows = React.useMemo(
    () => sortRows(Array.isArray(data) ? data : [], col ? { column: col, ascending: asc } : undefined),
    [data, col, asc]
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
  dir?: "asc" | "desc";
} & Params;

const EMPTY: never[] = [];

export function usePagedTable<T>(table: string, params: PageParams, deleted: DeletedMode = "exclude"): PageState<T> {
  const url = `/api/data/${table}${qs({ paged: 1, deleted, ...params })}`;
  const { data, error, isLoading, mutate: revalidate } = useSWR<{ rows: T[]; total: number }>(url, fetcher, SWR_OPTS);
  useStaleCheck(url, data !== undefined, TTL_DEFAULT, revalidate);
  const refetch = React.useCallback(() => {
    void revalidate();
  }, [revalidate]);

  return { rows: data?.rows ?? EMPTY, total: data?.total ?? 0, loading: isLoading, error: error ? errMsg(error) : null, refetch };
}

/* ------------------------------------------------------------------ *
 * Named hooks — one per resource, with the display order used by the UI.
 * ------------------------------------------------------------------ */

export const useUsers = (deleted: DeletedMode = "exclude") =>
  useTable<User>("users", { column: "id" }, deleted, {}, TTL_MASTER);
export const usePermissions = () => useTable<Permission>("permissions", { column: "id" }, "exclude", {}, TTL_MASTER);
// Master lookups feed dropdowns → ACTIVE rows only (INACTIVE stay visible on the admin pages).
export const useCategories = (mode: DeletedMode = "active") => useTable<MasterRow>("categories", { column: "id" }, mode, {}, TTL_MASTER);
export const useManufacturers = (mode: DeletedMode = "active") =>
  useTable<MasterRow>("manufacturers", { column: "name" }, mode, {}, TTL_MASTER);
export const useColors = (mode: DeletedMode = "active") => useTable<MasterRow>("colors", { column: "id" }, mode, {}, TTL_MASTER);
export const useJobTypes = (mode: DeletedMode = "active") => useTable<MasterRow>("job_types", { column: "id" }, mode, {}, TTL_MASTER);
export const useProductTypes = (mode: DeletedMode = "active") =>
  useTable<MasterRow>("product_types", { column: "id" }, mode, {}, TTL_MASTER);
export const useSymptoms = (mode: DeletedMode = "active") => useTable<Symptom>("symptoms", { column: "id" }, mode, {}, TTL_MASTER);
export const useModels = (mode: DeletedMode = "active") => useTable<Model>("models", { column: "code" }, mode, {}, TTL_MASTER);
export const useModelsPage = (params: PageParams, mode: DeletedMode = "exclude") => usePagedTable<Model>("models", params, mode);
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
export const useAuditPage = (params: PageParams) => usePagedTable<AuditRow>("audit_log", params, "all");
export const useAuditModules = () => useTable<string>("audit_modules", undefined, "exclude", {}, TTL_MASTER);
/** Dropdown/picker list: ACTIVE products, lite fields only (code/name/onhand/price/brand/category). */
export const useProducts = (params: Params = {}) =>
  useTable<Product>("products", { column: "sysCode" }, "active", { fields: "lite", ...params });
export const useProductsPage = (params: PageParams, mode: DeletedMode = "exclude") =>
  usePagedTable<Product & { value: number }>("products", params, mode);
export type ProductStats = { total: number; qty: number; value: number; low: number; out: number };
export const useProductStats = (params: Params = {}, mode: DeletedMode = "exclude") =>
  useTable<ProductStats>("product_stats", undefined, mode, params);
export const useMovements = (params: Params = {}) =>
  useTable<Movement>("movements", undefined, "exclude", params);
export const useMovementsPage = (params: PageParams) => usePagedTable<Movement>("movements", params);
/** Recent customers (server caps the list); pass { q } to search the whole table. */
export const useCustomers = (params: Params = {}) => useTable<Customer>("customers", undefined, "exclude", params);
export const useCustomersPage = (params: PageParams, deleted: DeletedMode = "exclude") =>
  usePagedTable<Customer>("customers", params, deleted);
/** Server-filtered job list (reports, dropdowns). Use useJobsPage for the big list. */
export const useJobs = (params: Params = {}) => useTable<Job>("jobs", undefined, "exclude", params);
export const useJobsPage = (params: PageParams) => usePagedTable<Job>("jobs", params);
export const useQuotations = (params: Params = {}) =>
  useTable<Quotation>("quotations", undefined, "exclude", params);
export const useQuotationsPage = (params: PageParams) => usePagedTable<Quotation>("quotations", params);
export const useSaleOrders = (params: Params = {}) =>
  useTable<SaleOrder>("sale_orders", undefined, "exclude", params);
export const useSaleOrdersPage = (params: PageParams) => usePagedTable<SaleOrder>("sale_orders", params);

/** Dashboard — `range` = { from, to } (YYYY-MM-DD, both empty = all time); TAT is always a live snapshot */
export type DashRange = { from?: string; to?: string };
export const useDashGroups = (range: DashRange = {}) => useTable<DashGroup>("dash_groups", { column: "ord" }, "exclude", range);
export const useTatRows = () => useTable<TatRow>("tat_rows");
export const useMonthly = (range: DashRange = {}) => useTable<MonthlyRow & { granularity?: "day" | "month" }>("monthly", undefined, "exclude", range);
export const useTopSymptoms = (range: DashRange = {}) => useTable<TopSymptom>("top_symptoms", undefined, "exclude", range);

/* ---- lookups added for the real backend ---- */
export type Staff = { id: number; name: string; userType: string };
export const useStaff = () => useTable<Staff>("staff", undefined, "exclude", {}, TTL_MASTER);
export const useRoles = () => useTable<string>("roles", undefined, "exclude", {}, TTL_MASTER);
export const useModules = () => useTable<string>("modules", undefined, "exclude", {}, TTL_MASTER);
export const useProvinces = () => useTable<{ id: number; name: string }>("provinces", undefined, "exclude", {}, TTL_MASTER);
export const useJobStatuses = () =>
  useTable<{ id: number; name: string; group: string; order: number; active: boolean }>("job_statuses", undefined, "exclude", {}, TTL_MASTER);
export const useVendors = () => useTable<string>("vendors", undefined, "exclude", {}, TTL_MASTER);
/** งานย่อย / บริษัทขนส่ง — ค่าที่ใช้อยู่ใน DB สำหรับ datalist (พิมพ์ค่าใหม่ได้) */
export const useJobTypeDetails = () => useTable<string>("job_type_details", undefined, "exclude", {}, TTL_MASTER);
export type DocumentProfileLite = { id: number; code: string; nameTh: string; nameEn: string; isDefault: boolean; prefixJob: string; prefixQuotation: string; prefixSaleOrder: string; logoUrl: string };
/** โปรไฟล์ผู้ออกเอกสาร (active) — dropdown "ออกเอกสารในนาม" */
export const useDocumentProfiles = () => useTable<DocumentProfileLite>("document_profiles", undefined, "exclude", {}, TTL_MASTER);
export const useShippers = () => useTable<string>("shippers", undefined, "exclude", {}, TTL_MASTER);
/** อาการเสีย เรียงตามความถี่ที่ใช้จริง + อาการที่พบบ่อยของรุ่น (SymptomPicker) */
export type SymptomStat = { id: number; name: string; group: string; count: number };
export const useSymptomStats = () => useTable<SymptomStat>("symptom_stats", undefined, "exclude", {}, TTL_MASTER);
export const useModelSymptoms = (model: string) => useTable<{ id: number; name: string; count: number }>("model_symptoms", undefined, "exclude", { model }, TTL_MASTER);
export type IssuedLine = Movement & { code: string; item: string; category: string; qty: number; value: number };
export const useIssuedLines = (params: Params = {}) => useTable<IssuedLine>("issued_lines", undefined, "exclude", params);
export const useIssuedLinesPage = (params: PageParams) => usePagedTable<IssuedLine>("issued_lines", params);
export type IssuedStats = { lines: number; qty: number; value: number; top: string };
export const useIssuedStats = (params: Params = {}) => useTable<IssuedStats>("issued_stats", undefined, "exclude", params);

/* ---- report KPI summaries (same filters as the paged tables) ---- */
export type JobSummary = { total: number; fresh: number; done: number; amount: number; paid: number; avgTat: number; over30: number; topChannel: string };
export const useJobSummary = (params: Params = {}) => useTable<JobSummary>("job_summary", undefined, "exclude", params);
export type QuotationSummary = { total: number; agreed: number; amount: number; agreedAmount: number };
export const useQuotationSummary = (params: Params = {}) => useTable<QuotationSummary>("quotation_summary", undefined, "exclude", params);
export type SaleOrderSummary = { total: number; approved: number; amount: number; avg: number };
export const useSaleOrderSummary = (params: Params = {}) => useTable<SaleOrderSummary>("sale_order_summary", undefined, "exclude", params);
export const useJobStats = () =>
  useTable<{ total: number; fresh: number; done: number; progress: number }>("job_stats");
/** Job numbers for reference dropdowns: recent open jobs (default), or `mode` = "pending_parts" / "returnable" (ตัดจ่าย / รับคืน). */
export const useJobNos = (limit = 50, mode?: "pending_parts" | "returnable") =>
  useTable<string>("job_nos", undefined, "exclude", mode ? { limit, mode } : { limit });
