import 'server-only';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { appConfig, appUser } from '@/db/schema';
import type { z } from 'zod';
import { verifySession, SESSION_COOKIE, type SessionUser } from '@/lib/session';
import { summary, validate } from '@/lib/validation';
import type { Invalid, Part } from '@/server/contract/registry';
import { readSmallJson } from '@/server/track-http';
import { logError, requestId } from '@/lib/log';
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
  type Module,
  type Right,
} from '@/lib/modules';

/** The signed-in person, resolved against app_user (the single user table). */
export type CurrentUser = {
  userId: number;
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

import { HttpError } from './http-error';
export { HttpError };

export const fullName = (first?: string | null, last?: string | null) =>
  [first ?? '', last ?? '']
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');

const normEmail = (e: string) => e.trim().toLowerCase();

/** Look up the app_user row for an email (case/whitespace-insensitive). */
export async function findAppUserByEmail(email: string) {
  const e = normEmail(email);
  if (!e) return null;
  const rows = await db
    .select()
    .from(appUser)
    .where(sql`lower(trim(${appUser.emailAddress})) = ${e}`)
    .limit(1);
  return rows[0] ?? null;
}

/* ------------------------------------------------------------------ *
 * app_user lookup — cached 10 s per email. A screen fires 10–20 API calls
 * on load and every one of them resolved the same row; now it is one query
 * per user per 10 s. Admin edits (approve / role / delete) call
 * invalidateUserCache() so they still take effect immediately; the TTL only
 * bounds what a direct SQL edit can lag by.
 * ------------------------------------------------------------------ */
type AppUserRow = NonNullable<Awaited<ReturnType<typeof findAppUserByEmail>>>;
// on globalThis: the build loads /api routes and pages in separate module copies — one cache per process,
// so an admin write (which clears it) is seen by pages too (same reason as src/server/cache.ts)
const g = globalThis as typeof globalThis & {
  __shdUserCache?: Map<string, { at: number; row: AppUserRow }>;
  __shdGrantCache?: Map<string, { at: number; grants: GrantMap }>;
};
const userCache = (g.__shdUserCache ??= new Map<string, { at: number; row: AppUserRow }>());
const USER_TTL = 10_000;

export function invalidateUserCache(email?: string) {
  if (email) userCache.delete(normEmail(email));
  else userCache.clear();
}

/** Sign this user out everywhere: every cookie carrying the old version stops working. */
export async function bumpSessionVersion(email: string): Promise<void> {
  const e = normEmail(email);
  if (!e) return;
  await db
    .update(appUser)
    .set({ sessionVersion: sql`${appUser.sessionVersion} + 1` })
    .where(sql`lower(trim(${appUser.emailAddress})) = ${e}`);
  invalidateUserCache(e);
}

async function cachedAppUser(email: string): Promise<AppUserRow | null> {
  const key = normEmail(email);
  const hit = userCache.get(key);
  if (hit && Date.now() - hit.at < USER_TTL) return hit.row;
  const row = await findAppUserByEmail(key);
  if (row)
    userCache.set(key, { at: Date.now(), row }); // a missing row is never cached (first login race)
  else userCache.delete(key);
  return row;
}

/**
 * Resolve a verified session cookie payload to the current user.
 *
 * Fail closed: the cookie only says WHO signed in — role, status and the session
 * version always come from app_user. No row (email changed / row removed) → null;
 * the SSO callback creates the row BEFORE it issues a cookie, so a legitimate
 * session always has one. DB unreachable → 503, never "trust the cookie".
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
    userId: row.userId,
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

/** Current user from a route handler's request. */
export async function userFromRequest(req: NextRequest): Promise<CurrentUser | null> {
  return resolveUser(await verifySession(req.cookies.get(SESSION_COOKIE)?.value));
}

/** Current user inside server components / layouts. */
export async function userFromCookies(): Promise<CurrentUser | null> {
  const store = await cookies();
  return resolveUser(await verifySession(store.get(SESSION_COOKIE)?.value));
}

/* ------------------------------------------------------------------ *
 * Permissions (app_config) — cached per user_type for 60 s.
 * ------------------------------------------------------------------ */
const cache = (g.__shdGrantCache ??= new Map<string, { at: number; grants: GrantMap }>());
const TTL = 60_000;

export async function grantsForUserType(userType: string | null): Promise<GrantMap> {
  if (!userType) return {};
  const hit = cache.get(userType);
  if (hit && Date.now() - hit.at < TTL) return hit.grants;
  const rows = await db
    .select({
      module: appConfig.moduleName,
      add: appConfig.canInsert,
      edit: appConfig.canEdit,
      del: appConfig.canDelete,
      view: appConfig.canView,
    })
    .from(appConfig)
    .where(eq(appConfig.userType, userType));
  const grants: GrantMap = {};
  for (const r of rows) {
    if (!r.module) continue;
    const g: Grant = { add: !!r.add, edit: !!r.edit, del: !!r.del, view: !!r.view };
    grants[r.module.trim()] = g;
  }
  cache.set(userType, { at: Date.now(), grants });
  return grants;
}

export function invalidateGrantCache() {
  cache.clear();
}

export async function can(user: CurrentUser, module: Module | null, action: Action) {
  if (user.isAdmin) return true;
  return checkGrant(false, await grantsForUserType(user.userType), module, action);
}

/** Special right (สิทธิ์พิเศษ — app_config row `right`, can_view) of this user's role. */
export async function hasRight(user: Pick<CurrentUser, 'isAdmin' | 'userType'>, right: Right): Promise<boolean> {
  return checkRight(user.isAdmin, await grantsForUserType(user.userType), right);
}

/** The same for another user by id (an assignee, who saves a job) — their role as stored in app_user. */
export async function userHasRight(userId: number, right: Right): Promise<boolean> {
  const [u] = await db.select({ t: appUser.userType }).from(appUser).where(eq(appUser.userId, userId)).limit(1);
  const userType = u?.t?.trim() || null;
  return hasRight({ isAdmin: userType === ADMIN_USER_TYPE, userType }, right);
}

/** The roles ticked for a right (an implicit System Admin hold is not a row) — assignee list, messages. */
export async function rolesWithRight(right: Right): Promise<string[]> {
  const rows = await db
    .select({ t: appConfig.userType })
    .from(appConfig)
    .where(and(eq(appConfig.moduleName, right), eq(appConfig.canView, true)))
    .orderBy(appConfig.userType);
  return rows.map((r) => r.t?.trim() ?? '').filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * Route-handler guards. Throw HttpError; wrap handlers with `handle()`.
 * ------------------------------------------------------------------ */
export async function requireUser(req: NextRequest): Promise<CurrentUser> {
  const u = await userFromRequest(req);
  if (!u) throw new HttpError(401, 'unauthorized');
  if (!u.approved)
    throw new HttpError(403, u.userType && !u.isActive ? 'บัญชีนี้ถูกปิดการใช้งาน' : 'รอการอนุมัติสิทธิ์การใช้งาน');
  return u;
}

export async function requireCan(req: NextRequest, module: Module | null, action: Action): Promise<CurrentUser> {
  const u = await requireUser(req);
  if (!(await can(u, module, action))) {
    // a special right (Report, …) names the right the way the permission screen does
    if (module && module in RIGHTS) throw new HttpError(403, noRight(module as Right));
    throw new HttpError(403, `ไม่มีสิทธิ์${ACTION_TH[action]}ใน ${module ?? 'ส่วนนี้'}`);
  }
  return u;
}
/** the action in the 403 message — the module keeps its permission-screen name */
const ACTION_TH: Record<Action, string> = { add: 'เพิ่ม', edit: 'แก้ไข', del: 'ลบ', view: 'ดู' };

/** Every job screen — a job (and its calls/attachments) is readable from any of them. */
export const JOB_MODULES: readonly Module[] = ['Job Management', 'Job Assign', 'Job Repair', 'Job Closing'];

/** True when the user may view at least one of `modules` (screens that legitimately read the data). */
export async function canViewAny(user: CurrentUser, modules: readonly Module[]) {
  if (user.isAdmin) return true;
  const grants = await grantsForUserType(user.userType);
  return modules.some((m) => checkGrant(false, grants, m, 'view'));
}

/** Read guard: signed in + approved + "view" on any one of `modules`. */
export async function requireView(req: NextRequest, modules: readonly Module[]): Promise<CurrentUser> {
  const u = await requireUser(req);
  if (!(await canViewAny(u, modules))) throw new HttpError(403, 'ไม่มีสิทธิ์ดูข้อมูลส่วนนี้');
  return u;
}

export async function requireAdmin(req: NextRequest): Promise<CurrentUser> {
  const u = await requireUser(req);
  if (!u.isAdmin) throw new HttpError(403, 'เฉพาะ System Admin');
  return u;
}

/**
 * Outside production every answer is held to its declaration in src/server/contract (check.ts): a log
 * line "API contract drift" under `next dev`, a thrown error under API_CONTRACT_STRICT=1 (the tests).
 * Production gets `fn` itself. handle() includes it; routes that answer without handle() wrap themselves.
 */
export function checked<T extends unknown[]>(fn: (...args: T) => Promise<Response>): (...args: T) => Promise<Response> {
  if (process.env.NODE_ENV === 'production') return fn;
  return async (...args) => {
    const res = await fn(...args);
    if (args[0] instanceof Request) await (await import('@/server/contract/check')).checkResponse(args[0], res);
    return res;
  };
}

/** Uniform JSON error handling for route handlers. */
export function handle<T extends unknown[]>(fn: (...args: T) => Promise<Response>): (...args: T) => Promise<Response> {
  return checked(async (...args: T) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json(
          e.details === undefined ? { error: e.message } : { error: e.message, details: e.details },
          { status: e.status },
        );
      }
      // Postgres errors the user can act on (drizzle wraps the pg error in .cause)
      const code = pgCode(e);
      if (code === '23505') return NextResponse.json({ error: 'ข้อมูลซ้ำกับที่มีอยู่แล้ว' }, { status: 409 });
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
      const ref = (req ? requestId(req) : crypto.randomUUID()).slice(0, 16);
      logError(e, 'unhandled API error', { ref }, req);
      const msg = e instanceof Error ? e.message : String(e);
      const status = /DATABASE_URL/.test(msg) || code === '08006' || code === '57P01' ? 503 : 500;
      return NextResponse.json({ error: `เกิดข้อผิดพลาดในระบบ (รหัสอ้างอิง ${ref})`, ref }, { status });
    }
  });
}

const MAX_JSON_BYTES = 1_000_000;

/**
 * Parse a JSON body or 400 — routes read a body with parseBody (below), which calls this. Content-Type must be application/json: a cross-site
 * <form> or text/plain fetch (no CORS preflight) can't produce it, so it closes
 * the CSRF path that SameSite=Lax leaves to same-site sibling hosts.
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

/* ------------------------------------------------------------------ *
 * Reading a request — ONLY through these, with the schemas its operation declares in
 * src/server/contract (scripts/test-routes-input.mts fails a route that reads input by hand).
 * A part that fails is refused as the operation's `invalid` says: by default the form rules'
 * 400 "กรอกข้อมูลไม่ครบ N ช่อง" + details.fields (assertValid); or a status with the first problem's
 * own message. Call them where the route always read that part: a check's place decides which of
 * 401 / 403 / 400 / 404 a caller sees first.
 * ------------------------------------------------------------------ */
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

/** The small JSON body of the public /track routes: over 8 KB, not JSON or not an object reads as `{}`. */
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

// re-export for convenience in services
export { and };
