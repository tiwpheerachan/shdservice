import { z } from 'zod';
import { documentProfileSchema, shippingProfileSchema, userFields } from '@/lib/validation/admin';
import { maxText } from '@/lib/validation';
import { CONFLICT, JSON_BODY, Ok, SIGNED_IN, choice, errorResponse, flag, jsonResponse, notFound } from './common';
import { defineOperation } from './registry';
import { PAGE_MODULES, RIGHTS } from '@/lib/modules';
import { DocumentProfile, MasterRow, Model, Permission, ShippingProfile, Symptom, SystemUser } from './shapes';

/** System Admin screens: users, permissions, record status, master data, document / courier profiles. */

const s = z.string();
const n = z.number();
const b = z.boolean();
const tags = ['Admin'];
const ADMIN = 'System Admin only.';
const sn = s.nullish();

/** ?id= of a DELETE: a positive number, else 400 "id required" */
const byId = z.object({
  id: z.coerce
    .number({ error: 'id required' })
    .int('id required')
    .positive('id required')
    .meta({ description: 'profile id' }),
});

/** what the route's `str()` reads: a string, trimmed; anything else as "" */
const str = z
  .unknown()
  .optional()
  .transform((v) => (typeof v === 'string' ? v.trim() : ''))
  .meta({ type: 'string' });
/** what the route's `bool()` reads: true or "true"; anything else as false */
const bool = z
  .unknown()
  .optional()
  .transform((v) => v === true || v === 'true')
  .meta({ type: 'boolean' });

export const deletedMode = choice(['active', 'exclude', 'only', 'all']).meta({
  description: 'Which record_status rows: `exclude` (default) = all but DELETED; anything else = the default.',
});

export const usersList = defineOperation({
  method: 'get',
  path: '/admin/users',
  tags,
  summary: 'System users (everyone who signed in through SSO)',
  description: ADMIN,
  query: z.object({ deleted: deletedMode }),
  responses: { 200: jsonResponse('Users.', z.object({ rows: z.array(SystemUser) })), ...SIGNED_IN },
});

export const userSave = defineOperation({
  method: 'post',
  path: '/admin/users',
  tags,
  summary: 'Create or update a system user and give them a role',
  description: `${ADMIN} Rules: \`userSchema(prev)\` in src/lib/validation/admin.ts, run by the route against the stored user. Blank code / branch / phone / avatar / title are filled from the Lark directory by email. An edit that leaves name / role / status out keeps them as stored (the row's quick actions send only what they change).`,
  body: userFields.extend({
    id: sn.meta({ description: 'Set = edit that user.' }),
    expect: z.object({ name: sn, email: sn, role: sn, status: sn }).nullish().meta({
      description:
        'The values the form loaded (as GET /admin/users shows them): one that no longer matches the stored user → 409 `details.stale`, nothing written.',
    }),
    name: sn,
    role: sn.meta({ description: 'user_type — one of the roles in app_config' }),
    username: sn,
    phone: sn,
    status: sn,
    avatar: sn,
    title: sn,
  }),
  responses: {
    200: jsonResponse('Saved.', z.object({ ok: z.literal(true), user: SystemUser, created: b })),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such user.'),
    ...CONFLICT,
  },
});

export const permissionsGet = defineOperation({
  method: 'get',
  path: '/admin/permissions',
  tags,
  summary: 'The permission matrix (app_config), with the role and module lists',
  description: ADMIN,
  responses: {
    200: jsonResponse('Matrix.', z.object({ rows: z.array(Permission), roles: z.array(s), modules: z.array(s) })),
    ...SIGNED_IN,
  },
});

/** what a permission row may be about: a module with a page here, or a special right */
const MENUS = new Set<string>([...PAGE_MODULES, ...Object.keys(RIGHTS)]);
const grants = z.object({ add: bool, edit: bool, del: bool, view: bool });

export const permissionsSave = defineOperation({
  method: 'post',
  path: '/admin/permissions',
  tags,
  summary: 'Upsert permission rows by (role, menu)',
  description: `${ADMIN} Items without a role or menu are dropped; none left, or \`items\` not a list of objects → 400 "no items". A menu that is neither a page module nor a special right, or a role name over 50 characters → 400. With \`was\` (the row as the page loaded it) an item is a compare-and-set: a row another admin changed since → 409 \`details.stale\` naming the menus, nothing written.`,
  body: z.object({
    items: z.array(
      z.object(
        {
          role: str.refine((v) => v.length <= 50, 'ชื่อตำแหน่งยาวเกิน 50 ตัวอักษร'),
          menu: str
            .refine((v) => !v || MENUS.has(v), 'ไม่มีเมนูนี้ในระบบ')
            .meta({ description: 'module name, or a special right' }),
          add: bool,
          edit: bool,
          del: bool,
          view: bool,
          was: grants.nullish().meta({ description: 'The row as the page loaded it (no row = all false).' }),
        },
        { error: 'no items' },
      ),
      { error: 'no items' },
    ),
  }),
  invalid: { body: 400 },
  responses: {
    200: jsonResponse('Rows written.', z.object({ ok: z.literal(true), saved: n })),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...CONFLICT,
  },
});

export const permissionsDelete = defineOperation({
  method: 'delete',
  path: '/admin/permissions',
  tags,
  summary: 'Delete a role (its permission rows)',
  description: `${ADMIN} Refused (409) while a user that is not deleted still has the role, and for System Admin.`,
  query: z.object({ role: z.string({ error: 'role required' }).trim().min(1, 'role required') }),
  invalid: { query: 400 },
  responses: {
    200: jsonResponse('Rows removed.', z.object({ ok: z.literal(true), deleted: n })),
    ...SIGNED_IN,
    400: errorResponse('`role` missing.'),
    ...CONFLICT,
  },
});

export const recordStatus = defineOperation({
  method: 'post',
  path: '/admin/records',
  tags,
  summary: "Change a record's record_status: ACTIVE / INACTIVE / DELETED (soft delete — nothing is removed)",
  description:
    "DELETED needs `del` on the table's module, ACTIVE ↔ INACTIVE `edit`, out of DELETED `del` as well (users and master data: System Admin). Accepts `status`, or the older `deleted` boolean. Restoring a user brings the account back INACTIVE.",
  body: z.object({
    // in the order the route always checked them: 400 "id required", then "table not allowed: …"
    id: z
      .union([s, n], { error: 'id required' })
      .refine((v) => v !== '', 'id required')
      .meta({ description: 'The record key (users: the app_user id).' }),
    table: z.enum(
      [
        'users',
        'categories',
        'manufacturers',
        'colors',
        'job_types',
        'product_types',
        'symptoms',
        'models',
        'products',
        'customers',
        'jobs',
        'quotations',
        'sale_orders',
      ],
      { error: (issue) => `table not allowed: ${String(issue.input ?? '')}` },
    ),
    status: choice(['ACTIVE', 'INACTIVE', 'DELETED']).meta({ description: 'Anything else: decided by `deleted`.' }),
    deleted: flag.meta({ description: 'Without `status`: `true` = DELETED, otherwise ACTIVE.' }),
    remark: maxText(100, 'เหตุผล').meta({
      description: 'Cancelling a sale order: the reason (document_cancel_remark). Other tables ignore it.',
    }),
  }),
  invalid: { body: 400 },
  responses: {
    200: jsonResponse(
      'The status now.',
      z.object({ ok: z.literal(true), status: z.enum(['ACTIVE', 'INACTIVE', 'DELETED']) }),
    ),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such record.'),
    ...CONFLICT,
  },
});

/** a master field as the route reads it: a string; null → left out; a number (or anything else) → its text */
const text = z
  .unknown()
  .optional()
  .transform((v) => (typeof v === 'string' ? v : v == null ? undefined : String(v)))
  .meta({ type: 'string' });

export const masterSave = defineOperation({
  method: 'post',
  path: '/masters/{kind}',
  tags,
  summary: 'Create or update master data (ข้อมูลระบบ)',
  description: `${ADMIN} Rules: \`masterSchema\` / \`modelSchema\` in src/lib/validation/admin.ts. Fields by kind: the simple lists take id, name, detail, extra, days (job types: SLA), status; \`symptoms\` adds group; \`models\` takes code, name, brand, price, status.`,
  params: z.object({
    kind: z.enum(['categories', 'manufacturers', 'colors', 'job_types', 'product_types', 'symptoms', 'models'], {
      error: (issue) => `unknown master: ${String(issue.input)}`,
    }),
  }),
  body: z.object({
    id: text,
    code: text.meta({ description: 'models' }),
    name: text,
    detail: text,
    extra: text,
    days: text,
    group: text.meta({ description: 'symptoms' }),
    brand: text.meta({ description: 'models' }),
    price: text.meta({ description: 'models' }),
    status: text,
    expect: z.object({ name: text, detail: text, status: text, brand: text, price: text }).nullish().meta({
      description:
        'The row as the edit dialog loaded it (simple lists and symptoms: name, detail, status; `models`: name, brand, price, status) — changed since → 409 `details.stale`, nothing written.',
    }),
  }),
  invalid: { params: 404 },
  responses: {
    200: jsonResponse('Saved.', z.object({ ok: z.literal(true), row: z.union([Symptom, MasterRow, Model]) })),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('Unknown kind, or no such row.'),
    ...CONFLICT,
  },
});

export const directorySearch = defineOperation({
  method: 'get',
  path: '/directory/search',
  tags,
  summary: 'Search the Lark employee directory (pick a person to make a user)',
  description: `${ADMIN} Proxies the central directory API; fewer than 2 characters → no items. Every answer, errors too, carries \`items\`.`,
  query: z.object({ q: s.optional() }),
  responses: {
    200: jsonResponse(
      'Matches.',
      z.object({
        items: z.array(z.object({ id: s, name: s, email: s, department: s, title: s, avatar: s, status: s })),
        stale: b.optional().meta({ description: 'served from the cached copy' }),
        synced_at: s.optional(),
      }),
    ),
    ...Object.fromEntries(
      ([401, 403, 429, 500, 502, 503] as const).map((status) => [
        status,
        jsonResponse(
          {
            401: 'No session.',
            403: 'Not System Admin.',
            429: 'Too many searches.',
            500: 'CENTRAL_API_KEY is not configured.',
            502: 'The directory did not answer.',
            503: 'The database did not answer.',
          }[status],
          z.object({ items: z.array(z.unknown()).max(0), error: s }),
        ),
      ]),
    ),
  },
});

export const documentProfilesList = defineOperation({
  method: 'get',
  path: '/admin/document-profiles',
  tags,
  summary: 'Document profiles (ออกเอกสารในนาม), deleted ones included',
  description: ADMIN,
  responses: { 200: jsonResponse('Profiles.', z.object({ rows: z.array(DocumentProfile) })), ...SIGNED_IN },
});

export const documentProfileSave = defineOperation({
  method: 'post',
  path: '/admin/document-profiles',
  tags,
  summary: 'Create (no `id`) or update a document profile',
  description: `${ADMIN} Rules: \`documentProfileSchema\` (src/lib/validation/admin.ts).`,
  body: documentProfileSchema.extend({
    id: n.nullish().meta({ description: 'Set = edit that profile.' }),
    code: sn,
    nameTh: sn,
    phone: sn,
    taxId: sn,
    bankAccountNo: sn,
    isDefault: b.nullish(),
    isActive: b.nullish(),
    expect: DocumentProfile.partial().nullish().meta({
      description:
        'The profile as the edit form loaded it (a row of GET /admin/document-profiles): a field saved since → 409 `details.stale`, nothing written.',
    }),
  }),
  responses: {
    200: jsonResponse('Saved.', z.object({ row: DocumentProfile })),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such profile.'),
    ...CONFLICT,
  },
});

export const documentProfileDelete = defineOperation({
  method: 'delete',
  path: '/admin/document-profiles',
  tags,
  summary: 'Soft-delete a document profile',
  description: `${ADMIN} The default profile, or one still used by an open document, is refused.`,
  query: byId,
  invalid: { query: 400 },
  responses: {
    200: jsonResponse('Deleted.', Ok),
    ...SIGNED_IN,
    400: errorResponse('`id` missing or not a positive number.'),
    ...notFound('No such profile.'),
    ...CONFLICT,
  },
});

export const shippingProfilesList = defineOperation({
  method: 'get',
  path: '/admin/shipping-profiles',
  tags,
  summary: 'Courier profiles (บริษัทขนส่ง), deleted ones included',
  description: ADMIN,
  responses: { 200: jsonResponse('Profiles.', z.object({ rows: z.array(ShippingProfile) })), ...SIGNED_IN },
});

export const shippingProfileSave = defineOperation({
  method: 'post',
  path: '/admin/shipping-profiles',
  tags,
  summary: 'Create (no `id`) or update a courier profile',
  description: `${ADMIN} Rules: \`shippingProfileSchema\` (src/lib/validation/admin.ts) — the tracking link is https with {no} where the parcel number goes.`,
  body: shippingProfileSchema.extend({
    id: n.nullish().meta({ description: 'Set = edit that profile.' }),
    code: sn,
    nameTh: sn,
    trackUrl: sn,
    isActive: b.nullish(),
    expect: ShippingProfile.partial().nullish().meta({
      description:
        'The profile as the edit form loaded it (a row of GET /admin/shipping-profiles): a field saved since → 409 `details.stale`, nothing written.',
    }),
  }),
  responses: {
    200: jsonResponse('Saved.', z.object({ row: ShippingProfile })),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such profile.'),
    ...CONFLICT,
  },
});

export const shippingProfileDelete = defineOperation({
  method: 'delete',
  path: '/admin/shipping-profiles',
  tags,
  summary: 'Soft-delete a courier profile',
  description: ADMIN,
  query: byId,
  invalid: { query: 400 },
  responses: {
    200: jsonResponse('Deleted.', Ok),
    ...SIGNED_IN,
    400: errorResponse('`id` missing or not a positive number.'),
    ...notFound('No such profile.'),
  },
});
