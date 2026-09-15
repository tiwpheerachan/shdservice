// Server-side getters used by the admin master pages (server components).
// They call the drizzle-backed services directly (no HTTP round-trip).

import type { MasterRow, Symptom } from "./mock";

export type Order = { column: string; ascending?: boolean };

// Soft-delete view: hide deleted rows (default), show only deleted, or show all.
export type DeletedMode = "exclude" | "only" | "all";

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
  safe(async () => (await import("@/server/services/masters")).listSimple("categories", "all"));
export const getManufacturers = (): Promise<MasterRow[]> =>
  safe(async () => (await import("@/server/services/masters")).listSimple("manufacturers", "all"));
export const getColors = (): Promise<MasterRow[]> =>
  safe(async () => (await import("@/server/services/masters")).listSimple("colors", "all"));
export const getJobTypes = (): Promise<MasterRow[]> =>
  safe(async () => (await import("@/server/services/masters")).listSimple("job_types", "all"));
export const getProductTypes = (): Promise<MasterRow[]> =>
  safe(async () => (await import("@/server/services/masters")).listSimple("product_types", "all"));
export const getSymptoms = (): Promise<Symptom[]> =>
  safe(async () => (await import("@/server/services/masters")).listSymptoms("all"));
