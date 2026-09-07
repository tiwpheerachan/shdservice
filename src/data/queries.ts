// Neutral data-access helper — the single place that talks to PostgREST.
// DB column names match the TS types 1:1 (camelCase), so rows need no mapping.

import { supabase } from "@/lib/supabase";
import type { MasterRow, Symptom } from "./mock";

export type Order = { column: string; ascending?: boolean };

export async function fetchTable<T>(table: string, order?: Order): Promise<T[]> {
  let query = supabase.from(table).select("*");
  if (order) query = query.order(order.column, { ascending: order.ascending ?? true });
  const { data, error } = await query;
  if (error) throw new Error(`[${table}] ${error.message}`);
  return (data ?? []) as T[];
}

/**
 * Resilient wrapper for server components: if the table is missing (e.g. the
 * Supabase schema hasn't been created yet) or the request fails, return an
 * empty list so the page renders its empty state instead of crashing.
 */
async function safeFetch<T>(table: string, order?: Order): Promise<T[]> {
  try {
    return await fetchTable<T>(table, order);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Supabase fetch failed:", e);
    return [];
  }
}

/* Server-side getters used by the admin master pages (server components). */
export const getCategories = () => safeFetch<MasterRow>("categories", { column: "id" });
export const getManufacturers = () =>
  safeFetch<MasterRow>("manufacturers", { column: "id" });
export const getColors = () => safeFetch<MasterRow>("colors", { column: "id" });
export const getJobTypes = () => safeFetch<MasterRow>("job_types", { column: "id" });
export const getProductTypes = () =>
  safeFetch<MasterRow>("product_types", { column: "id" });
export const getSymptoms = () => safeFetch<Symptom>("symptoms", { column: "id" });
