import { z } from 'zod';
import { isRealDate } from '@/lib/validation';
import { deletedMode } from './admin';
import { RATE_LIMITED, SIGNED_IN, choice, errorResponse, jsonResponse, page } from './common';
import { defineOperation, type Operation } from './registry';
import {
  AuditRow,
  Customer,
  DocumentProfile,
  IssuedLine,
  Job,
  MasterRow,
  Model,
  Movement,
  Permission,
  Product,
  Quotation,
  SaleOrder,
  ShippingProfile,
  Symptom,
  SystemUser,
} from './shapes';

/**
 * GET /api/data/{resource} — the read side of the pages' data hooks (src/data/db.ts → src/server/resources.ts).
 * One route, but every resource answers its own shape, so each is its own operation here, at its
 * literal path. A list answers an array; with `paged=1` (where offered) one page `{ rows, total, page, pageSize }`.
 *
 * The query is read as the lists always have (src/server/resources.ts): any other name is a filter of
 * the list, and a choice outside its values is read as left out — never a 400.
 */

const s = z.string();
const n = z.number();
const tags = ['Data'];
const q = s.optional().meta({ description: 'Free-text search.' });
/** a date filter: a real day or left out — 2026-02-30 / "abc" is a 400 under its name, not a silently dropped filter */
const ymd = s
  .refine((v) => v === '' || isRealDate(v), 'วันที่ไม่ถูกต้อง (YYYY-MM-DD)')
  .optional()
  .meta({ format: 'date' });
const BAD_DATE = { 400: errorResponse('A date filter that is not a real day (YYYY-MM-DD) — `details.fields`.') };
const limit = s.optional().meta({
  description:
    'Row cap of the unpaged list: at most 1000 (default 200; job_nos 50, or 300 with a mode). More rows: GET /export/{resource}.',
});
const flag = choice(['1']);
/** ?page=&pageSize=&sort=&dir= (src/server/paging.ts parsePageQuery) */
const PAGING = {
  paged: flag.meta({ description: '`1` = answer one page `{ rows, total, page, pageSize }`.' }),
  page: s.optional().meta({ description: 'From 1.' }),
  pageSize: s.optional().meta({ description: '1–500, default 25.' }),
  sort: s.optional().meta({ description: 'A column key of the list.' }),
  dir: choice(['asc', 'desc'], 'asc'),
};

const ANY = 'Any approved user.';
const ADMIN = 'System Admin only.';
const viewOn = (...modules: string[]) => `View on ${modules.join(' or ')}.`;

/** each resource's operation, by name — the route parses the query with its declaration */
export const dataOperations = new Map<string, Operation & { query: z.ZodObject }>();
/** the path parameter of GET /api/data/{resource} (each resource is documented at its own path) */
export const dataResource = { params: z.object({ resource: s }) };
/** a name no resource has: answered 404 by src/server/resources.ts (after the session check) */
export const unknownResource = { query: z.looseObject({}) };

function resource(
  name: string,
  summary: string,
  access: string,
  body: z.ZodType,
  query: z.ZodRawShape = {},
  paged?: z.ZodType,
) {
  const operation = defineOperation({
    method: 'get',
    path: `/data/${name}`,
    tags,
    summary,
    description: access,
    query: z.looseObject({ ...(paged ? PAGING : {}), ...query }),
    responses: {
      200: jsonResponse(
        paged ? 'The list, or one page of it with `paged=1`.' : 'The list.',
        paged ? z.union([page(paged), body]) : body,
      ),
      ...(Object.values(query).includes(ymd) ? BAD_DATE : {}),
      ...SIGNED_IN,
      ...RATE_LIMITED,
    },
  });
  dataOperations.set(name, operation);
  return operation;
}

const list = <T extends z.ZodType>(row: T) => z.array(row);
/** a "list" of one summary row — the hooks read every resource as a list */
const one = <T extends z.ZodType>(row: T) => z.array(row).length(1);
const strings = z.array(s);

const auditFilters = { from: ymd, to: ymd, user: s.optional(), module: s.optional(), entity: s.optional() };
resource(
  'audit_log',
  'Audit log (ประวัติการใช้งาน)',
  ADMIN,
  list(AuditRow),
  {
    ...auditFilters,
    key: s.optional(),
    action: s.optional(),
    q,
    limit,
  },
  AuditRow,
);
resource('audit_modules', 'The modules that appear in the audit log', ADMIN, strings);
resource('users', 'System users', ADMIN, list(SystemUser), { deleted: deletedMode });
resource('permissions', 'The permission matrix', ADMIN, list(Permission));
resource('roles', 'Role names (user_type)', ADMIN, strings);
resource('modules', 'Module names', ADMIN, strings);

for (const kind of ['categories', 'manufacturers', 'colors', 'job_types', 'product_types'] as const)
  resource(kind, `Master data: ${kind}`, ANY, list(MasterRow), { deleted: deletedMode });
resource('symptoms', 'Master data: symptoms', ANY, list(Symptom), { deleted: deletedMode });
resource(
  'models',
  'Master data: models',
  ANY,
  list(Model),
  { deleted: deletedMode, brand: s.optional(), code: s.optional(), name: s.optional(), status: s.optional() },
  Model,
);

resource(
  'staff',
  'Staff names for pickers (ผู้รับ / ช่าง / พนักงานขาย)',
  ANY,
  list(z.object({ id: n, name: s, userType: s, takesJobs: z.boolean(), sells: z.boolean() })),
  { usedAs: choice(['engineer', 'sales']) },
);
resource('provinces', 'Provinces', ANY, list(z.object({ id: n, name: s })));
resource(
  'job_statuses',
  'Job statuses',
  ANY,
  list(z.object({ id: n, name: s, group: s, order: n, active: z.boolean() })),
);
resource('quotation_statuses', 'Quotation statuses', ANY, list(z.object({ id: n, name: s })));
resource('vendors', 'Out-source repairers used before', ANY, strings);
resource('job_type_details', 'Job sub-types (งานย่อย) used before', ANY, strings);
resource(
  'symptom_stats',
  'How often each symptom was reported',
  ANY,
  list(z.object({ id: n, name: s, group: s, count: n })),
);
resource('model_symptoms', 'Symptoms reported for a model', ANY, list(z.object({ id: n, name: s, count: n })), {
  model: s.optional(),
});
resource('shippers', 'Couriers used before', ANY, strings);
resource('document_profiles', 'Active document profiles (ออกเอกสารในนาม)', ANY, list(DocumentProfile));
resource('shipping_profiles', 'Active courier profiles', ANY, list(ShippingProfile));
resource('job_nos', 'Job numbers for pickers', ANY, strings, {
  mode: choice(['pending_parts', 'returnable']).meta({ description: 'none = the most recent jobs' }),
  limit,
});

const productFilters = {
  deleted: deletedMode,
  q,
  status: s.optional(),
  sysCode: s.optional(),
  mfgCode: s.optional(),
  name: s.optional(),
  brand: s.optional(),
  category: s.optional(),
  creator: s.optional(),
  date: ymd,
  model: s.optional(),
  stock: choice(['in', 'low', 'out']),
};
resource(
  'products',
  'Spare parts (no ราคาทุน in any list)',
  ANY,
  z.union([
    list(Product),
    list(
      z.object({
        brand: s,
        name: s,
        nameEn: s.optional(),
        category: s,
        price: n,
        sysCode: s,
        mfgCode: s,
        nameCn: s.optional(),
        onhand: n,
        status: z.enum(['Active', 'Inactive', 'Cancel']),
      }),
    ),
  ]),
  {
    ...productFilters,
    fields: choice(['lite']).meta({
      description: "`lite` = the picker's short rows: ACTIVE only; `deleted=exclude` adds INACTIVE (stock receive)",
    }),
  },
  Product.extend({ value: n }),
);
resource(
  'product_stats',
  'Spare-part totals for the filter',
  ANY,
  one(z.object({ total: n, qty: n, value: n, low: n, out: n, noPrice: n })),
  productFilters,
);

const customerFilters = {
  deleted: deletedMode,
  q,
  limit,
  code: s.optional(),
  name: s.optional(),
  phone: s.optional(),
  email: s.optional(),
  taxId: s.optional(),
  type: s.optional(),
  province: s.optional(),
  status: s.optional(),
};
resource('customers', 'Customers', viewOn('Customer'), list(Customer), customerFilters, Customer);

const issuedFilters = { from: ymd, to: ymd, category: s.optional(), code: s.optional(), q };
resource(
  'issued_lines',
  'Issued part lines (รายงานการเบิกอะไหล่)',
  viewOn('Report'),
  list(IssuedLine),
  {
    ...issuedFilters,
    limit,
  },
  IssuedLine,
);
resource(
  'issued_stats',
  'Totals of the issued lines',
  viewOn('Report'),
  one(z.object({ lines: n, qty: n, value: n, todayPriced: n, top: s })),
  issuedFilters,
);
resource(
  'movements',
  'Stock documents (WHI / WHO)',
  viewOn('Product Onhand', 'Product Receive Stock', 'Product Pick Stock'),
  list(Movement),
  { from: ymd, to: ymd, type: s.optional(), code: s.optional(), doc: s.optional(), ref: s.optional(), q, limit },
  Movement,
);

/** src/server/services/jobs.ts filtersFromQuery */
const jobFilters = {
  q,
  status: s.optional(),
  statusId: s.optional(),
  statusGroup: s.optional(),
  open: flag,
  type: s.optional(),
  engineer: s.optional(),
  channel: s.optional(),
  from: ymd,
  to: ymd,
  closedFrom: ymd,
  closedTo: ymd,
  customerCode: s.optional(),
  includeCancelled: flag,
  unassigned: flag,
  overdue: flag,
  closable: flag,
  dateBy: choice(['create', 'reception', 'repaired', 'closed']),
  symptom: s.optional(),
  returnType: s.optional(),
  no: s.optional(),
  ref: s.optional(),
  brand: s.optional(),
  model: s.optional(),
  typeDetail: s.optional(),
  createdBy: s.optional(),
  customer: s.optional(),
  phone: s.optional(),
  tracking: s.optional(),
  imei: s.optional(),
  warranty: s.optional(),
  bounce: flag,
  within30: flag,
  cost: choice(['yes', 'no']),
};
resource(
  'jobs',
  'Jobs',
  viewOn('Job Management', 'Job Assign', 'Job Repair', 'Job Closing'),
  list(Job),
  { ...jobFilters, limit },
  Job,
);
resource(
  'job_stats',
  'Job counters of the job list',
  viewOn('Job Management'),
  one(z.object({ total: n, fresh: n, done: n, progress: n })),
);
resource(
  'dashboard',
  'The dashboard',
  viewOn('Job Management'),
  one(
    z.object({
      groups: list(
        z.object({
          jobs: n,
          percent: n,
          key: s,
          label: s,
          sub: s,
          tone: z.enum(['primary', 'warning', 'info', 'success', 'danger']),
          ord: n,
        }),
      ),
      tat: list(z.object({ statusId: n, status: s, d13: n, d47: n, d814: n, d1530: n, over30: n })),
      monthly: list(z.object({ m: s, open: n, close: n })),
      granularity: z.enum(['day', 'month']),
      topSymptoms: list(z.object({ name: s, count: n })),
    }),
  ),
  { from: ymd, to: ymd, type: s.optional() },
);
resource(
  'job_summary',
  'Job report totals',
  viewOn('Report'),
  one(z.object({ total: n, fresh: n, done: n, amount: n, paid: n, avgTat: n, over30: n, topChannel: s })),
  jobFilters,
);

const quotationFilters = {
  q,
  deleted: deletedMode,
  status: s.optional(),
  from: ymd,
  to: ymd,
  jobNo: s.optional(),
  type: s.optional(),
  no: s.optional().describe('quotation number contains'),
  customer: s.optional().describe('customer name contains'),
  customerCode: s.optional().describe('customer code contains'),
  imei: s.optional().describe("the referenced job's IMEI contains"),
};
resource(
  'quotations',
  'Quotations',
  viewOn('Quotation'),
  list(Quotation),
  { ...quotationFilters, warranty: s.optional(), brand: s.optional(), limit },
  Quotation,
);
resource(
  'quotation_summary',
  'Quotation report totals',
  viewOn('Report'),
  one(z.object({ total: n, agreed: n, amount: n, cancelledAmount: n, agreedAmount: n })),
  quotationFilters,
);

const saleOrderFilters = {
  q,
  deleted: deletedMode,
  approve: s.optional(),
  from: ymd,
  to: ymd,
  sales: s.optional(),
  no: s.optional().describe('SO number contains'),
  customer: s.optional().describe('customer name or code contains'),
  code: s.optional().describe('a line of the order has this part / accessory code (contains)'),
};
resource(
  'sale_orders',
  'Sale orders',
  viewOn('Sale Order', 'Product Pick Stock'),
  list(SaleOrder),
  { ...saleOrderFilters, limit },
  SaleOrder,
);
resource(
  'sale_order_summary',
  'Sale order report totals',
  viewOn('Report'),
  one(z.object({ total: n, approved: n, amount: n, notApprovedAmount: n, avg: n })),
  saleOrderFilters,
);

export const exportXlsx = defineOperation({
  method: 'get',
  path: '/export/{resource}',
  tags,
  summary: 'Download a list as Excel (.xlsx), with the same filters as GET /data/{resource}',
  description:
    "View on the list's module (users, master data, audit log: System Admin) + the special right Export. Any other query name is a filter, as on GET /data/{resource}. At most 20,000 rows — a cut file is named `…-partial.xlsx`, says so in its last row and answers `X-Export-Truncated: <rows matched>`. ราคาทุน only with Product Cost.",
  params: z.object({
    resource: z.enum(
      [
        'users',
        'models',
        'customers',
        'jobs',
        'quotations',
        'sale_orders',
        'products',
        'movements',
        'issued_lines',
        'audit_log',
        'categories',
        'manufacturers',
        'colors',
        'job_types',
        'product_types',
        'symptoms',
      ],
      { error: (issue) => `unknown export: ${String(issue.input)}` },
    ),
  }),
  query: z.looseObject({
    q,
    deleted: deletedMode,
    status: s.optional(),
    from: ymd,
    to: ymd,
    file: s
      .optional()
      .meta({ description: 'The file name (a-z 0-9 -, e.g. the report: `repair-job`); else the resource.' }),
  }),
  invalid: { params: 404 },
  responses: {
    200: {
      description: 'The workbook (`Content-Disposition: attachment; filename="<file or resource>-<date>.xlsx"`).',
      headers: {
        'X-Export-Truncated': {
          schema: { type: 'string' },
          description: 'Only on a file cut at 20,000 rows: how many rows the filters match in all.',
        },
      },
      content: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
          schema: { type: 'string', format: 'binary' },
        },
      },
    },
    ...BAD_DATE,
    ...SIGNED_IN,
    404: errorResponse('Unknown resource.'),
    429: errorResponse(
      'Too many exports from this user in the window, or another export is still being written (one at a time per server) — `details.retryAfter` seconds to wait.',
    ),
  },
});
