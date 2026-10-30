import { z } from 'zod';
import { isRealDate } from '@/lib/validation';
import { RATE_LIMITED, SIGNED_IN, choice, errorResponse, jsonResponse, page } from './common';
import { defineOperation } from './registry';
import { AuditRow } from './shapes';

/** GET /api/audit, /api/audit/security — the System Admin logs (src/server/audit.ts pageAudit / pageSecurity). */

const s = z.string();
const ns = s.nullable();
const tags = ['Admin'];
const opt = (description: string) => s.optional().meta({ description });
const ymd = s
  .refine((v) => v === '' || isRealDate(v), 'วันที่ไม่ถูกต้อง (YYYY-MM-DD)')
  .optional()
  .meta({ format: 'date' });
const PAGING = {
  page: opt('From 1.'),
  pageSize: opt('1–500, default 25.'),
  sort: opt('A column key of the list.'),
  dir: choice(['asc', 'desc'], 'asc'),
  q: opt('Free-text search.'),
};
const ACTOR = {
  from: ymd,
  to: ymd,
  user: opt("a user's id (uuid) = that user's lines; anything else = the name or email (at the time) contains"),
  role: opt('the role (user_type) at the time, exact'),
  no: opt('business number (J… / Q… / SO… / P… / C…), exact'),
  ip: opt('the client address contains'),
};
const RESPONSES = {
  400: errorResponse('A date filter that is not a real day (YYYY-MM-DD) — `details.fields`.'),
  ...SIGNED_IN,
  ...RATE_LIMITED,
};
/** who and from where, as at the time */
const IDENTITY = {
  email: ns,
  role: ns,
  department: ns,
  permission: ns.meta({ description: 'the module / right + action the request used ("Job Management:edit")' }),
  entityId: ns.meta({ description: "the row's uuid" }),
  no: ns.meta({ description: 'its business number' }),
  ip: ns,
  userAgent: ns,
  sessionId: ns.meta({ description: 'identifies the sign-in (never the cookie)' }),
  requestId: ns,
};

export const AuditLogRow = AuditRow.extend({ ...IDENTITY, reason: ns }).meta({ id: 'AuditLogRow' });

export const SecurityRow = z
  .object({
    id: z.uuid(),
    at: s,
    event: z.enum([
      'LOGIN',
      'LOGIN_FAILED',
      'LOGOUT',
      'DENIED',
      'ROLE_CHANGE',
      'PERMISSION_CHANGE',
      'USER_STATUS',
      'EXPORT',
      'PRINT',
    ]),
    result: z.enum(['OK', 'DENIED', 'FAILED']),
    user: s,
    module: ns,
    entity: ns,
    ...IDENTITY,
    detail: z.record(s, z.unknown()).nullable(),
  })
  .meta({ id: 'SecurityRow' });

export const auditList = defineOperation({
  method: 'get',
  path: '/audit',
  tags,
  summary: 'Audit log (ประวัติการใช้งาน) — one page',
  description: 'System Admin only. Every data change with the actor, request and changed fields as at the time.',
  query: z.object({
    ...PAGING,
    ...ACTOR,
    module: opt('exact'),
    entity: opt('table name, exact'),
    action: opt('exact (CREATE, UPDATE, …)'),
  }),
  responses: { 200: jsonResponse('One page.', page(AuditLogRow)), ...RESPONSES },
});

export const securityList = defineOperation({
  method: 'get',
  path: '/audit/security',
  tags,
  summary: 'Security log (sign-in / out, refusals, role / permission / status changes, export / print) — one page',
  description: 'System Admin only.',
  query: z.object({ ...PAGING, ...ACTOR, event: opt('exact'), result: opt('OK / DENIED / FAILED') }),
  responses: { 200: jsonResponse('One page.', page(SecurityRow)), ...RESPONSES },
});
