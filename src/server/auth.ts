import 'server-only';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { appUser, rolePermission } from '@/db/schema';
import {
  guardDenied,
  need,
  permissionOf,
  refused,
  requestCtx,
  runInRequest,
  setRequestSession,
  setRequestUser,
} from '@/server/request-context';
import type { z } from 'zod';
import { verifySession, SESSION_COOKIE, type SessionUser } from '@/lib/session';
import { summary, validate } from '@/lib/validation';
import type { Invalid, Part } from '@/server/contract/registry';
import { readSmallJson } from '@/server/track-http';
import { log, logError, requestFields, requestId } from '@/lib/log';
import { isOwner, PENDING_ROLE } from '@/lib/access';
import {
  ADMIN_USER_TYPE,
  checkGrant,
  checkRight,
  noRight,
  RIGHTS,
  type Action,
  type Grant,
  type GrantMap,
  MODULE_LABELS,
  type Module,
  type Right,
} from '@/lib/modules';

/** The signed-in person, resolved against app_user (the single user table). */
export type CurrentUser = {
  /** app_user.pk — server-side only (audit actor, every *_app_user_pk foreign key) */
  pk: number;
  /** app_user.id — the uuid that leaves the server (the pages' useAccess().userId, os_seen) */
  id: string;
  email: string;
  name: string;
  avatar: string;
  /** legacy user_type; null = waiting for approval */
  userType: string | null;
  /** UI role string (user_type or "รออนุมัติ") */
  role: string;
  isActive: boolean;
  isAdmin: boolean;
  approved: boolean;
  session: SessionUser;
};

import { BAD_INPUT, HttpError } from './http-error';
export { HttpError };

export const fullName = (first?: string | null, last?: string | null) =>
  [first ?? '', last ?? '']
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');

const normEmail = (e: string) => e.trim().toLowerCase();

/** Look up the app_user row for an email (case/whitespace-insensitive); `q` = a transaction to read in. */
export async function findAppUserByEmail(email: string, q: Pick<typeof db, 'select'> = db) {
  const e = normEmail(email);
  if (!e) return null;
  const rows = await q
    .select()
    .from(appUser)
    .where(sql`lower(trim(${appUser.emailAddress})) = ${e}`)
    .limit(1);
  return rows[0] ?? null;
}

// app_user rows cached 10 s per email (a screen fires 10–20 calls on load); admin edits call invalidateUserCache(),
// the TTL only bounds what a direct SQL edit can lag by.
type AppUserRow = NonNullable<Awaited<ReturnType<typeof findAppUserByEmail>>>;
// on globalThis so an admin write (which clears it) is seen by pages too — see src/server/cache.ts
const g = globalThis as typeof globalThis & {
  __shdUserCache?: Map<string, { at: number; row: AppUserRow }>;
  __shdGrantCache?: Map<string, { at: number; grants: GrantMap }>;
  __shdAuthGen?: { user: number; grant: number };
};
const userCache = (g.__shdUserCache ??= new Map<string, { at: number; row: AppUserRow }>());
const USER_TTL = 10_000;
/** bumped by every invalidate: a load that started before it (read the old row) must not store what it read */
const gen = (g.__shdAuthGen ??= { user: 0, grant: 0 });

export function invalidateUserCache(email?: string) {
  gen.user++;
  if (email) userCache.delete(normEmail(email));
  else userCache.clear();
}

/** Sign this user out everywhere: every cookie carrying the old version stops working. `w` = the transaction that
 *  also writes the LOGOUT line (src/app/api/sso/logout); the caller clears the user cache once it committed.
 *  Answers the user's app_user.pk (null: no such user). */
export async function bumpSessionVersion(email: string, w: Pick<typeof db, 'update'> = db): Promise<number | null> {
  const e = normEmail(email);
  if (!e) return null;
  const [row] = await w
    .update(appUser)
    .set({ sessionVersion: sql`${appUser.sessionVersion} + 1` })
    .where(sql`lower(trim(${appUser.emailAddress})) = ${e}`)
    .returning({ pk: appUser.pk });
  return row?.pk ?? null;
}

async function cachedAppUser(email: string): Promise<AppUserRow | null> {
  const key = normEmail(email);
  const hit = userCache.get(key);
  if (hit && Date.now() - hit.at < USER_TTL) return hit.row;
  const at = gen.user;
  const row = await findAppUserByEmail(key);
  if (gen.user !== at) return row; // invalidated while reading — this row may predate the change
  if (row)
    userCache.set(key, { at: Date.now(), row }); // a missing row is never cached (first login race)
  else userCache.delete(key);
  return row;
}

/**
 * Fail closed: the cookie only says WHO signed in — role, status and session version always come from app_user.
 * No row → null (the SSO callback creates it before issuing a cookie). DB unreachable → 503, never trust the cookie.
 */
export async function resolveUser(session: SessionUser | null): Promise<CurrentUser | null> {
  if (!session) return null;
  const owner = isOwner(session.email);
  let row: AppUserRow | null = null;
  try {
    row = await cachedAppUser(session.email);
  } catch (e) {
    logError(e, 'auth user lookup failed');
    throw new HttpError(503, 'ระบบฐานข้อมูลไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง');
  }
  if (!row) return null;
  // logout (any device) bumps session_version → every older cookie of this user is dead
  if ((row.sessionVersion ?? 0) !== session.sv) return null;
  // owner = bootstrap for a row that has no role yet; a role or disable set by an admin wins
  const userType = row.userType?.trim() || (owner ? ADMIN_USER_TYPE : null);
  const isActive = row.recordStatus === 'ACTIVE';
  const isAdmin = userType === ADMIN_USER_TYPE;
  return {
    pk: row.pk,
    id: row.id,
    email: session.email,
    name: fullName(row.firstName, row.lastName) || session.name,
    avatar: row.avatar || session.avatar || '',
    userType,
    role: userType ?? PENDING_ROLE,
    isActive,
    isAdmin,
    approved: !!userType && isActive,
    session,
  };
}

export async function userFromRequest(req: NextRequest): Promise<CurrentUser | null> {
  return resolveUser(await verifySession(req.cookies.get(SESSION_COOKIE)?.value));
}

export async function userFromCookies(): Promise<CurrentUser | null> {
  const store = await cookies();
  return resolveUser(await verifySession(store.get(SESSION_COOKIE)?.value));
}

// Grants cached per user_type for 60 s, per process (a second instance would serve a revoked grant up to the TTL).
// Admin paths that change them invalidate here; a write is never decided by a cache: assertActor() re-reads in the tx.
const cache = (g.__shdGrantCache ??= new Map<string, { at: number; grants: GrantMap }>());
const TTL = 60_000;

export async function grantsForUserType(userType: string | null): Promise<GrantMap> {
  if (!userType) return {};
  const hit = cache.get(userType);
  if (hit && Date.now() - hit.at < TTL) return hit.grants;
  const at = gen.grant;
  const rows = await db
    .select({
      module: rolePermission.moduleName,
      add: rolePermission.canInsert,
      edit: rolePermission.canEdit,
      del: rolePermission.canDelete,
      view: rolePermission.canView,
    })
    .from(rolePermission)
    .where(eq(rolePermission.userType, userType));
  const grants: GrantMap = {};
  for (const r of rows) {
    if (!r.module) continue;
    const g: Grant = { add: !!r.add, edit: !!r.edit, del: !!r.del, view: !!r.view };
    grants[r.module.trim()] = g;
  }
  if (gen.grant === at) cache.set(userType, { at: Date.now(), grants }); // not when invalidated while reading
  return grants;
}

export function invalidateGrantCache() {
  gen.grant++;
  cache.clear();
}

/** A grant / right that let the request through is recorded (request-context `need`): the write re-checks it. */
export async function can(user: CurrentUser, module: Module | null, action: Action) {
  const ok = user.isAdmin || checkGrant(false, await grantsForUserType(user.userType), module, action);
  if (ok && module) need(user, { kind: 'grant', modules: [module], action });
  else if (!ok) refused(user, `${module ?? '-'}:${action}`);
  return ok;
}

/** Special right (สิทธิ์พิเศษ — role_permission row `right`, can_view) of this user's role. */
export async function hasRight(user: Pick<CurrentUser, 'isAdmin' | 'userType'>, right: Right): Promise<boolean> {
  const ok = checkRight(user.isAdmin, await grantsForUserType(user.userType), right);
  if (ok) need(user, { kind: 'right', right });
  else refused(user, right); // SO Approve, Export … — the 403 the caller throws is logged as DENIED (handle)
  return ok;
}

/** The same for a user by app_user.pk (an assignee, who saves a job) — their role as stored in app_user. For the
 *  request's own user a yes is recorded like hasRight's: the write re-checks it (Job Reopen, Job Take, …). */
export async function userHasRight(userPk: number, right: Right): Promise<boolean> {
  const [u] = await db.select({ t: appUser.userType }).from(appUser).where(eq(appUser.pk, userPk)).limit(1);
  const userType = u?.t?.trim() || null;
  const ok = checkRight(userType === ADMIN_USER_TYPE, await grantsForUserType(userType), right);
  const self = requestCtx()?.user;
  if (ok && self?.pk === userPk) need(self, { kind: 'right', right });
  return ok;
}

/** The roles ticked for a right (an implicit System Admin hold is not a row) — assignee list, messages. */
export async function rolesWithRight(right: Right): Promise<string[]> {
  const rows = await db
    .select({ t: rolePermission.userType })
    .from(rolePermission)
    .where(and(eq(rolePermission.moduleName, right), eq(rolePermission.canView, true)))
    .orderBy(rolePermission.userType);
  return rows.map((r) => r.t?.trim() ?? '').filter(Boolean);
}

export async function requireUser(req: NextRequest): Promise<CurrentUser> {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const u = await resolveUser(session);
  if (!u) {
    // a cookie that still verifies but is refused: signed out (session_version moved — another device, or an admin)
    // or the account's row / email is gone → DENIED, naming the account when it still exists
    if (session) {
      const row = await cachedAppUser(session.email).catch(() => null);
      if (row) {
        setRequestSession(session.email, session.iat);
        guardDenied({ pk: row.pk, userType: row.userType?.trim() || null }, 'session', 'บัญชีนี้ออกจากระบบแล้ว');
      }
    }
    throw new HttpError(401, 'unauthorized');
  }
  if (!u.approved) {
    const msg = u.userType && !u.isActive ? 'บัญชีนี้ถูกปิดการใช้งาน' : 'รอการอนุมัติสิทธิ์การใช้งาน';
    setRequestSession(u.session.email, u.session.iat);
    guardDenied(u, 'account', msg); // set INACTIVE / role taken away mid-session
    throw new HttpError(403, msg);
  }
  setRequestUser(u);
  return u;
}

export async function requireCan(req: NextRequest, module: Module | null, action: Action): Promise<CurrentUser> {
  const u = await requireUser(req);
  if (!(await can(u, module, action))) {
    // a special right (Report, …) names the right the way the permission screen does
    const menu = module && `เมนู "${MODULE_LABELS[module as keyof typeof MODULE_LABELS] ?? module}"`;
    const msg =
      module && module in RIGHTS ? noRight(module as Right) : `ไม่มีสิทธิ์${ACTION_TH[action]}ใน${menu || 'ส่วนนี้'}`;
    guardDenied(u, `${module ?? '-'}:${action}`, msg);
    throw new HttpError(403, msg);
  }
  return u;
}
/** the action in the 403 message — the module is named by its Thai menu (MODULE_LABELS) */
const ACTION_TH: Record<Action, string> = { add: 'เพิ่ม', edit: 'แก้ไข', del: 'ลบ', view: 'ดู' };

/** Every job screen — a job (and its calls/attachments) is readable from any of them. */
export const JOB_MODULES: readonly Module[] = ['Job Management', 'Job Assign', 'Job Repair', 'Job Closing'];
/** Every product / stock screen — the product detail and its picture are readable from any of them. */
export const PRODUCT_MODULES: readonly Module[] = [
  'Product',
  'Product Onhand',
  'Product Receive Stock',
  'Product Pick Stock',
];
/** A sale order (and its slip): its own screen, and stock pick, which issues against it. */
export const SALE_ORDER_READERS: readonly Module[] = ['Sale Order', 'Product Pick Stock'];

/** True when the user may view at least one of `modules` (screens that legitimately read the data). */
export async function canViewAny(user: CurrentUser, modules: readonly Module[]) {
  const grants = user.isAdmin ? {} : await grantsForUserType(user.userType);
  const ok = user.isAdmin || modules.some((m) => checkGrant(false, grants, m, 'view'));
  if (ok) need(user, { kind: 'grant', modules, action: 'view' });
  return ok;
}

/** Read guard: signed in + approved + "view" on any one of `modules`. */
export async function requireView(req: NextRequest, modules: readonly Module[]): Promise<CurrentUser> {
  const u = await requireUser(req);
  if (!(await canViewAny(u, modules))) {
    guardDenied(u, permissionOf([{ kind: 'grant', modules, action: 'view' }])!, 'ไม่มีสิทธิ์ดูข้อมูลส่วนนี้');
    throw new HttpError(403, 'ไม่มีสิทธิ์ดูข้อมูลส่วนนี้');
  }
  return u;
}

export async function requireAdmin(req: NextRequest): Promise<CurrentUser> {
  const u = await requireUser(req);
  if (!u.isAdmin) {
    guardDenied(u, 'System Admin', 'เฉพาะ System Admin');
    throw new HttpError(403, 'เฉพาะ System Admin');
  }
  need(u, { kind: 'admin' });
  return u;
}

/**
 * Runs the route in its request context (audit() / security() / assertActor() read it) and logs a refusal
 * assertActor() made inside a write, after its transaction rolled back. Outside production every answer is checked
 * against src/server/contract (logged under dev, thrown under API_CONTRACT_STRICT=1). handle() includes it.
 */
export function checked<T extends unknown[]>(fn: (...args: T) => Promise<Response>): (...args: T) => Promise<Response> {
  const check = process.env.NODE_ENV !== 'production';
  return (...args) => {
    const req = args[0];
    if (!(req instanceof Request)) return fn(...args);
    return runInRequest(req, async () => {
      try {
        const res = await fn(...args);
        if (check) await (await import('@/server/contract/check')).checkResponse(req, res);
        return res;
      } finally {
        if (requestCtx()?.denied) await (await import('@/server/audit')).logDenied();
      }
    });
  };
}

/** Uniform JSON error handling for route handlers. */
export function handle<T extends unknown[]>(fn: (...args: T) => Promise<Response>): (...args: T) => Promise<Response> {
  return checked(async (...args: T) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) {
        // a 403 thrown past the guards (a service's own rule: SO Approve, Export, the creator-only cancel …) — DENIED,
        // with the right hasRight() / can() last refused, throttled as the guards' own
        const c = requestCtx();
        if (e.status === 403 && c?.user && !c.deniedSeen) guardDenied(c.user, c.refused ?? 'refused', e.message);
        return NextResponse.json(
          e.details === undefined ? { error: e.message } : { error: e.message, details: e.details },
          { status: e.status },
        );
      }
      // Postgres errors the user can act on (drizzle wraps the pg error in .cause)
      const code = pgCode(e);
      if (code === '23505') return NextResponse.json({ error: 'ข้อมูลซ้ำกับที่มีอยู่แล้ว' }, { status: 409 });
      // FK / CHECK: the services check first, so reaching the DB rule is worth a log line
      if (code === '23503' || code === '23514') {
        logError(e, 'db constraint refused a write', { code }, args[0] instanceof Request ? args[0] : undefined);
        return NextResponse.json(
          {
            error:
              code === '23503'
                ? 'ข้อมูลที่อ้างถึงไม่มีอยู่หรือถูกลบไปแล้ว กรุณาโหลดหน้าใหม่'
                : 'ข้อมูลไม่ผ่านเงื่อนไข (เช่น จำนวนหรือราคาติดลบ)',
          },
          { status: 409 },
        );
      }
      // a value the DB cannot take (22xxx: NUL byte, not a number, too long, out of range) or a
      // malformed %-escape: the caller's input, not a server fault — warned (a bug can land here too), not paged
      if (e instanceof URIError || code?.startsWith('22')) {
        const req = args[0] instanceof Request ? args[0] : undefined;
        log.warn('input refused by db', { code: code ?? 'URIError', ...(req ? requestFields(req) : {}) });
        return NextResponse.json({ error: BAD_INPUT }, { status: 400 });
      }
      if (code === '57014')
        return NextResponse.json({ error: 'ใช้เวลานานเกินไป ลองจำกัดช่วงข้อมูลให้แคบลง' }, { status: 503 });
      if (code === '40P01' || code === '40001')
        return NextResponse.json(
          { error: 'มีผู้ใช้อื่นบันทึกข้อมูลเดียวกันพร้อมกัน กรุณาลองใหม่อีกครั้ง' },
          { status: 409 },
        );
      // unexpected error: the details (SQL, stack — parameters scrubbed) stay in the server log;
      // the browser only gets a reference to quote when reporting it (= Cloudflare ray id when present)
      const req = args[0] instanceof Request ? args[0] : undefined;
      const ref = (requestCtx()?.requestId ?? (req ? requestId(req) : crypto.randomUUID())).slice(0, 16);
      logError(e, 'unhandled API error', { ref }, req);
      const msg = e instanceof Error ? e.message : String(e);
      const status = /DATABASE_URL/.test(msg) || code === '08006' || code === '57P01' ? 503 : 500;
      return NextResponse.json({ error: `เกิดข้อผิดพลาดในระบบ (รหัสอ้างอิง ${ref})`, ref }, { status });
    }
  });
}

const MAX_JSON_BYTES = 1_000_000;

/**
 * Parse a JSON body or 400. Content-Type must be application/json: a cross-site <form> or text/plain fetch can't
 * produce it, closing the CSRF path SameSite=Lax leaves to same-site sibling hosts.
 */
export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? ''))
    throw new HttpError(415, 'ต้องส่งข้อมูลเป็น JSON');
  if (Number(req.headers.get('content-length') ?? 0) > MAX_JSON_BYTES) throw new HttpError(413, 'ข้อมูลใหญ่เกินไป');
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw new HttpError(413, 'ข้อมูลใหญ่เกินไป'); // bytes — Thai is 3 per char
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

// Read request input ONLY through these, with the operation's schemas (scripts/test-routes-input.mts enforces it).
// Call them where the route always read that part: a check's place decides which of 401 / 403 / 400 / 404 comes first.
type Declares<K extends Part, S> = { [P in K]: S } & { invalid?: Invalid };

function parsePart<S extends z.ZodType>(op: { invalid?: Invalid }, part: Part, schema: S, value: unknown): z.output<S> {
  const how = op.invalid?.[part] ?? 'fields';
  if (how === 'fields') {
    const v = validate(schema, value);
    if (v.ok) return v.data;
    throw new HttpError(400, summary(v.errors), { fields: v.errors });
  }
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  throw new HttpError(how, r.error.issues[0]?.message ?? 'invalid');
}

/** first value per name — what URLSearchParams.get / FormData.get read */
function firstOf<V>(each: (fn: (value: V, name: string) => void) => void): Record<string, V> {
  const seen = new Map<string, V>();
  each((value, name) => {
    if (!seen.has(name)) seen.set(name, value);
  });
  return Object.fromEntries(seen);
}

/** The path parameters (`ctx.params` of a dynamic route). */
export async function parseParams<S extends z.ZodType>(
  ctx: { params: Promise<unknown> },
  op: Declares<'params', S>,
): Promise<z.output<S>> {
  return parsePart(op, 'params', op.params, await ctx.params);
}

/** The query string (a repeated name: its first value). */
export function parseQuery<S extends z.ZodType>(req: Request, op: Declares<'query', S>): z.output<S> {
  const sp = new URL(req.url).searchParams;
  return parsePart(
    op,
    'query',
    op.query,
    firstOf<string>((fn) => sp.forEach(fn)),
  );
}

/** The request headers the operation declares (case-insensitive, as HTTP). */
export function parseHeaders<S extends z.ZodObject>(req: Request, op: Declares<'headers', S>): z.output<S> {
  const sent = Object.keys(op.headers.shape).flatMap((name) => {
    const value = req.headers.get(name);
    return value === null ? [] : [[name, value] as const];
  });
  return parsePart(op, 'headers', op.headers, Object.fromEntries(sent));
}

/** A JSON body (readJson's 415 / 413 / 400 invalid_json first). */
export async function parseBody<S extends z.ZodType>(req: NextRequest, op: Declares<'body', S>): Promise<z.output<S>> {
  return parsePart(op, 'body', op.body, await readJson(req));
}

/** The small JSON body of the public /track routes: over 8 KB throws BodyTooLarge (→ 413); not JSON or not an object reads as `{}`. */
export async function parseTrackBody<S extends z.ZodType>(
  req: NextRequest,
  op: Declares<'body', S>,
): Promise<z.output<S>> {
  return parsePart(op, 'body', op.body, await readSmallJson(req));
}

/** A multipart/form-data body (a repeated name: its first value). */
export async function parseForm<S extends z.ZodType>(req: NextRequest, op: Declares<'form', S>): Promise<z.output<S>> {
  const form = await req.formData().catch(() => null);
  if (!form) throw new HttpError(400, 'expected multipart/form-data');
  return parsePart(
    op,
    'form',
    op.form,
    firstOf<FormDataEntryValue>((fn) => form.forEach(fn)),
  );
}

/** SQLSTATE of a Postgres error, also when drizzle wraps it (DrizzleQueryError.cause). */
function pgCode(e: unknown): string | undefined {
  for (let x: unknown = e, i = 0; x && i < 3; x = (x as { cause?: unknown }).cause, i++) {
    const c = (x as { code?: unknown }).code;
    if (typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c)) return c;
  }
  return undefined;
}
