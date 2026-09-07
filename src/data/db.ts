"use client";

import * as React from "react";
import { fetchTable, type Order } from "./queries";
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

/* ------------------------------------------------------------------ *
 * React hook wrapping the shared fetchTable() reader.
 * ------------------------------------------------------------------ */

export type TableState<T> = { data: T[]; loading: boolean; error: string | null };

export function useTable<T>(table: string, order?: Order): TableState<T> {
  const [data, setData] = React.useState<T[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const col = order?.column;
  const asc = order?.ascending;

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    fetchTable<T>(table, col ? { column: col, ascending: asc } : undefined)
      .then((rows) => {
        if (!active) return;
        setData(rows);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
        // eslint-disable-next-line no-console
        console.error("Supabase fetch failed:", e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [table, col, asc]);

  return { data, loading, error };
}

/* ------------------------------------------------------------------ *
 * Named hooks — one per table, with the display order used by the UI.
 * ------------------------------------------------------------------ */

export const useUsers = () => useTable<User>("users", { column: "id" });
export const usePermissions = () => useTable<Permission>("permissions", { column: "id" });
export const useCategories = () => useTable<MasterRow>("categories", { column: "id" });
export const useManufacturers = () =>
  useTable<MasterRow>("manufacturers", { column: "id" });
export const useColors = () => useTable<MasterRow>("colors", { column: "id" });
export const useJobTypes = () => useTable<MasterRow>("job_types", { column: "id" });
export const useProductTypes = () =>
  useTable<MasterRow>("product_types", { column: "id" });
export const useSymptoms = () => useTable<Symptom>("symptoms", { column: "id" });
export const useModels = () => useTable<Model>("models", { column: "code" });
export const useProducts = () => useTable<Product>("products", { column: "sysCode" });
export const useMovements = () =>
  useTable<Movement>("movements", { column: "date", ascending: false });
export const useCustomers = () => useTable<Customer>("customers", { column: "code" });
export const useJobs = () => useTable<Job>("jobs", { column: "no", ascending: false });
export const useQuotations = () =>
  useTable<Quotation>("quotations", { column: "no" });
export const useSaleOrders = () =>
  useTable<SaleOrder>("sale_orders", { column: "no", ascending: false });

export const useDashGroups = () =>
  useTable<DashGroup>("dash_groups", { column: "ord" });
export const useTatRows = () => useTable<TatRow>("tat_rows", { column: "ord" });
export const useMonthly = () => useTable<MonthlyRow>("monthly", { column: "ord" });
export const useTopSymptoms = () =>
  useTable<TopSymptom>("top_symptoms", { column: "ord" });
