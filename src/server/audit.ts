import 'server-only';
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, count, type Column } from 'drizzle-orm';
import { db, type Tx } from '@/db/client';
import { MAX_EXPORT_ROWS } from '@/lib/export-limit';
import {
  appUser,
  approveStatus,
  auditLog,
  brand,
  customer,
  jobStatus,
  jobType,
  model,
  productType,
  quotationStatus,
  rolePermission,
  securityLog,
  shippingProfile,
  symptom,
} from '@/db/schema';
import { isOwner } from '@/lib/access';
import { logError } from '@/lib/log';
import { AS } from '@/lib/status-ids';
import { ADMIN_USER_TYPE, checkGrant, checkRight, type GrantMap, type Module } from '@/lib/modules';
import { fullName, HttpError } from '@/server/auth';
import { nowThai } from '@/server/mappers/format';
import { orderBy as orderByCols, likeTerm, offsetOf, totalOf, ymd, type Page, type PageQuery } from '@/server/paging';
import { permissionOf, requestCtx, type Need } from '@/server/request-context';

/**
 * Audit trail — every write the app performs records WHO did WHAT to WHICH record, with the changed fields.
 * Call `audit(tx, userPk, …)` (app_user.pk; null / 0 = the system) inside the same transaction as the data change so
 * log and data can never disagree. Each row carries the actor AS AT THE TIME (name, email, role, department read in
 * that transaction) and the request (ip, user agent, session id, request id, the permission used —
 * src/server/request-context.ts); `row_hash` is set by the database (drizzle/0006 trigger), never here.
 *
 * Inside a transaction for the request's own user, audit() first runs assertActor(): the write completes only if the
 * user's CURRENT role still allows what the request relied on (R2).
 *
 * Sign-in / export / print and changes of a role, a permission or a user's status are security events: they (also)
 * go to security_log — LOGIN / LOGIN_FAILED / EXPORT / PRINT only there; app_user role / status and role_permission
 * changes to both (the data change in audit_log, the event in security_log).
 */
export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'STATUS'
  | 'APPROVE'
  | 'ASSIGN'
  | 'ISSUE'
  | 'RECEIVE'
  | 'RETURN'
  | 'UPLOAD'
  /** security_log only — rows before drizzle/0006 stay in audit_log */
  | 'LOGIN'
  /** a refused sign-in (Inactive / deleted account) — summary says why; security_log only */
  | 'LOGIN_FAILED'
  /** security_log only */
  | 'EXPORT'
  /** a printout / PDF / Word of a list or document — security_log only */
  | 'PRINT';

export type AuditChanges = Record<string, [unknown, unknown]>;

export type AuditEntry = {
  action: AuditAction;
  /** module name as in role_permission (Job Management, Product, …) or "Admin" / "Auth" */
  module: string;
  /** table name */
  entity: string;
  /** business key: J2612088, Q2600462, P00012 — or the row's uuid for a row without one (a user, a customer …; rows before ADR 0008 hold the old int) */
  key: string | number;
  /** short human-readable line for the log list */
  summary: string;
  changes?: AuditChanges | null;
  meta?: Record<string, unknown> | null;
  /** the row's uuid when `key` is its business number (default: `key` when it is a uuid) */
  id?: string | null;
  /** its business number when `key` is its uuid (default: `key` when it is neither a uuid nor a bare number) */
  no?: string | null;
  /** why (cancel / reject / status reason) — default: meta.reason / meta.remark */
  reason?: string | null;
};

type Writer = Tx | typeof db;

/* user-name snapshot cache (60 s) — the names job / sale order summaries quote (not the log's actor columns) */
const names = new Map<number, { at: number; name: string }>();
export async function actorName(userPk: number | null, w: Writer = db): Promise<string> {
  if (!userPk || userPk <= 0) return '';
  const hit = names.get(userPk);
  if (hit && Date.now() - hit.at < 60_000) return hit.name;
  const [u] = await w
    .select({ f: appUser.firstName, l: appUser.lastName, un: appUser.username })
    .from(appUser)
    .where(eq(appUser.pk, userPk));
  const name = u ? fullName(u.f, u.l) || u.un || `#${userPk}` : `#${userPk}`;
  names.set(userPk, { at: Date.now(), name });
  return name;
}

/* ------------------------------------------------------------------ *
 * The actor as at the time + R2
 * ------------------------------------------------------------------ */
type Actor = {
  pk: number;
  name: string;
  email: string | null;
  /** effective user_type (an owner email without a role = System Admin, as resolveUser) */
  role: string | null;
  department: string | null;
  active: boolean;
  sv: number;
};

/** per transaction: one read of each actor (the request's own user: FOR SHARE, by assertActor) */
const actorsByTx = new WeakMap<object, Map<number, Promise<Actor | null>>>();

function readActor(w: Writer, pk: number, lock: boolean): Promise<Actor | null> {
  const memo = w === db ? null : (actorsByTx.get(w) ?? new Map<number, Promise<Actor | null>>());
  if (memo && !actorsByTx.has(w)) actorsByTx.set(w, memo);
  // keyed -pk for the locked read: a plain read memoised first must not stand in for the lock
  const hit = memo?.get(-pk) ?? (lock ? undefined : memo?.get(pk));
  if (hit) return hit;
  const q = w
    .select({
      f: appUser.firstName,
      l: appUser.lastName,
      un: appUser.username,
      email: appUser.emailAddress,
      type: appUser.userType,
      dept: appUser.department,
      rs: appUser.recordStatus,
      sv: appUser.sessionVersion,
    })
    .from(appUser)
    .where(eq(appUser.pk, pk));
  const p = (lock ? q.for('share') : q).then(([u]): Actor | null => {
    if (!u) return null;
    const email = u.email?.trim() || null;
    return {
      pk,
      name: fullName(u.f, u.l) || u.un?.trim() || `#${pk}`,
      email,
      role: u.type?.trim() || (email && isOwner(email) ? ADMIN_USER_TYPE : null),
      department: u.dept?.trim() || null,
      active: u.rs === 'ACTIVE',
      sv: u.sv ?? 0,
    };
  });
  memo?.set(lock ? -pk : pk, p);
  return p;
}

/** per transaction: the last check and how many needs it covered — a need recorded later (a right checked after a
 *  first audit line, userHasRight in jobs.ts) makes the next call check again */
const asserted = new WeakMap<object, { n: number; p: Promise<void> }>();

/**
 * R2 — inside the write transaction, the request's user must STILL hold what the request relied on: their app_user
 * row (active, approved, same session version) and the role_permission rows of every grant / right the guards let
 * through (request-context `needs`), read FOR SHARE so an admin's change to them waits for this write to finish (or
 * this write sees it). Anything gone → 403 and the transaction rolls back; checked() logs the refusal (DENIED) after.
 * Called by audit(); a transaction that changes users / permissions calls it FIRST (lock order: the actor's row before
 * the target's — two admins editing each other otherwise deadlock). writeTx (src/db/client.ts) calls it before and
 * after the work. Once per transaction and set of needs. Outside a request: no-op.
 */
export function assertActor(tx: Tx): Promise<void> {
  const c = requestCtx();
  const u = c?.user;
  if (!c || !u) return Promise.resolve();
  const hit = asserted.get(tx);
  if (hit && hit.n === c.needs.length) return hit.p;
  const p = (async () => {
    const row = await readActor(tx, u.pk, true);
    let why: string | null = null;
    let failed: Need | undefined;
    if (!row) why = 'ไม่พบบัญชีผู้ใช้';
    else if (row.sv !== u.session.sv) why = 'บัญชีนี้ออกจากระบบแล้ว';
    else if (!row.active) why = 'บัญชีนี้ถูกปิดการใช้งาน';
    else if (!row.role) why = 'บัญชีนี้ถูกถอนสิทธิ์';
    else {
      const isAdmin = row.role === ADMIN_USER_TYPE;
      const modules = [
        ...new Set(c.needs.flatMap((n) => (n.kind === 'grant' ? n.modules : n.kind === 'right' ? [n.right] : []))),
      ];
      const grants: GrantMap = {};
      if (modules.length)
        for (const g of await tx
          .select({
            m: rolePermission.moduleName,
            add: rolePermission.canInsert,
            edit: rolePermission.canEdit,
            del: rolePermission.canDelete,
            view: rolePermission.canView,
          })
          .from(rolePermission)
          // trimmed both sides, as grantsForUserType reads them (auth.ts)
          .where(
            and(
              sql`btrim(${rolePermission.userType}) = ${row.role}`,
              inArray(sql`btrim(${rolePermission.moduleName})`, modules),
            ),
          )
          .for('share'))
          if (g.m) grants[g.m.trim()] = { add: !!g.add, edit: !!g.edit, del: !!g.del, view: !!g.view };
      failed = c.needs.find((n) =>
        n.kind === 'admin'
          ? !isAdmin
          : n.kind === 'right'
            ? !checkRight(isAdmin, grants, n.right)
            : !n.modules.some((m) => checkGrant(isAdmin, grants, m as Module, n.action)),
      );
      if (failed) why = 'สิทธิ์ของบัญชีนี้ถูกเปลี่ยน';
    }
    if (why) {
      c.deniedSeen = true;
      c.denied = {
        reason: why,
        permission: permissionOf(failed ? [failed] : c.needs),
        role: row?.role ?? null,
        at: 'write',
      };
      throw new HttpError(403, `${why}ระหว่างทำรายการ — รายการนี้ไม่ได้บันทึก`);
    }
  })();
  asserted.set(tx, { n: c.needs.length, p });
  return p;
}

/** the request columns of a log row; `self` = the request's own user is the actor */
function stamp(actor: Actor | null, self: boolean) {
  const c = requestCtx();
  return {
    at: nowThai(),
    actorPk: actor?.pk ?? null, // a pk with no row (never in practice: users are soft-deleted) = the system
    actorEmail: actor?.email?.slice(0, 100) ?? null,
    actorRole: actor?.role?.slice(0, 50) ?? null,
    actorDepartment: actor?.department?.slice(0, 100) ?? null,
    ip: c?.ip ?? null,
    userAgent: c?.userAgent ?? null,
    sessionId: self ? (c?.sessionId ?? null) : null,
    requestId: c?.requestId ?? null,
  };
}

/** audit_log.entity written before drizzle/0006 renamed the tables (adr/0008-phase2-renames.md) → today's name.
 *  0006 rewrote the copied rows; this keeps any row it missed readable and findable under the new name. */
const LEGACY_ENTITY: Record<string, string> = {
  app_config: 'role_permission',
  document_attach: 'job_attachment',
  inventory_dt: 'stock_move_line',
  inventory_hd: 'stock_move',
  inventory_type: 'stock_move_type',
  job_log: 'job_status_log',
  job_order_spare_part_log: 'job_part',
  job_order_spare_part_status: 'job_part_status',
  job_send_forward_dt: 'job_outsource',
  manufacturer: 'brand',
  mt_city: 'province',
  mt_district: 'district',
  mt_sub_district: 'sub_district',
  product_model: 'product_compatible_model',
  product_none_serial: 'product_stock',
  quotation_dt: 'quotation_line',
  quotation_hd: 'quotation',
  sale_out_dt: 'sale_order_line',
  sale_out_hd: 'sale_order',
};
const entityName = (e: string) => (Object.hasOwn(LEGACY_ENTITY, e) ? LEGACY_ENTITY[e]! : e);
/** an entity filter: today's name and the names it had before 0006 (either may be typed) */
const entityIn = (col: Column, e: string) => {
  const name = entityName(e.trim());
  return inArray(col, [name, ...Object.keys(LEGACY_ENTITY).filter((k) => LEGACY_ENTITY[k] === name)]);
};

/** the tables an audit / security line can name by number: their number column (job_part: none — its uuid only).
 *  Fixed names, never input: they go into the SQL as identifiers. */
const NUMBERED: Record<string, string | null> = {
  job: 'job_no',
  quotation: 'quotation_no',
  sale_order: 'sale_order_no',
  stock_move: 'stock_move_no',
  customer: 'customer_code',
  product: 'product_code',
  job_part: null,
};

/** a record's uuid and number, by any one of pk / id / no; null = not a numbered table or no such row */
async function rowOf(
  w: Writer,
  entity: string,
  by: { pk?: number; id?: string; no?: string },
): Promise<{ id: string; no: string | null } | null> {
  const table = entityName(entity);
  if (!Object.hasOwn(NUMBERED, table)) return null;
  const col = NUMBERED[table];
  const where =
    by.pk !== undefined
      ? sql`pk = ${by.pk}`
      : by.id && isUuid(by.id)
        ? sql`id = ${by.id.toLowerCase()}`
        : by.no && col
          ? sql`${sql.raw(col)} = ${by.no}`
          : null;
  if (!where) return null;
  const { rows } = await w.execute<{ id: string; no: string | null }>(
    sql`select id::text as id, ${col ? sql.raw(col) : sql`null`}::text as no from ${sql.raw(table)} where ${where} limit 1`,
  );
  return rows[0] ?? null;
}

const keyId = (key: string) => (isUuid(key) ? key.toLowerCase() : null);
/** a key that is no uuid and no bare pre-ADR-0008 int is the record's number / code / name (J…, TDJRDEL, a role) */
const keyNo = (key: string) => (key.trim() && !isUuid(key) && !/^\d+$/.test(key.trim()) ? key.trim() : null);
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export type SecurityEvent =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'DENIED'
  | 'ROLE_CHANGE'
  | 'PERMISSION_CHANGE'
  | 'USER_STATUS'
  | 'EXPORT'
  | 'PRINT';
export type SecurityResult = 'OK' | 'DENIED' | 'FAILED';

/** the security events an audit entry is ([]: a plain data change); `only` = not a data change (no audit_log row) */
function eventsOf(e: AuditEntry): { event: SecurityEvent; result: SecurityResult; only: boolean }[] {
  switch (e.action) {
    case 'LOGIN':
    case 'EXPORT':
    case 'PRINT':
      return [{ event: e.action, result: 'OK', only: true }];
    case 'LOGIN_FAILED':
      return [{ event: 'LOGIN_FAILED', result: 'DENIED', only: true }];
  }
  if (entityName(e.entity) === 'role_permission') return [{ event: 'PERMISSION_CHANGE', result: 'OK', only: false }];
  if (e.entity !== 'app_user') return [];
  const out: { event: SecurityEvent; result: SecurityResult; only: boolean }[] = [];
  // one save may change both (approve + enable): both events
  if (e.action === 'APPROVE' || e.changes?.userType) out.push({ event: 'ROLE_CHANGE', result: 'OK', only: false });
  if (e.action === 'DELETE' || e.action === 'STATUS' || e.changes?.recordStatus)
    out.push({ event: 'USER_STATUS', result: 'OK', only: false });
  return out;
}

/** One entry, or several (a bulk action) written in a single INSERT. */
export async function audit(w: Writer, userPk: number | null, entries: AuditEntry | AuditEntry[]): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries];
  if (!list.length) return;
  const c = requestCtx();
  const pk = userPk && userPk > 0 ? userPk : null; // the system = NULL (FK, drizzle/0006)
  const self = !!pk && c?.user?.pk === pk;
  if (self && w !== db) await assertActor(w as Tx);
  const actor = pk ? await readActor(w, pk, false) : null;
  const base = stamp(actor, self || !c?.user); // no signed-in user (sign-in): the session the route set
  const permission = self && c ? permissionOf(c.needs) : null;
  const data = list.filter((e) => !eventsOf(e).some((ev) => ev.only));
  // the row's uuid when the entry names it by number only (J…, Q…, SO…, a code) — read in the same transaction.
  // ponytail: one SELECT per such entry; batch per entity if a bulk action ever logs hundreds
  const ids = new Map<AuditEntry, string>();
  for (const e of data) {
    const key = String(e.key ?? '');
    const no = e.no ?? keyNo(key);
    if (e.id || keyId(key) || !no) continue;
    const row = await rowOf(w, e.entity, { no });
    if (row) ids.set(e, row.id);
  }
  if (data.length)
    await w.insert(auditLog).values(
      data.map((e) => {
        const key = String(e.key ?? '');
        return {
          ...base,
          actorName: (actor?.name ?? '').slice(0, 100),
          action: e.action,
          module: e.module.slice(0, 50),
          permission,
          entity: e.entity.slice(0, 50),
          entityKey: key.slice(0, 100),
          entityId: e.id ?? keyId(key) ?? ids.get(e) ?? null,
          entityNo: e.no ?? keyNo(key),
          summary: e.summary.slice(0, 200),
          reason: e.reason ?? text(e.meta?.reason) ?? text(e.meta?.remark),
          changes: e.changes && Object.keys(e.changes).length ? e.changes : null,
          meta: e.meta ?? null,
        };
      }),
    );
  const events = list.flatMap((e) => {
    const key = String(e.key ?? '');
    return eventsOf(e).map((ev) => ({
      ...base,
      actorName: actor?.name.slice(0, 100) ?? null,
      event: ev.event,
      result: ev.result,
      module: e.module.slice(0, 50),
      permission,
      entity: e.entity.slice(0, 50),
      entityId: e.id ?? keyId(key),
      entityNo: e.no ?? keyNo(key),
      detail: {
        action: e.action,
        key,
        summary: e.summary,
        changes: e.changes ?? undefined,
        meta: e.meta ?? undefined,
      },
    }));
  });
  if (events.length) await w.insert(securityLog).values(events);
}

export type SecurityEntry = {
  event: SecurityEvent;
  result?: SecurityResult;
  module?: string | null;
  /** default: what the request's guards let through */
  permission?: string | null;
  entity?: string | null;
  id?: string | null;
  no?: string | null;
  detail?: Record<string, unknown> | null;
};

/**
 * A security_log row (sign-in / out, refusals, role / permission / status changes, export / print). `actorPk` = who
 * (null: nobody known — a refused sign-in before any account). In the transaction of the change it records when there
 * is one (logout: with the session_version bump); a refusal is written on its own (`db`) after the refused work rolled back.
 */
export async function security(w: Writer, actorPk: number | null, e: SecurityEntry): Promise<void> {
  const c = requestCtx();
  const pk = actorPk && actorPk > 0 ? actorPk : null;
  const self = !!pk && c?.user?.pk === pk;
  if (self && w !== db) await assertActor(w as Tx);
  const actor = pk ? await readActor(w, pk, false) : null;
  await w.insert(securityLog).values({
    ...stamp(actor, self || !c?.user), // no signed-in user yet (sign-in / out): the session the route set
    actorName: actor?.name.slice(0, 100) ?? null,
    event: e.event,
    result: e.result ?? 'OK',
    module: e.module?.slice(0, 50) ?? null,
    permission: e.permission !== undefined ? e.permission : self && c ? permissionOf(c.needs) : null,
    entity: e.entity?.slice(0, 50) ?? null,
    entityId: e.id ?? null,
    entityNo: e.no ?? null,
    detail: e.detail ?? null,
  });
}

/** API paths that name one record: /api/jobs/{uuid}/…, /api/stock/movements/{no} … */
const RECORD_PATHS: [RegExp, string][] = [
  [/^\/api\/jobs\/([^/]+)/, 'job'],
  [/^\/api\/quotations\/([^/]+)/, 'quotation'],
  [/^\/api\/sale-orders\/([^/]+)/, 'sale_order'],
  [/^\/api\/products\/([^/]+)/, 'product'],
  [/^\/api\/stock\/movements\/([^/]+)/, 'stock_move'],
];
function recordInPath(path: string): { entity: string; id?: string; no?: string } | null {
  for (const [re, entity] of RECORD_PATHS) {
    const seg = re.exec(path)?.[1];
    if (!seg) continue;
    let v = seg;
    try {
      v = decodeURIComponent(seg);
    } catch {
      return null;
    }
    return isUuid(v) ? { entity, id: v } : { entity, no: v };
  }
  return null;
}

/** checked() (src/server/auth.ts): the refusal assertActor() made, logged once its transaction rolled back.
 *  Best effort — the caller already gets its 403; a lost line is a server-log error, not a second failure. */
export async function logDenied(): Promise<void> {
  const c = requestCtx();
  const d = c?.denied;
  if (!c || !d) return;
  c.denied = undefined;
  try {
    // the record: the refusal's own, else the one the URL names (/api/jobs/{id}/…)
    const named = d.entity ? { ...d, entity: d.entity } : recordInPath(c.path);
    const row = named ? await rowOf(db, named.entity, named).catch(() => null) : null;
    await security(db, d.actorPk ?? c.user?.pk ?? null, {
      event: 'DENIED',
      result: 'DENIED',
      permission: d.permission,
      // a path segment that is no record (/api/jobs/checks) names nothing
      entity: named && (d.entity || row) ? entityName(named.entity) : null,
      id: row?.id ?? null,
      no: row?.no ?? null,
      // guard: refused at the door (roleNow = the role it checked); write: the role changed while the request ran
      detail: { reason: d.reason, at: d.at, roleNow: d.role, roleAtCheck: c.user?.userType ?? null },
    });
  } catch (e) {
    logError(e, 'security_log DENIED write failed');
  }
}

/** a row's uuid (ADR 0008) — a filter holding one means "this row", anything else is a name / text */
export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());

const norm = (v: unknown): unknown => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    // numeric strings from pg → numbers ("500.00" = 500); a leading 0 (phone, tax id, code) stays text
    if (/^-?\d+(\.\d+)?$/.test(t) && !/^-?0\d/.test(t)) return Number(t);
    return t;
  }
  return v;
};

/**
 * Fields in `after` whose value differs from `before` → {field: [old, new]}.
 * Only keys present in `after` are compared (a partial update never reports
 * untouched columns); status stamps and timestamps are skipped by default; null and '' are the same (nothing).
 */
export function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  opts: { skip?: string[] } = {},
): AuditChanges | null {
  const skip = new Set([
    'statusChangedAt',
    'statusChangedByAppUserPk',
    'lastUpdate',
    'createDate',
    'jobCreateDate',
    ...(opts.skip ?? []),
  ]);
  const out: AuditChanges = {};
  for (const [k, v] of Object.entries(after)) {
    if (v === undefined || skip.has(k)) continue;
    const a = norm(before ? before[k] : undefined);
    const b = norm(v);
    if (JSON.stringify(a ?? '') !== JSON.stringify(b ?? '')) out[k] = [a, b]; // null = '' (a blank never set)
  }
  return Object.keys(out).length ? out : null;
}

/* ------------------------------------------------------------------ *
 * Reading (admin page + per-record history)
 * ------------------------------------------------------------------ */
export type AuditRow = {
  /** audit_log.id (uuid) */
  id: string;
  at: string;
  user: string;
  /** PRINT is never an audit_log action (security_log only) */
  action: Exclude<AuditAction, 'PRINT'>;
  module: string;
  entity: string;
  key: string;
  summary: string;
  changes: AuditChanges | null;
};

export type AuditFilters = {
  from?: string;
  to?: string;
  /** a user's uuid = that user's lines; anything else = the actor's name or email contains */
  user?: string;
  /** the actor's role at the time, exact */
  role?: string;
  module?: string;
  entity?: string;
  /** entity_key, exact (a record's history) */
  key?: string;
  /** the business number (or key), exact */
  no?: string;
  action?: string;
};

/** the admin log's row: who as at the time (email, role, department), the record's id / number, the reason. The
 *  request columns (ip, user agent, session / request id, permission) are written but never leave the server (owner
 *  2026-10-30: read in the database only). The job history shows AuditRow only. */
export type AuditLogRow = AuditRow & {
  email: string | null;
  role: string | null;
  department: string | null;
  entityId: string | null;
  no: string | null;
  reason: string | null;
};

const toRow = (r: typeof auditLog.$inferSelect): AuditRow => ({
  id: r.id,
  at: r.at.slice(0, 19).replace('T', ' '), // to the second: two lines in one minute must still read in order
  user: r.actorName,
  action: r.action as AuditRow['action'],
  module: r.module,
  entity: entityName(r.entity),
  key: r.entityKey,
  summary: r.summary,
  changes: (r.changes as AuditChanges | null) ?? null,
});
const toLogRow = (r: typeof auditLog.$inferSelect): AuditLogRow => ({
  ...toRow(r),
  email: r.actorEmail,
  role: r.actorRole,
  department: r.actorDepartment,
  entityId: r.entityId,
  no: r.entityNo,
  reason: r.reason,
});

/** a user filter: a uuid = that user (by pk); else the name / email at the time contains */
const actorFilter = (v: string | undefined, cols: { pk: Column; name: Column; email: Column }) =>
  !v
    ? undefined
    : isUuid(v)
      ? inArray(cols.pk, db.select({ pk: appUser.pk }).from(appUser).where(eq(appUser.id, v.trim().toLowerCase())))
      : or(ilike(cols.name, likeTerm(v)), ilike(cols.email, likeTerm(v)));

function auditWhere(q: string, f: AuditFilters) {
  const term = q.trim();
  return and(
    term
      ? or(
          ilike(auditLog.entityKey, likeTerm(term)),
          ilike(auditLog.entityNo, likeTerm(term)),
          ilike(auditLog.summary, likeTerm(term)),
          ilike(auditLog.actorName, likeTerm(term)),
        )
      : undefined,
    ymd(f.from) ? gte(auditLog.at, `${ymd(f.from)} 00:00:00`) : undefined, // junk date = no filter, not a 500
    ymd(f.to) ? lte(auditLog.at, `${ymd(f.to)} 23:59:59`) : undefined,
    actorFilter(f.user, { pk: auditLog.actorPk, name: auditLog.actorName, email: auditLog.actorEmail }),
    f.role ? eq(auditLog.actorRole, f.role) : undefined,
    f.module ? eq(auditLog.module, f.module) : undefined,
    f.entity ? entityIn(auditLog.entity, f.entity) : undefined,
    f.key ? eq(auditLog.entityKey, f.key) : undefined,
    f.no ? or(eq(auditLog.entityNo, f.no.trim()), eq(auditLog.entityKey, f.no.trim())) : undefined,
    f.action ? eq(auditLog.action, f.action) : undefined,
  );
}

/** status codes in a change (codes, not pks — every entity) → the status lists, read when a page shows one */
const STATUS_NAMES: Record<string, () => Promise<{ id: number; name: string | null }[]>> = {
  jobStatusId: () => db.select({ id: jobStatus.jobStatusId, name: jobStatus.jobStatusName }).from(jobStatus),
  quotationStatusId: () =>
    db
      .select({ id: quotationStatus.quotationStatusId, name: quotationStatus.quotationStatusName })
      .from(quotationStatus),
  approveStatusId: () =>
    db.select({ id: approveStatus.approveStatusId, name: approveStatus.approveNameTh }).from(approveStatus),
};

/** audit fields holding an app_user id — the job rows show the person's name */
const USER_KEYS = new Set(['engineerId', 'sendBy', 'receiveBy', 'jobReturnBy', 'jobRepairedBy', 'jobClosedBy']);
const ASSIGNED_TO = /มอบหมายงานให้ช่าง #(\d+)/;
const symptomNames = (ids: number[]) =>
  db.select({ id: symptom.pk, name: symptom.symptomName }).from(symptom).where(inArray(symptom.pk, ids));
/** audit fields holding a master row's id → its name: the cached master lists; model / shipper / customer by id */
const ID_NAMES: Record<string, (ids: number[]) => Promise<{ id: string | number; name: string | null }[]>> = {
  // by the integer keys the audit rows hold (the master lists answer uuids — ADR 0008)
  jobTypeId: (ids) =>
    db.select({ id: jobType.pk, name: jobType.jobTypeName }).from(jobType).where(inArray(jobType.pk, ids)),
  productTypeId: (ids) =>
    db
      .select({ id: productType.pk, name: productType.productTypeName })
      .from(productType)
      .where(inArray(productType.pk, ids)),
  productBrandId: (ids) => db.select({ id: brand.pk, name: brand.brandName }).from(brand).where(inArray(brand.pk, ids)),
  productSymptomId: (ids) => symptomNames(ids),
  engineerSymptomId: (ids) => symptomNames(ids),
  productModelId: (ids) => db.select({ id: model.pk, name: model.modelCode }).from(model).where(inArray(model.pk, ids)),
  returnShipperId: (ids) =>
    db
      .select({ id: shippingProfile.pk, name: shippingProfile.nameTh })
      .from(shippingProfile)
      .where(inArray(shippingProfile.pk, ids)),
  customerId: (ids) =>
    db
      .select({
        id: customer.pk,
        name: sql<string>`concat_ws(' ', ${customer.customerCode}, ${customer.customerName})`,
      })
      .from(customer)
      .where(inArray(customer.pk, ids)),
};

/** rows as people read them — no pk leaves the server (ADR 0008): a job row's user / master ids → names, status ids →
 *  status names (also in older "มอบหมายงานให้ช่าง #116" lines); a user row's key (its uuid, or the old int) → the
 *  person. An id not found stays as it is. The job history and the audit log page / Excel all read through here. */
async function readable<T extends AuditRow>(rows: T[]): Promise<T[]> {
  const ids = new Set<number>();
  const userIds = new Set<string>();
  const masterIds = new Map<string, Set<number>>();
  const statusKeys = new Set<string>();
  for (const r of rows) {
    if (r.entity === 'app_user') {
      if (isUuid(r.key)) userIds.add(r.key);
      else if (/^\d+$/.test(r.key)) ids.add(Number(r.key));
    }
    for (const k of Object.keys(r.changes ?? {})) if (Object.hasOwn(STATUS_NAMES, k)) statusKeys.add(k);
    if (r.entity !== 'job') continue;
    for (const [k, pair] of Object.entries(r.changes ?? {})) {
      // only a JSON number is an id (rows before drizzle/0006); a string — a name / code, even all digits — is kept
      for (const v of pair.filter((x): x is number => typeof x === 'number' && x > 0))
        if (USER_KEYS.has(k)) ids.add(v);
        else if (Object.hasOwn(ID_NAMES, k)) masterIds.set(k, (masterIds.get(k) ?? new Set<number>()).add(v));
    }
    const m = ASSIGNED_TO.exec(r.summary);
    if (m) ids.add(Number(m[1]));
  }
  const names = new Map(
    await Promise.all(
      [...masterIds].map(async ([k, set]) => {
        const found = await ID_NAMES[k]!([...set]);
        return [k, new Map(found.map((x) => [Number(x.id), x.name]))] as const;
      }),
    ),
  );
  const users =
    ids.size || userIds.size
      ? await db
          .select({
            pk: appUser.pk,
            id: appUser.id,
            f: appUser.firstName,
            l: appUser.lastName,
            e: appUser.emailAddress,
          })
          .from(appUser)
          .where(or(inArray(appUser.pk, [...ids]), inArray(appUser.id, [...userIds])))
      : [];
  const statuses = new Map(
    await Promise.all(
      [...statusKeys].map(
        async (k) => [k, new Map((await STATUS_NAMES[k]!()).map((x) => [x.id, x.name?.trim() ?? '']))] as const,
      ),
    ),
  );
  /** a user field: a JSON number is a pk (rows before drizzle/0006) → the person; anything else (newer rows store the
   *  name) as it is. Never a pk: one with no row (or no name) reads "—" */
  const person = (v: unknown) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v !== 'number') return v;
    if (!(v > 0)) return null; // 0 / -1 = nobody
    const u = users.find((x) => x.pk === v);
    return (u && (fullName(u.f, u.l) || u.e?.trim())) || '—';
  };
  /** a status code (a code, not a pk) → its name; a value already a name stays */
  const status = (k: string, v: unknown) => (typeof v === 'number' ? statuses.get(k)?.get(v) || v : (v ?? null));
  const readableValue = (k: string, v: unknown) =>
    USER_KEYS.has(k)
      ? person(v)
      : Object.hasOwn(STATUS_NAMES, k)
        ? status(k, v)
        : (typeof v === 'number' && names.get(k)?.get(v)) || v;
  const withStatusNames = <R extends AuditRow>(r: R): R =>
    r.changes && Object.keys(r.changes).some((k) => statusKeys.has(k))
      ? {
          ...r,
          // a sale order denied / sent back before 2026-10-29 was logged APPROVE (the log is read-only): it was a status
          action:
            r.action === 'APPROVE' &&
            r.entity === 'sale_order' &&
            [AS.REJECT, AS.DENIED].some((x) => x === r.changes?.approveStatusId?.[1])
              ? 'STATUS'
              : r.action,
          changes: Object.fromEntries(
            Object.entries(r.changes).map(([k, [a, b]]) => [
              k,
              (statusKeys.has(k) ? [status(k, a), status(k, b)] : [a, b]) as [unknown, unknown],
            ]),
          ),
        }
      : r;
  return rows.map((row) => {
    const r = row.entity === 'job' ? row : withStatusNames(row);
    if (r.entity === 'app_user') {
      const u = users.find((x) => x.id === r.key || String(x.pk) === r.key);
      const who = u && [fullName(u.f, u.l), u.e?.trim()].filter(Boolean).join(' · ');
      // a pre-ADR-0008 key is the user's pk: never shown — the person, or "—"
      return who ? { ...r, key: who } : /^\d+$/.test(r.key) ? { ...r, key: '—' } : r;
    }
    if (r.entity !== 'job') return r;
    return {
      ...r,
      // the old "มอบหมายงานให้ช่าง #116" summary text names a pk
      summary: r.summary.replace(ASSIGNED_TO, (_, id: string) => `มอบหมายงานให้ช่าง ${person(Number(id))}`),
      changes:
        r.changes &&
        Object.fromEntries(
          Object.entries(r.changes).map(([k, [a, b]]) => [
            k,
            [readableValue(k, a), readableValue(k, b)] as [unknown, unknown],
          ]),
        ),
    };
  });
}

const SORT = {
  at: auditLog.at,
  user: auditLog.actorName,
  role: auditLog.actorRole,
  action: auditLog.action,
  module: auditLog.module,
  key: auditLog.entityKey,
};

export async function pageAudit(p: PageQuery, f: AuditFilters): Promise<Page<AuditLogRow>> {
  const w = auditWhere(p.q, f);
  // count + page in parallel: the response takes max(count, rows) instead of their sum
  const [counted, rows] = await Promise.all([
    db.select({ total: count() }).from(auditLog).where(w),
    db
      .select()
      .from(auditLog)
      .where(w)
      .orderBy(...orderByCols(p.sort, SORT, [desc(auditLog.pk)]))
      .limit(p.pageSize)
      .offset(offsetOf(p)),
  ]);
  return { rows: await readable(rows.map(toLogRow)), total: totalOf(counted), page: p.page, pageSize: p.pageSize };
}

export async function listAudit(f: AuditFilters & { q?: string; limit?: number }): Promise<AuditLogRow[]> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(auditWhere(f.q ?? '', f))
    .orderBy(desc(auditLog.pk))
    .limit(Math.min(f.limit ?? 1000, MAX_EXPORT_ROWS));
  return readable(rows.map(toLogRow));
}

/** History of one record (job, quotation, …) — newest first. */
export async function auditFor(entity: string, key: string, limit = 100): Promise<AuditRow[]> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(entityIn(auditLog.entity, entity), eq(auditLog.entityKey, key)))
    .orderBy(desc(auditLog.pk))
    .limit(limit);
  return readable(rows.map(toRow));
}

export async function auditModules(): Promise<string[]> {
  const rows = await db
    .select({ m: auditLog.module })
    .from(auditLog)
    .groupBy(auditLog.module)
    .orderBy(sql`count(*) desc`);
  return rows.map((r) => r.m).filter(Boolean);
}
