import "server-only";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appConfig, appUser } from "@/db/schema";
import { verifySession, SESSION_COOKIE, type SessionUser } from "@/lib/session";
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

export class HttpError extends Error {
  /** `details` is passed through to the JSON body (e.g. 409 conflicts the UI can act on) */
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

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

async function cachedAppUser(email: string): Promise<AppUserRow | null> {
  const key = normEmail(email);
  const hit = userCache.get(key);
  if (hit && Date.now() - hit.at < USER_TTL) return hit.row;
  const row = await findAppUserByEmail(key);
  if (row) userCache.set(key, { at: Date.now(), row }); // a missing row is never cached (first login race)
  else userCache.delete(key);
  return row;
}

/** Resolve a verified session cookie payload to the current user. */
export async function resolveUser(session: SessionUser | null): Promise<CurrentUser | null> {
  if (!session) return null;
  const owner = isOwner(session.email);
  let row: AppUserRow | null = null;
  try {
    row = await cachedAppUser(session.email);
  } catch {
    row = null; // DB unreachable — fall back to the login-time cookie flags below
  }
  if (!row) {
    // No row yet (race right after first login) or DB down: trust the cookie.
    return {
      userId: 0,
      email: session.email,
      name: session.name,
      avatar: session.avatar ?? "",
      userType: owner ? ADMIN_USER_TYPE : session.role && session.role !== PENDING_ROLE ? session.role : null,
      role: owner ? ADMIN_USER_TYPE : session.role || PENDING_ROLE,
      isActive: true,
      isAdmin: owner || session.role === ADMIN_USER_TYPE,
      approved: owner || !!session.approved,
      session,
    };
  }
  const userType = owner ? ADMIN_USER_TYPE : row.userType?.trim() || null;
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
    approved: owner || (!!userType && isActive),
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
  if (!u.approved) throw new HttpError(403, "รอการอนุมัติสิทธิ์การใช้งาน");
  return u;
}

export async function requireCan(
  req: NextRequest,
  module: Module | null,
  action: Action
): Promise<CurrentUser> {
  const u = await requireUser(req);
  if (!(await can(u, module, action))) {
    throw new HttpError(403, `ไม่มีสิทธิ์ ${action} ใน ${module ?? "ส่วนนี้"}`);
  }
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
      const msg = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.error("[api]", msg);
      const status = /DATABASE_URL/.test(msg) ? 503 : 500;
      return NextResponse.json({ error: msg }, { status });
    }
  };
}

/** Parse a JSON body or 400. */
export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

// re-export for convenience in services
export { and };
