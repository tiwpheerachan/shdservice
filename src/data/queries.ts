// A DB error throws on purpose: the page shows (app)/error.tsx instead of an empty list an admin might "fill in" again.

import type { MasterRow, Symptom } from './types';

export type Order = { column: string; ascending?: boolean };

// record_status view: active = ACTIVE only (dropdowns) · exclude = hide DELETED (lists) · only = DELETED · all
export type DeletedMode = 'active' | 'exclude' | 'only' | 'all';

// Admin tables list newest first (the services return id ASC, which the form
// dropdowns keep — that is the order people know from the legacy app). Copy
// before reversing: the service hands out its cached array.
const newestFirst = <T>(rows: T[]) => [...rows].reverse();
// brands are the one master people scan alphabetically
const byName = <T extends { name: string }>(rows: T[]) => [...rows].sort((a, b) => a.name.localeCompare(b.name, 'th'));

const masters = () => import('@/server/services/masters');

export const getCategories = async (): Promise<MasterRow[]> =>
  newestFirst(await (await masters()).listSimple('categories', 'exclude'));
export const getManufacturers = async (): Promise<MasterRow[]> =>
  byName(await (await masters()).listSimple('manufacturers', 'exclude'));
export const getColors = async (): Promise<MasterRow[]> =>
  newestFirst(await (await masters()).listSimple('colors', 'exclude'));
export const getJobTypes = async (): Promise<MasterRow[]> =>
  newestFirst(await (await masters()).listSimple('job_types', 'exclude'));
export const getProductTypes = async (): Promise<MasterRow[]> =>
  newestFirst(await (await masters()).listSimple('product_types', 'exclude'));
export const getSymptoms = async (): Promise<Symptom[]> => newestFirst(await (await masters()).listSymptoms('exclude'));
