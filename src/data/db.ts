"use client";

import * as React from "react";
import { api, qs } from "@/lib/api";
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
 * ------------------------------------------------------------------ */

export type TableState<T> = {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

export type Params = Record<string, string | number | boolean | undefined | null>;

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
  params: Params = {}
): TableState<T> {
  const [data, setData] = React.useState<T[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const refetch = React.useCallback(() => setNonce((n) => n + 1), []);

  const col = order?.column;
  const asc = order?.ascending;
  const paramKey = JSON.stringify(params);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    const p = JSON.parse(paramKey) as Params;
    api<T[]>(`/api/data/${table}${qs({ deleted, ...p })}`)
      .then((rows) => {
        if (!active) return;
        setData(sortRows(Array.isArray(rows) ? rows : [], col ? { column: col, ascending: asc } : undefined));
        setError(null);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
        // eslint-disable-next-line no-console
        console.error("fetch failed:", e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [table, col, asc, nonce, deleted, paramKey]);

  return { data, loading, error, refetch };
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

export function usePagedTable<T>(table: string, params: PageParams, deleted: DeletedMode = "exclude"): PageState<T> {
  const [rows, setRows] = React.useState<T[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const refetch = React.useCallback(() => setNonce((n) => n + 1), []);
  const key = JSON.stringify(params);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    const p = JSON.parse(key) as PageParams;
    api<{ rows: T[]; total: number }>(`/api/data/${table}${qs({ paged: 1, deleted, ...p })}`)
      .then((d) => {
        if (!active) return;
        setRows(d.rows ?? []);
        setTotal(d.total ?? 0);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [table, key, nonce, deleted]);

  return { rows, total, loading, error, refetch };
}

/* ------------------------------------------------------------------ *
 * Named hooks — one per resource, with the display order used by the UI.
 * ------------------------------------------------------------------ */

export const useUsers = (deleted: DeletedMode = "exclude") =>
  useTable<User>("users", { column: "id" }, deleted);
export const usePermissions = () => useTable<Permission>("permissions", { column: "id" });
// Master lookups feed dropdowns → ACTIVE rows only (INACTIVE stay visible on the admin pages).
export const useCategories = (mode: DeletedMode = "active") => useTable<MasterRow>("categories", { column: "id" }, mode);
export const useManufacturers = (mode: DeletedMode = "active") =>
  useTable<MasterRow>("manufacturers", { column: "name" }, mode);
export const useColors = (mode: DeletedMode = "active") => useTable<MasterRow>("colors", { column: "id" }, mode);
export const useJobTypes = (mode: DeletedMode = "active") => useTable<MasterRow>("job_types", { column: "id" }, mode);
export const useProductTypes = (mode: DeletedMode = "active") =>
  useTable<MasterRow>("product_types", { column: "id" }, mode);
export const useSymptoms = (mode: DeletedMode = "active") => useTable<Symptom>("symptoms", { column: "id" }, mode);
export const useModels = (mode: DeletedMode = "active") => useTable<Model>("models", { column: "code" }, mode);
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
export const useAuditModules = () => useTable<string>("audit_modules");
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

export const useDashGroups = () => useTable<DashGroup>("dash_groups", { column: "ord" });
export const useTatRows = () => useTable<TatRow>("tat_rows");
export const useMonthly = () => useTable<MonthlyRow>("monthly");
export const useTopSymptoms = () => useTable<TopSymptom>("top_symptoms");

/* ---- lookups added for the real backend ---- */
export type Staff = { id: number; name: string; userType: string };
export const useStaff = () => useTable<Staff>("staff");
export const useRoles = () => useTable<string>("roles");
export const useModules = () => useTable<string>("modules");
export const useProvinces = () => useTable<{ id: number; name: string }>("provinces");
export const useJobStatuses = () =>
  useTable<{ id: number; name: string; group: string; order: number; active: boolean }>("job_statuses");
export const useVendors = () => useTable<string>("vendors");
/** งานย่อย / บริษัทขนส่ง — ค่าที่ใช้อยู่ใน DB สำหรับ datalist (พิมพ์ค่าใหม่ได้) */
export const useJobTypeDetails = () => useTable<string>("job_type_details");
export const useShippers = () => useTable<string>("shippers");
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
