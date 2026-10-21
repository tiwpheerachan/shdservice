import { z } from 'zod';
import { customerFields } from '@/lib/validation/customer';
import { quotationFields, quotationLine } from '@/lib/validation/quotation';
import { saleOrderSchema } from '@/lib/validation/sale-order';
import { approveSchema } from '@/lib/validation/stock';
import {
  CONFLICT,
  IDEMPOTENCY,
  JSON_BODY,
  RATE_LIMITED,
  SIGNED_IN,
  byNo,
  choice,
  jsonResponse,
  notFound,
  version,
} from './common';
import { defineOperation } from './registry';
import { Customer, QuotationDetail, SaleOrderDetail } from './shapes';

/** Customers, quotations (ใบเสนอราคา), sale orders (ใบสั่งขาย), "ออกเอกสารในนาม", the notification bell. */

const s = z.string();
const n = z.number();
/** a field the pages always send as text / a number (never null) */
const optText = s.optional();
const optNum = n.optional();

/**
 * saleOrderSchema(prev)'s fields without a stored order: the payment type and parcel no are checked
 * against the stored ones ("never worse"), so here they are only text — the service runs the whole set.
 */
const saleOrderFields = saleOrderSchema().shape;

export const customerSave = defineOperation({
  method: 'post',
  path: '/customers',
  tags: ['Customers'],
  summary: 'Create (no `code`) or update (with `code`) a customer',
  description:
    'Customer add / edit. Rules: `customerSchema(prev)` in src/lib/validation/customer.ts, run by the service against the stored customer. A phone / email / tax id another customer holds → 409 with `details.conflicts` and `details.fields`. A create takes an Idempotency-Key.',
  headers: IDEMPOTENCY.headers,
  invalid: IDEMPOTENCY.invalid,
  body: customerFields
    .extend({
      code: optText.meta({ description: 'Set = edit that customer.' }),
      name: optText,
      taxId: optText,
      type: optText.meta({ description: '`Normal` = a person.' }),
      online: z.boolean().optional(),
      cityId: optNum,
      districtId: optNum,
      subDistrictId: optNum,
      postalCode: optText,
      phone: optText,
      email: optText,
      line: optText,
      priceGroup: optText,
      status: optText,
      version,
    })
    .meta({ id: 'CustomerInput' }),
  responses: {
    200: jsonResponse('Updated.', z.object({ ok: z.literal(true), row: Customer })),
    201: jsonResponse('Created.', z.object({ ok: z.literal(true), row: Customer })),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No customer with that `code`.'),
    ...IDEMPOTENCY.responses,
  },
});

export const customerLookup = defineOperation({
  method: 'get',
  path: '/customers/lookup',
  tags: ['Customers'],
  summary: 'Find customers by code, tax id, name or phone (job / quotation / sale-order forms)',
  description:
    'An exact code answers that one customer; otherwise up to 20 matches. View on Customer or any form that picks one. Never a DELETED customer, except to System Admin asking `deleted=all` (the customers page opening one by its code).',
  query: z.object({
    q: s.optional(),
    deleted: choice(['all']).meta({
      description: '`all` = an exact code may answer a DELETED customer (System Admin only; anyone else as left out).',
    }),
  }),
  responses: {
    200: jsonResponse('Matches (empty without `q`).', z.object({ rows: z.array(Customer) })),
    ...SIGNED_IN,
    ...RATE_LIMITED,
  },
});

export const quotationGet = defineOperation({
  method: 'get',
  path: '/quotations/{no}',
  tags: ['Quotations'],
  summary: 'A quotation with its lines, customer and job',
  params: byNo('เลขที่ใบเสนอราคา'),
  responses: {
    200: jsonResponse('The quotation.', z.object({ quotation: QuotationDetail })),
    ...SIGNED_IN,
    ...notFound('No such quotation.'),
  },
});

export const quotationSave = defineOperation({
  method: 'post',
  path: '/quotations',
  tags: ['Quotations'],
  summary: 'Create (no `no`) or update (with `no`) a quotation',
  description:
    'Quotation add / edit. Rules: `quotationSchema(prevJobNo)` in src/lib/validation/quotation.ts, run by the service against the stored job no. A create takes an Idempotency-Key.',
  headers: IDEMPOTENCY.headers,
  invalid: IDEMPOTENCY.invalid,
  body: quotationFields
    .extend({
      no: optText.meta({ description: 'Set = edit that quotation.' }),
      documentProfileId: optNum,
      type: optText,
      customerCode: optText,
      jobNo: optText,
      lines: z
        .array(
          quotationLine.extend({
            id: optNum,
            code: optText,
          }),
        )
        .optional(),
      discountType: optText,
      discountUnit: optText.meta({ description: '`บาท` or `%`' }),
      status: optText.meta({ description: 'A new quotation: `รอเสนอราคา` (default) or `เสนอราคาแล้ว`.' }),
      jobParts: optText.meta({
        description:
          "A new quotation filled from its job: quotedPartsKey of the job's parts it copied — they changed since → 409.",
      }),
      version,
    })
    .meta({ id: 'QuotationInput' }),
  responses: {
    200: jsonResponse('Updated.', z.object({ ok: z.literal(true), quotation: QuotationDetail })),
    201: jsonResponse('Created.', z.object({ ok: z.literal(true), quotation: QuotationDetail })),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such quotation, customer or job.'),
    ...IDEMPOTENCY.responses,
  },
});

const soNo = byNo('เลขที่ใบสั่งขาย (SO…)');
const order = (what: string) => jsonResponse(what, z.object({ ok: z.literal(true), order: SaleOrderDetail }));

export const saleOrderGet = defineOperation({
  method: 'get',
  path: '/sale-orders/{no}',
  tags: ['Sale orders'],
  summary: 'A sale order with its lines',
  params: soNo,
  responses: {
    200: jsonResponse('The sale order.', z.object({ order: SaleOrderDetail })),
    ...SIGNED_IN,
    ...notFound('No such sale order.'),
  },
});

export const saleOrderSave = defineOperation({
  method: 'post',
  path: '/sale-orders',
  tags: ['Sale orders'],
  summary: 'Create (no `no`) or update (with `no`) a sale order; `submit: true` sends it for approval',
  description:
    "Sale Order add / edit. Rules: `saleOrderSchema(prev)` in src/lib/validation/sale-order.ts, run by the service against the stored order. A waiting order is its creator's (or System Admin's) to edit. A create takes an Idempotency-Key.",
  headers: IDEMPOTENCY.headers,
  invalid: IDEMPOTENCY.invalid,
  body: z
    .looseObject({
      ...saleOrderFields,
      lines: z
        .array(
          saleOrderFields.lines
            .unwrap()
            .element.extend({ name: optText, type: optText.meta({ description: '`SparePart` | `Service`' }) }),
        )
        .optional(),
      paymentType: optText,
      tracking: optText,
      documentProfileId: optNum,
      no: optText.meta({ description: 'Set = edit that order.' }),
      slip: optText,
      submit: z.boolean().optional(),
      version,
    })
    .meta({ id: 'SaleOrderInput' }),
  responses: {
    200: order('Updated.'),
    201: order('Created.'),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such sale order, customer or product.'),
    ...IDEMPOTENCY.responses,
  },
});

export const saleOrderApprove = defineOperation({
  method: 'post',
  path: '/sale-orders/{no}/approve',
  tags: ['Sale orders'],
  summary: 'Approve, deny, or send back a sale order (อนุมัติ / ปฏิเสธ / ส่งกลับแก้ไข)',
  description:
    'Sale Order edit + the special right SO Approve; never your own order. Approving issues the stock (a WHO document). Rules: `approveSchema` (src/lib/validation/stock.ts); a remark is required to deny.',
  params: soNo,
  body: approveSchema.extend({ version }),
  responses: {
    200: order('Decided; the order as stored now.'),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such sale order.'),
    ...CONFLICT,
  },
});

export const saleOrderTracking = defineOperation({
  method: 'post',
  path: '/sale-orders/{no}/tracking',
  tags: ['Sale orders'],
  summary: "Set a sale order's parcel number (เลขพัสดุ)",
  description:
    'Sale Order edit. Rules: `trackingSchema(prev)` (src/lib/validation/stock.ts), run by the service — an unchanged legacy number passes.',
  params: soNo,
  body: z.object({
    tracking: z
      .unknown()
      .optional()
      .transform((v) => String(v ?? ''))
      .meta({ type: 'string', description: 'A number is read as its digits; left out = none.' }),
    version,
  }),
  responses: {
    200: order('Saved.'),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such sale order.'),
    ...CONFLICT,
  },
});

export const documentProfileSet = defineOperation({
  method: 'post',
  path: '/documents/profile',
  tags: ['Documents'],
  summary: 'Change "ออกเอกสารในนาม" of an existing job, quotation or sale order',
  description: "Edit on the document's module. The number never changes; audited.",
  body: z.object({
    // in the order the route always checked them
    kind: z.enum(['job', 'quotation', 'sale_order'], { error: 'kind required' }),
    no: z
      .unknown()
      .optional()
      .transform((v) =>
        String(v ?? '')
          .trim()
          .toUpperCase(),
      )
      .pipe(z.string().min(1, 'no required'))
      .meta({ type: 'string', description: 'The document number (upper-cased).' }),
    profileId: z.coerce.number({ error: 'profileId required' }).positive('profileId required'),
  }),
  invalid: { body: 400 },
  responses: {
    200: jsonResponse(
      'The profile now on the document.',
      z.object({ ok: z.literal(true), profile: z.object({ id: n, code: s, nameTh: s }) }),
    ),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such document or profile.'),
  },
});

/** services/alerts.ts OverdueAlerts */
export const OverdueAlertsBody = z.object({
  scope: z.enum(['mine', 'all']),
  engineerId: n.nullable(),
  total: n,
  unassigned: n,
  owners: z.array(z.object({ engineerId: n.nullable(), name: s, count: n })),
  items: z.array(
    z.object({
      no: s,
      product: s,
      customer: s,
      status: s,
      dueDate: s,
      daysOver: n,
      engineer: s.nullable(),
      openedBy: s,
    }),
  ),
});

export const alertsOverdue = defineOperation({
  method: 'get',
  path: '/alerts/overdue',
  tags: ['Alerts'],
  summary: 'The bell: overdue open jobs (an Engineer sees only their own)',
  description: 'Job Management view.',
  responses: {
    200: jsonResponse('Overdue jobs.', OverdueAlertsBody),
    ...SIGNED_IN,
  },
});

/** services/alerts.ts PendingSaleOrders */
export const PendingSaleOrdersBody = z.object({
  total: n,
  items: z.array(z.object({ no: s, customer: s, amount: n, createdBy: s, date: s, days: n })),
});

export const alertsSaleOrders = defineOperation({
  method: 'get',
  path: '/alerts/sale-orders-pending',
  tags: ['Alerts'],
  summary: "The bell: sale orders waiting for approval (approvers only), minus the viewer's own",
  description: 'Sale Order edit + the special right SO Approve.',
  responses: {
    200: jsonResponse('Waiting orders.', PendingSaleOrdersBody),
    ...SIGNED_IN,
  },
});
