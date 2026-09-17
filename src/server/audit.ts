import "server-only";
import { and, desc, eq, gte, ilike, lte, or, sql, count } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { appUser, auditLog } from "@/db/schema";
import { fullName } from "@/server/auth";
import { nowThai, fmtDateTime } from "@/server/mappers/format";
import { orderBy as orderByCols, offsetOf, type Page, type PageQuery } from "@/server/paging";

/**
 * Audit trail — every write the app performs records WHO did WHAT to WHICH
 * record, with the changed fields. Call `audit(tx, userId, …)` inside the same
 * transaction as the data change so log and data can never disagree.
 */
export type AuditAction =
  | "CREATE" | "UPDATE" | "DELETE" | "STATUS" | "APPROVE" | "ASSIGN"
  | "ISSUE" | "RECEIVE" | "RETURN" | "UPLOAD" | "LOGIN";

export type AuditChanges = Record<string, [unknown, unknown]>;

export type AuditEntry = {
  action: AuditAction;
  /** module name as in app_config (Job Management, Product, …) or "Admin" / "Auth" */
  module: string;
  /** table name */
  entity: string;
  /** business key: J2612088, Q2600462, P00012, user_id … */
  key: string | number;
  /** short human-readable line for the log list */
  summary: string;
  changes?: AuditChanges | null;
  meta?: Record<string, unknown> | null;
};

type Writer = Tx | typeof db;

/* user-name snapshot cache (60 s) so a write costs one INSERT, not an extra SELECT each time */
const names = new Map<number, { at: number; name: string }>();
export async function actorName(userId: number, w: Writer = db): Promise<string> {
  if (!userId || userId <= 0) return "";
  const hit = names.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.name;
  const [u] = await w.select({ f: appUser.firstName, l: appUser.lastName, un: appUser.username }).from(appUser).where(eq(appUser.userId, userId));
  const name = u ? fullName(u.f, u.l) || u.un || `#${userId}` : `#${userId}`;
  names.set(userId, { at: Date.now(), name });
  return name;
}

export async function audit(w: Writer, userId: number, e: AuditEntry): Promise<void> {
  await w.insert(auditLog).values({
    at: nowThai(),
    userId: userId > 0 ? userId : 0,
    userName: (await actorName(userId, w)).slice(0, 100),
    action: e.action,
    module: e.module.slice(0, 50),
    entity: e.entity.slice(0, 50),
    entityKey: String(e.key ?? "").slice(0, 100),
    summary: e.summary.slice(0, 200),
    changes: e.changes && Object.keys(e.changes).length ? e.changes : null,
    meta: e.meta ?? null,
  });
}

const norm = (v: unknown): unknown => {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t); // numeric strings from pg
    return t;
  }
  return v;
};

/**
 * Fields in `after` whose value differs from `before` → {field: [old, new]}.
 * Only keys present in `after` are compared (a partial update never reports
 * untouched columns); status stamps and timestamps are skipped by default.
 */
export function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  opts: { skip?: string[] } = {}
): AuditChanges | null {
  const skip = new Set(["statusChangedAt", "statusChangedBy", "lastUpdate", "createDate", "jobCreateDate", ...(opts.skip ?? [])]);
  const out: AuditChanges = {};
  for (const [k, v] of Object.entries(after)) {
    if (v === undefined || skip.has(k)) continue;
    const a = norm(before ? before[k] : undefined);
    const b = norm(v);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = [a, b];
  }
  return Object.keys(out).length ? out : null;
}

/* ------------------------------------------------------------------ *
 * Reading (admin page + per-record history)
 * ------------------------------------------------------------------ */
export type AuditRow = {
  id: number;
  at: string;
  userId: number;
  user: string;
  action: AuditAction;
  module: string;
  entity: string;
  key: string;
  summary: string;
  changes: AuditChanges | null;
};

export type AuditFilters = { from?: string; to?: string; user?: string; module?: string; entity?: string; key?: string; action?: string };

const toRow = (r: typeof auditLog.$inferSelect): AuditRow => ({
  id: r.id,
  at: fmtDateTime(r.at),
  userId: r.userId,
  user: r.userName,
  action: r.action as AuditAction,
  module: r.module,
  entity: r.entity,
  key: r.entityKey,
  summary: r.summary,
  changes: (r.changes as AuditChanges | null) ?? null,
});

function auditWhere(q: string, f: AuditFilters) {
  const term = q.trim();
  return and(
    term ? or(ilike(auditLog.entityKey, `%${term}%`), ilike(auditLog.summary, `%${term}%`), ilike(auditLog.userName, `%${term}%`)) : undefined,
    f.from ? gte(auditLog.at, `${f.from} 00:00:00`) : undefined,
    f.to ? lte(auditLog.at, `${f.to} 23:59:59`) : undefined,
    f.user ? (/^\d+$/.test(f.user) ? eq(auditLog.userId, Number(f.user)) : ilike(auditLog.userName, `%${f.user}%`)) : undefined,
    f.module ? eq(auditLog.module, f.module) : undefined,
    f.entity ? eq(auditLog.entity, f.entity) : undefined,
    f.key ? eq(auditLog.entityKey, f.key) : undefined,
    f.action ? eq(auditLog.action, f.action) : undefined
  );
}

const SORT = { at: auditLog.at, user: auditLog.userName, action: auditLog.action, module: auditLog.module, key: auditLog.entityKey };

export async function pageAudit(p: PageQuery, f: AuditFilters): Promise<Page<AuditRow>> {
  const w = auditWhere(p.q, f);
  const [{ total }] = await db.select({ total: count() }).from(auditLog).where(w);
  const rows = await db.select().from(auditLog).where(w).orderBy(...orderByCols(p.sort, SORT, [desc(auditLog.id)])).limit(p.pageSize).offset(offsetOf(p));
  return { rows: rows.map(toRow), total: Number(total), page: p.page, pageSize: p.pageSize };
}

export async function listAudit(f: AuditFilters & { q?: string; limit?: number }): Promise<AuditRow[]> {
  const rows = await db.select().from(auditLog).where(auditWhere(f.q ?? "", f)).orderBy(desc(auditLog.id)).limit(Math.min(f.limit ?? 1000, 20000));
  return rows.map(toRow);
}

/** History of one record (job, quotation, …) — newest first. */
export async function auditFor(entity: string, key: string, limit = 100): Promise<AuditRow[]> {
  const rows = await db.select().from(auditLog).where(and(eq(auditLog.entity, entity), eq(auditLog.entityKey, key))).orderBy(desc(auditLog.id)).limit(limit);
  return rows.map(toRow);
}

export async function auditModules(): Promise<string[]> {
  const rows = await db.select({ m: auditLog.module }).from(auditLog).groupBy(auditLog.module).orderBy(sql`count(*) desc`);
  return rows.map((r) => r.m).filter(Boolean);
}
