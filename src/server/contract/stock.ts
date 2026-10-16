import { z } from 'zod';
import { productSchema } from '@/lib/validation/admin';
import { issueSchema, receiveSchema } from '@/lib/validation/stock';
import {
  CONFLICT,
  IDEMPOTENCY,
  JSON_BODY,
  SIGNED_IN,
  byNo,
  errorResponse,
  jsonResponse,
  notFound,
  version,
} from './common';
import { defineOperation } from './registry';
import { PartRequestLine, Product } from './shapes';

/** Spare parts (อะไหล่) and stock in / out. */

const s = z.string();
const n = z.number();

/** services/stock.ts productStockCard rows */
export const StockCardLine = z.object({
  no: s,
  date: s,
  type: s,
  before: n,
  income: n,
  outcome: n,
  after: n,
  ref: s,
  remark: s,
});

export const productGet = defineOperation({
  method: 'get',
  path: '/products/{code}',
  tags: ['Products'],
  summary: 'A spare part with its stock card (product-detail modal)',
  description: 'Any approved user. ราคาทุน and `version` only for a role with the special right Product Cost.',
  params: z.object({ code: s.meta({ description: 'รหัสอะไหล่ (system code)' }) }),
  responses: {
    200: jsonResponse(
      'The part and its movements.',
      z.object({
        product: Product,
        card: z.array(StockCardLine),
      }),
    ),
    ...SIGNED_IN,
    ...notFound('No such part.'),
  },
});

export const productSave = defineOperation({
  method: 'post',
  path: '/products',
  tags: ['Products'],
  summary: 'Create (no `sysCode`) or update (with `sysCode`) a spare part',
  description:
    'Product add / edit. Rules: `productSchema(prev)` in src/lib/validation/admin.ts, run by the service against the stored part. `capitalPrice` is ignored for a role without Product Cost (a new part then starts at 0). `sameMfgCode` lists other parts with the same vendor code — saved anyway, the form warns.',
  body: z
    .looseObject({
      // productSchema(prev)'s fields; the vendor code is checked against the stored one ("never worse") by the service
      ...productSchema().shape,
      mfgCode: s.nullish(),
      sysCode: s.nullish().meta({ description: 'Set = edit that part.' }),
      category: s.nullish(),
      brand: s.nullish(),
      status: s.nullish(),
      ubRepairOnly: z.boolean().nullish(),
      models: z.array(s).nullish(),
      version,
    })
    .meta({ id: 'ProductInput' }),
  responses: {
    200: jsonResponse(
      'Saved.',
      z.object({ ok: z.literal(true), row: Product, sameMfgCode: z.array(s).meta({ description: 'system codes' }) }),
    ),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such part, category, brand or model.'),
    ...CONFLICT,
  },
});

const docTotal = z.object({ ok: z.literal(true), no: s.meta({ description: 'the WHI / WHO document no' }), total: n });

export const stockIssue = defineOperation({
  method: 'post',
  path: '/stock/issue',
  tags: ['Stock'],
  summary: 'Issue parts (ตัดจ่าย → WHO), or take parts back from a job (`type: "return"` → WHI)',
  description:
    'Product Pick Stock add. Rules: `issueSchema` (src/lib/validation/stock.ts); `payTo` must be the good-stock store or a current staff name. `job` lines name `logId`, `sale` lines `dtId`, `other` lines `code`. Takes an Idempotency-Key.',
  headers: IDEMPOTENCY.headers,
  invalid: IDEMPOTENCY.invalid,
  body: issueSchema,
  responses: {
    201: jsonResponse(
      'The document made. `allGranted` (job only): every requested part of the job is now issued.',
      docTotal.extend({ allGranted: z.boolean().optional() }),
    ),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such job, sale order or part.'),
    ...IDEMPOTENCY.responses,
  },
});

export const stockReceive = defineOperation({
  method: 'post',
  path: '/stock/receive',
  tags: ['Stock'],
  summary: 'Receive parts into stock (รับเข้า → WHI)',
  description:
    'Product Receive Stock add. Rules: `receiveSchema` (src/lib/validation/stock.ts). Takes an Idempotency-Key.',
  headers: IDEMPOTENCY.headers,
  invalid: IDEMPOTENCY.invalid,
  body: receiveSchema,
  responses: {
    201: jsonResponse('The document made.', docTotal),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such part.'),
    ...IDEMPOTENCY.responses,
  },
});

/** services/stock.ts movementLines rows */
export const MovementLine = z.object({ code: s, name: s, qty: n, unit: s, supplier: s, ref: s });

export const stockMovementLines = defineOperation({
  method: 'get',
  path: '/stock/movements/{no}',
  tags: ['Stock'],
  summary: "A stock document's lines",
  params: byNo('WHI / WHO document no'),
  responses: {
    200: jsonResponse('Lines.', z.object({ rows: z.array(MovementLine) })),
    ...SIGNED_IN,
  },
});

/** services/stock.ts SoPickLine */
export const SaleOrderPickLine = z.object({
  dtId: n,
  code: s,
  name: s,
  onhand: n,
  need: n,
  picked: z.boolean(),
  pickNo: s,
});

/** services/stock.ts ReturnLine */
export const ReturnableLine = z.object({
  logId: n,
  jobNo: s,
  code: s,
  name: s,
  onhand: n,
  granted: n,
  returned: n,
  returnable: n,
  status: s,
});

export const stockPickLines = defineOperation({
  method: 'get',
  path: '/stock/pick-lines',
  tags: ['Stock'],
  summary: 'Lines to issue / take back for a reference document',
  description: 'Product Pick Stock view. The row shape follows `type`.',
  query: z.object({
    // in the order the route always checked them
    ref: z
      .string({ error: 'ref required' })
      .trim()
      .min(1, 'ref required')
      .meta({ description: 'หมายเลขงาน (job, return) or เลขที่ใบสั่งขาย (sale)' }),
    type: z.enum(['job', 'sale', 'return'], { error: 'type must be job, sale or return' }),
  }),
  invalid: { query: 400 },
  responses: {
    200: jsonResponse(
      '`job`: the requested parts; `sale`: the order lines; `return`: what can come back.',
      z.object({
        rows: z.union([z.array(PartRequestLine), z.array(SaleOrderPickLine), z.array(ReturnableLine)]),
      }),
    ),
    ...SIGNED_IN,
    400: errorResponse('`ref` missing, or `type` not job / sale / return.'),
    ...notFound('No such job.'),
    409: errorResponse('The job is closed / cancelled — nothing left to issue.'),
  },
});

export const stockPickOrders = defineOperation({
  method: 'get',
  path: '/stock/pick-orders',
  tags: ['Stock'],
  summary: 'Approved sale orders that still have a line to issue',
  responses: {
    200: jsonResponse('Sale order numbers.', z.object({ rows: z.array(s) })),
    ...SIGNED_IN,
  },
});
