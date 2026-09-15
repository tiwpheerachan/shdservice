// Server-side getters used by the admin master pages (server components).
// They call the drizzle-backed services directly (no HTTP round-trip).

import type { MasterRow, Symptom } from "./mock";

export type Order = { column: string; ascending?: boolean };

// record_status view: active = ACTIVE only (dropdowns) · exclude = hide DELETED (lists) · only = DELETED · all
export type DeletedMode = "active" | "exclude" | "only" | "all";

/**
 * Resilient wrapper for server components: if the DB is unreachable (e.g.
 * DATABASE_URL not configured yet) return an empty list so the page renders its
 * empty state instead of crashing.
 */
async function safe<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("DB fetch failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

export const getCategories = (): Promise<MasterRow[]> =>
  safe(async () => (await import("@/server/services/masters")).listSimple("categories", "exclude"));
export const getManufacturers = (): Promise<MasterRow[]> =>
  safe(async () => (await import("@/server/services/masters")).listSimple("manufacturers", "exclude"));
export const getColors = (): Promise<MasterRow[]> =>
  safe(async () => (await import("@/server/services/masters")).listSimple("colors", "exclude"));
export const getJobTypes = (): Promise<MasterRow[]> =>
  safe(async () => (await import("@/server/services/masters")).listSimple("job_types", "exclude"));
export const getProductTypes = (): Promise<MasterRow[]> =>
  safe(async () => (await import("@/server/services/masters")).listSimple("product_types", "exclude"));
export const getSymptoms = (): Promise<Symptom[]> =>
  safe(async () => (await import("@/server/services/masters")).listSymptoms("exclude"));
