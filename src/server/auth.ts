import "server-only";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appConfig, appUser } from "@/db/schema";
import { verifySession, SESSION_COOKIE, type SessionUser } from "@/lib/session";
import { logError, requestId } from "@/lib/log";
import { isOwner, PENDING_ROLE } from "@/lib/access";
import {
  ADMIN_USER_TYPE,
  checkGrant,
  type Action,
  type Grant,
  type GrantMap,
  type Module,
} from "@/lib/modules";

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

import { HttpError } from "./http-error";
export { HttpError };

export const fullName = (first?: string | null, last?: string | null) =>
  [first ?? "", last ?? ""].map((s) => s.trim()).filter(Boolean).join(" ");

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
const userCache = new Map<string, { at: number; row: AppUserRow }>();
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
  if (row) userCache.set(key, { at: Date.now(), row }); // a missing row is never cached (first login race)
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
    logError(e, "auth user lookup failed");
    throw new HttpError(503, "ระบบฐานข้อมูลไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง");
  }
  if (!row) return null;
  // logout (any device) bumps session_version → every older cookie of this user is dead
  if ((row.sessionVersion ?? 0) !== session.sv) return null;
  // owner = bootstrap for a row that has no role yet; a role or disable set by an admin wins
  const userType = row.userType?.trim() || (owner ? ADMIN_USER_TYPE : null);
  const isActive = row.recordStatus === "ACTIVE";
  const isAdmin = userType === ADMIN_USER_TYPE;
  return {
    userId: row.userId,
    email: session.email,
    name: fullName(row.firstName, row.lastName) || session.name,
    avatar: row.avatar || session.avatar || "",
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
const cache = new Map<string, { at: number; grants: GrantMap }>();
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

/* ------------------------------------------------------------------ *
 * Route-handler guards. Throw HttpError; wrap handlers with `handle()`.
 * ------------------------------------------------------------------ */
export async function requireUser(req: NextRequest): Promise<CurrentUser> {
  const u = await userFromRequest(req);
  if (!u) throw new HttpError(401, "unauthorized");
  if (!u.approved) throw new HttpError(403, u.userType && !u.isActive ? "บัญชีนี้ถูกปิดการใช้งาน" : "รอการอนุมัติสิทธิ์การใช้งาน");
  return u;
}

export async function requireCan(
  req: NextRequest,
  module: Module | null,
  action: Action
): Promise<CurrentUser> {
  const u = await requireUser(req);
  if (!(await can(u, module, action))) {
    throw new HttpError(403, `ไม่มีสิทธิ์${ACTION_TH[action]}ใน ${module ?? "ส่วนนี้"}`);
  }
  return u;
}
/** the action in the 403 message — the module keeps its permission-screen name */
const ACTION_TH: Record<Action, string> = { add: "เพิ่ม", edit: "แก้ไข", del: "ลบ", view: "ดู" };

/** Every job screen — a job (and its calls/attachments) is readable from any of them. */
export const JOB_MODULES: readonly Module[] = ["Job Management", "Job Assign", "Job Repair", "Job Closing"];

/** True when the user may view at least one of `modules` (screens that legitimately read the data). */
export async function canViewAny(user: CurrentUser, modules: readonly Module[]) {
  if (user.isAdmin) return true;
  const grants = await grantsForUserType(user.userType);
  return modules.some((m) => checkGrant(false, grants, m, "view"));
}

/** Read guard: signed in + approved + "view" on any one of `modules`. */
export async function requireView(req: NextRequest, modules: readonly Module[]): Promise<CurrentUser> {
  const u = await requireUser(req);
  if (!(await canViewAny(u, modules))) throw new HttpError(403, "ไม่มีสิทธิ์ดูข้อมูลส่วนนี้");
  return u;
}

export async function requireAdmin(req: NextRequest): Promise<CurrentUser> {
  const u = await requireUser(req);
  if (!u.isAdmin) throw new HttpError(403, "เฉพาะ System Admin");
  return u;
}

/** Uniform JSON error handling for route handlers. */
export function handle<T extends unknown[]>(
  fn: (...args: T) => Promise<Response>
): (...args: T) => Promise<Response> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json(e.details === undefined ? { error: e.message } : { error: e.message, details: e.details }, { status: e.status });
      }
      // Postgres errors the user can act on (drizzle wraps the pg error in .cause)
      const code = pgCode(e);
      if (code === "23505") return NextResponse.json({ error: "ข้อมูลซ้ำกับที่มีอยู่แล้ว" }, { status: 409 });
      if (code === "57014") return NextResponse.json({ error: "ใช้เวลานานเกินไป ลองจำกัดช่วงข้อมูลให้แคบลง" }, { status: 503 });
      if (code === "40P01" || code === "40001") return NextResponse.json({ error: "มีผู้ใช้อื่นบันทึกข้อมูลเดียวกันพร้อมกัน กรุณาลองใหม่อีกครั้ง" }, { status: 409 });
      // unexpected error: the details (SQL, stack — parameters scrubbed) stay in the server log;
      // the browser only gets a reference to quote when reporting it (= Cloudflare ray id when present)
      const req = args[0] instanceof Request ? args[0] : undefined;
      const ref = (req ? requestId(req) : crypto.randomUUID()).slice(0, 16);
      logError(e, "unhandled API error", { ref }, req);
      const msg = e instanceof Error ? e.message : String(e);
      const status = /DATABASE_URL/.test(msg) || code === "08006" || code === "57P01" ? 503 : 500;
      return NextResponse.json({ error: `เกิดข้อผิดพลาดในระบบ (รหัสอ้างอิง ${ref})`, ref }, { status });
    }
  };
}

const MAX_JSON_BYTES = 1_000_000;

/**
 * Parse a JSON body or 400. Content-Type must be application/json: a cross-site
 * <form> or text/plain fetch (no CORS preflight) can't produce it, so it closes
 * the CSRF path that SameSite=Lax leaves to same-site sibling hosts.
 */
export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) throw new HttpError(415, "ต้องส่งข้อมูลเป็น JSON");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_JSON_BYTES) throw new HttpError(413, "ข้อมูลใหญ่เกินไป");
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw new HttpError(413, "ข้อมูลใหญ่เกินไป"); // bytes — Thai is 3 per char
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

/** SQLSTATE of a Postgres error, also when drizzle wraps it (DrizzleQueryError.cause). */
function pgCode(e: unknown): string | undefined {
  for (let x: unknown = e, i = 0; x && i < 3; x = (x as { cause?: unknown }).cause, i++) {
    const c = (x as { code?: unknown }).code;
    if (typeof c === "string" && /^[0-9A-Z]{5}$/.test(c)) return c;
  }
  return undefined;
}

// re-export for convenience in services
export { and };
