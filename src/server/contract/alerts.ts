import { z } from 'zod';
import { SIGNED_IN, choice, jsonResponse } from './common';
import { defineOperation } from './registry';

/** The bell's System Admin section: ค่าที่ไม่สมเหตุสมผล (the other bell operations are in sales.ts). */

const s = z.string();
const n = z.number();
/** services/anomalies.ts ANOMALY_CATEGORIES — repeated here: the contract is loaded without the server modules */
const KEYS = [
  'quotation_total',
  'sale_order_total',
  'job_parts_total',
  'job_total',
  'stock_negative',
  'stock_moves',
  'stock_booking',
  'zero_price',
  'discount_over',
] as const;
const category = z.enum(KEYS);

const Anomaly = z.object({
  category,
  ref: s.meta({ description: 'Document no. / job no. / product code — what is shown' }),
  message: s.meta({ description: 'Thai, with both numbers' }),
  stored: n,
  expected: n,
  href: s.meta({ description: "The record's page, by its uuid" }),
});
const counts = {
  total: n,
  categories: z.array(z.object({ key: category, label: s, count: n })),
};

/** services/anomalies.ts Anomalies */
export const AnomaliesBody = z.object({ ...counts, items: z.array(Anomaly) });
/** services/anomalies.ts AnomalyPage */
export const AnomalyPageBody = z.object({
  ...counts,
  rows: z.array(Anomaly),
  matched: n.meta({ description: 'Rows of the chosen category (all: = total) — from the cached counts' }),
  page: n,
  pageSize: n,
});

const ADMIN =
  'System Admin only. Report only — nothing is fixed. Checks: quotation / sale order header vs its lines, job parts and total, product stock (negative, vs movements, booking vs open requests), charged lines at price 0, a discount over its amount. The counts are cached 5 minutes.';

export const alertsAnomalies = defineOperation({
  method: 'get',
  path: '/alerts/anomalies',
  tags: ['Alerts'],
  summary: 'The bell (System Admin): counts of stored values that do not add up + the first 2 of each category',
  description: ADMIN,
  responses: {
    200: jsonResponse('Counts by category and a sample.', AnomaliesBody),
    ...SIGNED_IN,
  },
});

export const alertsAnomaliesList = defineOperation({
  method: 'get',
  path: '/alerts/anomalies/list',
  tags: ['Alerts'],
  summary: 'The /admin/anomalies list: one page, optionally one category',
  description: ADMIN,
  query: z.object({
    page: s.optional().meta({ description: 'From 1.' }),
    pageSize: s.optional().meta({ description: '1–100, default 50.' }),
    category: choice(KEYS).meta({ description: 'Anything else: every category.' }),
  }),
  responses: {
    200: jsonResponse('One page.', AnomalyPageBody),
    ...SIGNED_IN,
  },
});
