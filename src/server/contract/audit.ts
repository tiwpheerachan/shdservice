import { z } from 'zod';
import { isRealDate } from '@/lib/validation';
import { JSON_BODY, Ok, RATE_LIMITED, SIGNED_IN, choice, errorResponse, jsonResponse, page } from './common';
import { defineOperation } from './registry';
import { AuditRow } from './shapes';

/** GET /api/audit — the System Admin audit log. security_log is never shown on the web: read in the database only. */

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
};
const RESPONSES = {
  400: errorResponse('A date filter that is not a real day (YYYY-MM-DD) — `details.fields`.'),
  ...SIGNED_IN,
  ...RATE_LIMITED,
};
/** who, as at the time, and which record (the request columns — ip, agent, session, request id, permission — stay in
 *  the database) */
const IDENTITY = {
  email: ns,
  role: ns,
  department: ns,
  entityId: ns.meta({ description: "the row's uuid" }),
  no: ns.meta({ description: 'its business number' }),
};

export const AuditLogRow = AuditRow.extend({ ...IDENTITY, reason: ns }).meta({ id: 'AuditLogRow' });

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

export const mePageDenied = defineOperation({
  method: 'post',
  path: '/me/denied',
  tags: ['Sign-in'],
  summary: 'Report a page the signed-in user was turned away from (the page guard runs in the browser)',
  description:
    "Any approved user. Re-checked against the role's current grants: a page the role may open logs nothing; one it may not → security_log DENIED (at most once a minute per user and page module).",
  body: z.object({
    path: s.max(200).regex(/^\//, 'path').meta({ example: '/admin/users' }),
  }),
  responses: { 200: jsonResponse('Noted.', Ok), ...SIGNED_IN, ...JSON_BODY, ...RATE_LIMITED },
});
