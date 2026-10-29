import 'server-only';
import { audit, diff, type AuditEntry } from '@/server/audit';
import { cached, invalidate, TTL_MASTER } from '@/server/cache';
import { and, asc, eq, ne, or, sql, type AnyColumn } from 'drizzle-orm';
import { db, type Tx } from '@/db/client';
import { appConfig, appUser } from '@/db/schema';
import { isOwner, PENDING_ROLE } from '@/lib/access';
import { ADMIN_USER_TYPE } from '@/lib/modules';
import {
  findAppUserByEmail,
  fullName,
  HttpError,
  invalidateGrantCache,
  invalidateUserCache,
  rolesWithRight,
} from '@/server/auth';
import type { User, Permission } from '@/data/types';
import { nowThai, fmtDateTime } from '@/server/mappers/format';
import { clean } from '@/lib/validation';
import { masterNameKey } from '@/lib/validation/admin';
import {
  RS,
  statusFilter,
  uiStatus,
  fromUiStatus,
  statusStamp,
  type RecordStatus,
  type StatusMode,
} from '@/server/record-status';

/** After any app_user write: the staff dropdown and the per-request user lookup must see it now. */
function userChanged(email?: string | null) {
  invalidate('staff');
  invalidateUserCache(email ?? undefined);
}

function splitName(name: string): { first: string; last: string } {
  const [head, ...rest] = name.trim().split(/\s+/).filter(Boolean);
  if (head === undefined) return { first: '', last: '' };
  return { first: head.slice(0, 50), last: rest.join(' ').slice(0, 50) };
}

export type SsoProfile = {
  email: string;
  name: string;
  avatar: string;
  larkId: string;
  department: string;
  phone: string;
  title: string;
};

/**
 * Called from the SSO callback. Finds the app_user by email (creating a pending
 * one when unknown), refreshes the SSO profile columns + last_login (an ACTIVE row only — a disabled
 * account's refused sign-in is no visit; a pending one does sign in, to the waiting page), forces
 * owners to System Admin, and returns the effective role/state.
 */
export async function provisionSsoUser(
  p: SsoProfile,
  retried = false,
): Promise<{
  userId: number;
  userType: string | null;
  isActive: boolean;
  recordStatus: string | null;
  /** app_user.session_version — stamped into the session cookie (drizzle/0015) */
  sessionVersion: number;
}> {
  const email = p.email.trim().toLowerCase();
  const owner = isOwner(email);
  const { first, last } = splitName(p.name || (email.split('@')[0] ?? email));
  const profile = {
    larkId: p.larkId || null,
    department: p.department || null,
    title: p.title || null,
    avatar: p.avatar || null,
    lastLogin: nowThai(),
  };

  // one UPDATE that decides on the row as committed: a sign-in landing on an admin's role / name change waits for
  // its row lock and re-reads, it never writes back values it read before (no read-then-write)
  const blank = (c: AnyColumn) => sql`btrim(coalesce(${c}, '')) = ''`;
  const keepOr = (c: AnyColumn, v: string | null) => sql`CASE WHEN ${blank(c)} THEN ${v} ELSE ${c} END`;
  const [existing] = await db
    .update(appUser)
    .set({
      // keep the legacy name if one exists; fill blanks from SSO
      firstName: keepOr(appUser.firstName, first),
      lastName: keepOr(appUser.lastName, last),
      phoneNo: keepOr(appUser.phoneNo, p.phone.slice(0, 50) || null),
      // owner = bootstrap only: a row with no role yet becomes System Admin; a role or a
      // disable an admin set later sticks
      userType: sql`coalesce(nullif(btrim(${appUser.userType}), ''), ${owner ? ADMIN_USER_TYPE : null})`,
      // only overwrite profile fields we actually received (undefined = left as stored)
      larkId: profile.larkId ?? undefined,
      department: profile.department ?? undefined,
      title: profile.title ?? undefined,
      avatar: profile.avatar ?? undefined,
      lastLogin: sql`CASE WHEN ${appUser.recordStatus} = ${RS.ACTIVE} THEN ${profile.lastLogin}::timestamp ELSE ${appUser.lastLogin} END`,
    })
    .where(sql`lower(trim(${appUser.emailAddress})) = ${email}`)
    .returning({
      userId: appUser.userId,
      userType: appUser.userType,
      recordStatus: appUser.recordStatus,
      sessionVersion: appUser.sessionVersion,
    });
  if (existing)
    return {
      userId: existing.userId,
      userType: existing.userType,
      isActive: existing.recordStatus === RS.ACTIVE,
      recordStatus: existing.recordStatus,
      sessionVersion: existing.sessionVersion ?? 0,
    };

  const insert = (username: string) =>
    db
      .insert(appUser)
      .values({
        username,
        password: '',
        firstName: first,
        lastName: last,
        userType: owner ? ADMIN_USER_TYPE : null,
        isActive: true,
        recordStatus: RS.ACTIVE,
        phoneNo: p.phone.slice(0, 50) || null,
        emailAddress: email,
        ...profile,
      })
      .returning({ userId: appUser.userId, sessionVersion: appUser.sessionVersion });
  const local = (email.split('@')[0] ?? email).slice(0, 50);
  let row: { userId: number; sessionVersion: number | null } | undefined;
  try {
    [row] = await insert(local).catch((e) => {
      // legacy unique (username, password): somchai@a and somchai@b share the local part
      if (pgConstraint(e) === 'ix_username_and_password')
        return insert(`${local.slice(0, 44)}.${crypto.randomUUID().slice(0, 4)}`);
      throw e;
    });
  } catch (e) {
    // a second tab finished the first sign-in a moment ago (its username clash comes first) → that row is ours
    if (pgConstraint(e) === 'ux_app_user_email' && !retried) return provisionSsoUser(p, true);
    throw e;
  }
  if (!row) throw new Error('app_user insert returned no row');
  userChanged(email);
  return {
    userId: row.userId,
    userType: owner ? ADMIN_USER_TYPE : null,
    isActive: true,
    recordStatus: RS.ACTIVE,
    sessionVersion: row.sessionVersion ?? 0,
  };
}

/** A sign-in's audit line: let in — or pending, to the waiting page — = LOGIN with the role (or รออนุมัติ); refused
 *  (Inactive / deleted: turned away to /pending) = LOGIN_FAILED with the reason, never the role as if granted. */
export function signInAuditLine(
  email: string,
  role: string,
  recordStatus: string | null,
): Pick<AuditEntry, 'action' | 'summary'> {
  if (recordStatus === RS.ACTIVE) return { action: 'LOGIN', summary: `เข้าสู่ระบบ ${email} · ${role}` };
  const reason = recordStatus === RS.DELETED ? 'บัญชีถูกลบ' : 'บัญชีถูกปิดการใช้งาน';
  return { action: 'LOGIN_FAILED', summary: `เข้าสู่ระบบไม่สำเร็จ ${email} — ${reason}` };
}

/** Name of the violated constraint of a Postgres unique error (drizzle wraps it in .cause). */
function pgConstraint(e: unknown): string | undefined {
  for (let x: unknown = e, i = 0; x && i < 3; x = (x as { cause?: unknown }).cause, i++) {
    const c = x as { code?: unknown; constraint?: unknown };
    if (c.code === '23505' && typeof c.constraint === 'string') return c.constraint;
  }
  return undefined;
}

/**
 * Why provisionSsoUser failed, for the sign-in error page: a unique clash on app_user that the
 * retries above could not settle (a legacy row, an id sequence behind the data) is not an outage —
 * retrying will not help, an admin has to look → user_conflict. Anything else → db_unavailable.
 */
export function provisionFailure(e: unknown): { reason: 'user_conflict' | 'db_unavailable'; constraint?: string } {
  const constraint = pgConstraint(e);
  return constraint ? { reason: 'user_conflict', constraint } : { reason: 'db_unavailable' };
}

/* ------------------------------------------------------------------ *
 * Mapping app_user → the UI's `User` type
 * ------------------------------------------------------------------ */
type AppUserRow = typeof appUser.$inferSelect;

export function toUser(r: AppUserRow): User {
  return {
    id: String(r.userId),
    code: r.larkId ?? '',
    name: fullName(r.firstName, r.lastName) || r.username || '',
    username: r.username ?? '',
    role: r.userType?.trim() || PENDING_ROLE,
    branch: r.department ?? '',
    email: r.emailAddress?.trim() ?? '',
    phone: r.phoneNo ?? '',
    lastLogin: fmtDateTime(r.lastLogin),
    status: uiStatus(r.recordStatus),
    avatar: r.avatar ?? null,
    title: r.title ?? null,
  };
}

export type DeletedMode = StatusMode;

/**
 * "ผู้ใช้ระบบ" = every app_user row (legacy staff + SSO-provisioned people).
 * Admins manage roles here directly — a person does not need to have logged in
 * first; when they later sign in through SSO they are matched by email and get
 * the role already assigned.
 */
export async function listSystemUsers(deleted: DeletedMode = 'exclude'): Promise<User[]> {
  const rows = await db.select().from(appUser).where(statusFilter(appUser.recordStatus, deleted));
  // Default order (the table can still be re-sorted by column):
  //   1. waiting for approval — newest request first (this is the admin's to-do)
  //   2. active users, by name (the page is used to look people up)
  //   3. inactive / deleted, by name, at the bottom
  const group = (r: AppUserRow) => (!r.userType?.trim() ? 0 : r.recordStatus === RS.ACTIVE ? 1 : 2);
  const name = (r: AppUserRow) => fullName(r.firstName, r.lastName) || r.username || '';
  rows.sort((a, b) => {
    const g = group(a) - group(b);
    if (g) return g;
    if (group(a) === 0) return b.userId - a.userId;
    return name(a).localeCompare(name(b), 'th') || a.userId - b.userId;
  });
  return rows.map(toUser);
}

/**
 * A person picked from the staff list (ส่งโดย / รับโดย, พนักงานขาย, ช่าง): an active app_user, or the
 * person already on the row (who may have left since — keeping them is never an error). Anything
 * else is a 400 under `field`. Left out (undefined) → `fallback`.
 */
export async function staffOrKeep(
  id: number | undefined,
  current: number | null | undefined,
  field: string,
  fallback: number,
  message = 'ไม่พบพนักงานคนนี้ในรายชื่อปัจจุบัน',
): Promise<number> {
  if (id === undefined) return fallback;
  if (id === current) return id;
  const [u] = await db
    .select({ id: appUser.userId })
    .from(appUser)
    .where(and(eq(appUser.userId, id), eq(appUser.recordStatus, RS.ACTIVE)))
    .limit(1);
  if (!u) throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง 1 ช่อง', { fields: { [field]: message } });
  return id;
}

/**
 * Everyone active — for technician / opener / salesperson dropdowns. `usedAs` (report filters)
 * adds the people who have left but are still on jobs (engineer) / sale orders (sales), labelled
 * "(ไม่ใช้งานแล้ว)", so old periods can still be filtered by them.
 */
type StaffRow = { id: number; name: string; userType: string; takesJobs: boolean; sells: boolean };
/** `takesJobs`: the role has Job Take — offered in มอบหมายงานนี้ให้; `sells`: the role adds sale orders (or is System
 *  Admin) — offered as พนักงานขาย (the cache is dropped when permissions are saved) */
export function listStaff(usedAs?: 'engineer' | 'sales'): Promise<StaffRow[]> {
  return cached(usedAs ? `staff:${usedAs}` : 'staff', TTL_MASTER, () => loadStaff(usedAs));
}
async function loadStaff(usedAs?: 'engineer' | 'sales'): Promise<StaffRow[]> {
  const used =
    usedAs === 'engineer'
      ? sql`${appUser.userId} IN (SELECT engineer_id FROM job)`
      : usedAs === 'sales'
        ? sql`${appUser.userId} IN (SELECT sale_out_by FROM sale_out_hd)`
        : undefined;
  const rows = await db
    .select({
      id: appUser.userId,
      first: appUser.firstName,
      last: appUser.lastName,
      username: appUser.username,
      userType: appUser.userType,
      status: appUser.recordStatus,
    })
    .from(appUser)
    .where(or(eq(appUser.recordStatus, RS.ACTIVE), used))
    .orderBy(asc(appUser.firstName), asc(appUser.lastName));
  const [takers, sellers] = await Promise.all([
    rolesWithRight('Job Take').then((r) => new Set(r)),
    db
      .select({ t: appConfig.userType })
      .from(appConfig)
      .where(and(eq(appConfig.moduleName, 'Sale Order'), eq(appConfig.canInsert, true)))
      .then((r) => new Set(r.map((x) => x.t?.trim()))),
  ]);
  return rows.map((r) => ({
    id: r.id,
    name: (fullName(r.first, r.last) || r.username || `#${r.id}`) + (r.status === RS.ACTIVE ? '' : ' (ไม่ใช้งานแล้ว)'),
    userType: r.userType?.trim() ?? '',
    takesJobs: takers.has(r.userType?.trim() ?? ''),
    sells: r.userType?.trim() === ADMIN_USER_TYPE || sellers.has(r.userType?.trim()),
  }));
}

export type UpsertUserInput = {
  id?: string;
  /** name / role / status left out on an edit = kept as stored (the row's quick actions send only what they change) */
  name?: string;
  role?: string;
  email?: string;
  username?: string;
  code?: string;
  branch?: string;
  phone?: string;
  status?: string;
  avatar?: string;
  title?: string;
  /** what the form loaded: a value another admin changed since → 409 stale, nothing written */
  expect?: { name?: string | null; email?: string | null; role?: string | null; status?: string | null } | null;
};

/** the stored username / phone of the user being edited — userSchema lets unchanged legacy values pass —
 *  and the name / role an edit that leaves them out keeps */
export async function userPrev(
  id: unknown,
): Promise<{ username: string | null; phone: string | null; name: string; role: string } | null> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const [row] = await db.select().from(appUser).where(eq(appUser.userId, n)).limit(1);
  if (!row) return null;
  const u = toUser(row);
  return { username: row.username, phone: row.phoneNo, name: u.name, role: u.role };
}

/** 409 stale: a value the form loaded no longer matches the stored user — another admin saved meanwhile */
function assertLoaded(row: AppUserRow, expect: UpsertUserInput['expect']) {
  if (!expect) return;
  const now = toUser(row);
  if (
    (['name', 'email', 'role', 'status'] as const).some((k) => expect[k] != null && clean(expect[k]) !== clean(now[k]))
  )
    throw new HttpError(409, 'ผู้ดูแลระบบคนอื่นเพิ่งแก้ผู้ใช้นี้ — โหลดรายการใหม่แล้วทำอีกครั้ง', { stale: true });
}

/** An admin cannot lock themselves out: their own account is never disabled, deleted, given another role,
 *  or another email / username (sign-in finds the account by email). */
export function refuseSelf(
  userId: number,
  actorId: number,
  msg = 'เปลี่ยนบทบาท ถอนสิทธิ์ หรือลบบัญชีของตัวเองไม่ได้ — ให้ผู้ดูแลระบบคนอื่นทำแทน',
) {
  if (userId === actorId) throw new HttpError(409, msg);
}

/** a deleted user comes back only through กู้คืน (setUserDeleted → INACTIVE), never straight to Active */
export const DELETED_USER_MSG = 'ผู้ใช้นี้ถูกลบ — กู้คืนก่อน';

/** Admin create/update from the "ผู้ใช้ระบบ" page. Role = legacy user_type. */
export async function upsertUser(input: UpsertUserInput, actorId = 0): Promise<{ user: User; created: boolean }> {
  const targetId = input.id ? Number(input.id) : NaN;
  const [before] = Number.isFinite(targetId) ? await db.select().from(appUser).where(eq(appUser.userId, targetId)) : [];
  if (Number.isFinite(targetId) && !before) throw new HttpError(404, 'user not found');

  const email = clean(input.email).toLowerCase();
  const role = clean(input.role);
  // left out on an edit → as stored (a stale tab's ถอนสิทธิ์ must not write back the role it loaded)
  const userType =
    input.role === undefined && before ? before.userType?.trim() || null : role === PENDING_ROLE ? null : role || null;
  const rs = input.status === undefined && before ? (before.recordStatus as RecordStatus) : fromUiStatus(input.status);
  const name =
    input.name === undefined && before
      ? clean(fullName(before.firstName, before.lastName) || before.username)
      : clean(input.name);
  const { first, last } = splitName(name);
  const username = clean(input.username);
  const phone = clean(input.phone).replace(/[\s-]/g, '');
  if (before && (rs !== RS.ACTIVE || userType !== (before.userType?.trim() || null)))
    refuseSelf(before.userId, actorId);
  // (an empty email / username keeps the stored one — see userValues)
  const same = (a: string, b: string | null) => a.toLowerCase() === clean(b).toLowerCase();
  if (before && ((email && !same(email, before.emailAddress)) || (username && !same(username, before.username))))
    refuseSelf(before.userId, actorId, 'เปลี่ยนอีเมลหรือ Username ของตัวเองไม่ได้ — ให้ผู้ดูแลระบบคนอื่นทำแทน');
  // a stale tab's คืนสิทธิ์ / แก้ไข on a user deleted meanwhile must not set it straight back to ACTIVE
  if (before?.recordStatus === RS.DELETED) throw new HttpError(409, DELETED_USER_MSG);
  // the page sends the full name it shows: unchanged → first / last stay as stored (splitName would move the
  // 2nd word of a two-word first name into last_name and log a fake audit change)
  const keepName = !!before && name === clean(fullName(before.firstName, before.lastName) || before.username);

  // "รออนุมัติ" (no role) is where a sign-up starts, never a role to give: only a user still pending keeps it
  if (!userType && (!before || before.userType?.trim()))
    throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง 1 ช่อง', {
      fields: { role: 'เลือกบทบาท — "รออนุมัติ" ใช้กับบัญชีที่สมัครเข้ามาและยังไม่ได้อนุมัติเท่านั้น' },
    });
  /** under this save's tx: a role being deleted (deleteRole / savePermissions lock the same key) or a username another
   *  admin is creating at the same instant is checked after their commit, never between our check and our write */
  async function checkLocked(tx: Tx) {
    const newUsername = !!username && username.toLowerCase() !== clean(before?.username).toLowerCase();
    if (newUsername)
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`app_user:username:${username.toLowerCase()}`}))`);
    // the role must be one of the roles (or the one the user already has); System Admin has no app_config rows
    if (userType && userType !== before?.userType?.trim() && userType !== ADMIN_USER_TYPE) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`app_config:${masterNameKey(userType)}`}))`);
      const [exists] = await tx
        .select({ t: appConfig.userType })
        .from(appConfig)
        .where(sql`btrim(${appConfig.userType}) = ${userType}`)
        .limit(1);
      if (!exists)
        throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง 1 ช่อง', { fields: { role: 'ไม่พบประเภทผู้ใช้งานนี้ในรายการ' } });
    }
    // email / username belong to one user: a new user with someone's email must not silently UPDATE that user
    const clash: Record<string, string> = {};
    if (email) {
      const other = await findAppUserByEmail(email, tx);
      if (other && other.userId !== before?.userId)
        clash.email = `อีเมลนี้เป็นของผู้ใช้ ${fullName(other.firstName, other.lastName) || other.username || `#${other.userId}`} แล้ว — แก้ไขจากรายการแทน`;
    }
    if (newUsername) {
      const [other] = await tx
        .select({ id: appUser.userId, first: appUser.firstName, last: appUser.lastName })
        .from(appUser)
        .where(
          and(
            sql`lower(btrim(${appUser.username})) = ${username.toLowerCase()}`,
            ne(appUser.userId, before?.userId ?? -1),
          ),
        )
        .limit(1);
      if (other) clash.username = `Username นี้เป็นของ ${fullName(other.first, other.last) || `#${other.id}`} แล้ว`;
    }
    const [firstClash] = Object.values(clash);
    if (firstClash) throw new HttpError(409, firstClash, { fields: clash });
  }

  if (before) {
    const userValues = {
      firstName: keepName ? undefined : first,
      lastName: keepName ? undefined : last,
      userType: input.role === undefined ? undefined : userType,
      deleted: false,
      emailAddress: email || undefined,
      // optional contact fields: sent empty = cleared; not sent at all = left as stored
      phoneNo: input.phone === undefined ? undefined : phone || null,
      larkId: input.code === undefined ? undefined : clean(input.code) || null,
      department: input.branch === undefined ? undefined : clean(input.branch) || null,
      title: input.title || undefined,
      avatar: input.avatar || undefined,
      username: username || undefined,
    };
    const row = await db.transaction(async (tx) => {
      await checkLocked(tx);
      // compared under the row lock: two admins saving at once are serialized, the second sees the first
      const [locked] = await tx.select().from(appUser).where(eq(appUser.userId, targetId)).for('update');
      if (!locked) throw new HttpError(404, 'user not found');
      assertLoaded(locked, input.expect);
      // stamped only when the status really changes: saving an Active user as Active keeps who / when it last changed
      const values = {
        ...userValues,
        ...(input.status === undefined || rs === locked.recordStatus ? {} : statusStamp(rs, actorId)),
      };
      const [row] = await tx.update(appUser).set(values).where(eq(appUser.userId, targetId)).returning();
      if (!row) throw new HttpError(404, 'user not found');
      // recordStatus stays in the diff: disable / re-enable is what an audit must show
      const changes = diff(locked as Record<string, unknown>, values as Record<string, unknown>, {
        skip: ['deleted', 'isActive'],
      });
      // saved with nothing changed (e.g. opening your own account and pressing บันทึก) → no audit line
      if (changes)
        await audit(tx, actorId, {
          ...userAuditLine(
            fullName(first, last),
            { userType: locked.userType?.trim() || null, rs: locked.recordStatus },
            { userType, rs },
          ),
          module: 'Admin',
          entity: 'app_user',
          key: targetId,
          changes,
        });
      return row;
    });
    userChanged(row.emailAddress);
    return { user: toUser(row), created: false };
  }

  const row = await db.transaction(async (tx) => {
    await checkLocked(tx);
    const [row] = await tx
      .insert(appUser)
      .values({
        username: (username || (email ? email.split('@')[0] : first) || 'user').slice(0, 50),
        password: '',
        firstName: first,
        lastName: last,
        userType,
        ...statusStamp(rs, actorId),
        emailAddress: email || null,
        phoneNo: phone || null,
        larkId: clean(input.code) || null,
        department: clean(input.branch) || null,
        title: input.title || null,
        avatar: input.avatar || null,
      })
      .returning();
    if (!row) throw new Error('app_user insert returned no row');
    await audit(tx, actorId, {
      action: 'CREATE',
      module: 'Admin',
      entity: 'app_user',
      key: row.userId,
      summary: `เพิ่มผู้ใช้ ${fullName(first, last)} · ${email || '-'} · สิทธิ์ ${userType ?? PENDING_ROLE}`,
    });
    return row;
  });
  userChanged(row.emailAddress);
  return { user: toUser(row), created: true };
}

/**
 * The audit line of a user edit, by what it did — the users page's อนุมัติ / ถอนสิทธิ์ / คืนสิทธิ์
 * all save through upsertUser, so the line is told apart here instead of a generic "แก้ไขผู้ใช้ …".
 */
export function userAuditLine(
  name: string,
  before: { userType: string | null; rs: string | null },
  after: { userType: string | null; rs: string },
): { action: 'APPROVE' | 'STATUS' | 'UPDATE'; summary: string } {
  const role = after.userType ?? PENDING_ROLE;
  if (!before.userType && after.userType) return { action: 'APPROVE', summary: `อนุมัติผู้ใช้ ${name} → ${role}` };
  if (before.rs === RS.ACTIVE && after.rs !== RS.ACTIVE)
    return { action: 'STATUS', summary: `ถอนสิทธิ์ผู้ใช้ ${name} (${role})` };
  if (before.rs !== RS.ACTIVE && after.rs === RS.ACTIVE)
    return { action: 'STATUS', summary: `คืนสิทธิ์ผู้ใช้ ${name} (${role})` };
  if (before.userType !== after.userType)
    return { action: 'UPDATE', summary: `เปลี่ยนสิทธิ์ผู้ใช้ ${name}: ${before.userType ?? PENDING_ROLE} → ${role}` };
  return { action: 'UPDATE', summary: `แก้ไขข้อมูลผู้ใช้ ${name} · สิทธิ์ ${role}` };
}

/**
 * ลบ / กู้คืน. A restored user comes back INACTIVE: restoring must never re-open an account whose access
 * was revoked before it was deleted — the admin gives access back with คืนสิทธิ์ (upsertUser, audited).
 */
export async function setUserDeleted(userId: number, deleted: boolean, actorId = 0) {
  if (deleted) refuseSelf(userId, actorId);
  await db.transaction(async (tx) => {
    const [old] = await tx
      .select({ rs: appUser.recordStatus, first: appUser.firstName, last: appUser.lastName })
      .from(appUser)
      .where(eq(appUser.userId, userId))
      .for('update');
    if (!old) throw new HttpError(404, 'user not found');
    // only a deleted user is restored — "restore" on a live account would have switched it off
    if (!deleted && old.rs !== RS.DELETED)
      throw new HttpError(409, 'ผู้ใช้นี้ไม่ได้อยู่ในรายการที่ลบ — เปิดใช้งานด้วยปุ่ม คืนสิทธิ์');
    const who = fullName(old.first, old.last) || `#${userId}`;
    const rs = deleted ? RS.DELETED : RS.INACTIVE;
    await tx
      .update(appUser)
      .set({ ...statusStamp(rs, actorId), deleted })
      .where(eq(appUser.userId, userId));
    await audit(tx, actorId, {
      action: deleted ? 'DELETE' : 'STATUS',
      module: 'Admin',
      entity: 'app_user',
      key: userId,
      summary: deleted ? `ลบผู้ใช้ ${who}` : `กู้คืนผู้ใช้ ${who} (ยังปิดการใช้งาน)`,
      changes: { recordStatus: [old.rs, rs] },
    });
  });
  userChanged();
}

/* ------------------------------------------------------------------ *
 * Permissions (app_config) — role list, matrix, save
 * ------------------------------------------------------------------ */
export function listRoles(): Promise<string[]> {
  return cached('roles', TTL_MASTER, loadRoles);
}
async function loadRoles(): Promise<string[]> {
  const rows = await db.selectDistinct({ t: appConfig.userType }).from(appConfig).orderBy(asc(appConfig.userType));
  const set = new Set<string>([ADMIN_USER_TYPE]);
  for (const r of rows) if (r.t?.trim()) set.add(r.t.trim());
  return Array.from(set);
}

export function listModules(): Promise<string[]> {
  return cached('modules', TTL_MASTER, loadModules);
}
async function loadModules(): Promise<string[]> {
  const rows = await db.selectDistinct({ m: appConfig.moduleName }).from(appConfig).orderBy(asc(appConfig.moduleName));
  return rows.map((r) => r.m?.trim()).filter((m): m is string => !!m);
}

export async function listPermissions(): Promise<Permission[]> {
  const rows = await db.select().from(appConfig).orderBy(asc(appConfig.userType), asc(appConfig.moduleName));
  return rows.map((r) => ({
    id: String(r.configId),
    role: r.userType?.trim() ?? '',
    menu: r.moduleName?.trim() ?? '',
    add: !!r.canInsert,
    edit: !!r.canEdit,
    del: !!r.canDelete,
    view: !!r.canView,
  }));
}

type Grants = { add: boolean; edit: boolean; del: boolean; view: boolean };
/** V A E D of a grant row — the audit's and the 409's notation */
const pack = (g: Grants | undefined) =>
  g ? `${g.view ? 'V' : '-'}${g.add ? 'A' : '-'}${g.edit ? 'E' : '-'}${g.del ? 'D' : '-'}` : null;

/**
 * The permissions page's save: one item per (role, menu) the admin changed. `was` = the row as the page loaded it:
 * the save is a compare-and-set under a lock on the role — a row another admin changed since (stored ≠ `was`, and
 * not already what this save sets) → 409 naming those menus, nothing written. Without `was` the row is set as sent.
 * Audited per role, only rows that really change, under the admin who changed them.
 */
export async function savePermissions(
  items: (Grants & { role: string; menu: string; was?: Grants | null })[],
  actorId = 0,
): Promise<number> {
  await db.transaction(async (tx) => {
    // locked by the name as masterNameKey sees it: "QA X" and "qa x" created at the same instant queue here
    for (const key of [...new Set(items.map((it) => masterNameKey(it.role)))].sort())
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`app_config:${key}`}))`);
    const beforeRows = await tx.select().from(appConfig);
    // a new role that is an existing one in other case / spacing → refused, not a second role
    const roles = new Set(beforeRows.map((r) => r.userType?.trim() ?? ''));
    for (const it of items) {
      const twin = roles.has(it.role) ? null : [...roles].find((r) => masterNameKey(r) === masterNameKey(it.role));
      if (twin) throw new HttpError(409, `มีตำแหน่ง "${twin}" อยู่แล้ว — ชื่อต่างกันแค่ตัวพิมพ์เล็ก/ใหญ่หรือช่องว่าง`);
    }
    const beforeMap = new Map(
      beforeRows.map((r) => [
        `${r.userType?.trim()}::${r.moduleName?.trim()}`,
        { add: !!r.canInsert, edit: !!r.canEdit, del: !!r.canDelete, view: !!r.canView },
      ]),
    );
    const off: Grants = { add: false, edit: false, del: false, view: false };
    const stale = items.filter((it) => {
      const now = pack(beforeMap.get(`${it.role}::${it.menu}`) ?? off);
      return it.was && now !== pack(it.was) && now !== pack(it);
    });
    if (stale.length)
      throw new HttpError(
        409,
        `ผู้ดูแลระบบคนอื่นเพิ่งแก้สิทธิ์ ${stale.map((it) => `${it.role} · ${it.menu}`).join(', ')} — โหลดใหม่แล้วติ๊กอีกครั้ง`,
        { stale: true },
      );
    /** role → menu → [was, now]: one audit entry per role, keyed by that role */
    const changed = new Map<string, Record<string, [unknown, unknown]>>();
    // one upsert on ix_user_type_and_module_name (unique (user_type, module_name)) instead of a
    // SELECT + UPDATE/INSERT per row; a pair sent twice keeps its last value
    const rows = new Map(items.map((it) => [`${it.role}::${it.menu}`, it]));
    for (const [key, it] of rows) {
      const was = pack(beforeMap.get(key));
      if (was === pack(it)) continue;
      const menus = changed.get(it.role) ?? {};
      menus[it.menu] = [was, pack(it)];
      changed.set(it.role, menus);
    }
    if (rows.size) {
      await tx
        .insert(appConfig)
        .values(
          [...rows.values()].map((it) => ({
            userType: it.role,
            moduleName: it.menu,
            canInsert: it.add,
            canEdit: it.edit,
            canDelete: it.del,
            canView: it.view,
          })),
        )
        .onConflictDoUpdate({
          target: [appConfig.userType, appConfig.moduleName],
          set: {
            canInsert: sql`excluded.can_insert`,
            canEdit: sql`excluded.can_edit`,
            canDelete: sql`excluded.can_delete`,
            canView: sql`excluded.can_view`,
          },
        });
    }
    for (const [role, menus] of changed) {
      await audit(tx, actorId, {
        action: 'UPDATE',
        module: 'Admin',
        entity: 'app_config',
        key: role,
        summary: `แก้สิทธิ์บทบาท ${role} · ${Object.keys(menus).length} เมนู (V=ดู A=เพิ่ม E=แก้ D=ลบ)`,
        changes: menus,
      });
    }
  });
  permissionsChanged();
  return items.length;
}

function permissionsChanged() {
  invalidateGrantCache();
  invalidate('roles');
  invalidate('modules');
  invalidate('staff'); // takesJobs follows Job Take, sells Sale Order add
}

/** ลบตำแหน่ง: its app_config rows go; refused while a (not deleted) user still has the role, and for System Admin */
export async function deleteRole(role: string, actorId = 0): Promise<number> {
  if (role === ADMIN_USER_TYPE) throw new HttpError(409, 'ลบตำแหน่ง System Admin ไม่ได้');
  const n = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`app_config:${masterNameKey(role)}`}))`);
    const [held] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(appUser)
      .where(and(sql`btrim(${appUser.userType}) = ${role}`, ne(appUser.recordStatus, RS.DELETED)));
    if (held?.n)
      throw new HttpError(409, `ยังมีผู้ใช้ ${held.n} คนในตำแหน่ง ${role} — เปลี่ยนตำแหน่งของผู้ใช้เหล่านั้นก่อน`);
    const gone = await tx
      .delete(appConfig)
      .where(sql`btrim(${appConfig.userType}) = ${role}`)
      .returning({ menu: appConfig.moduleName });
    if (gone.length)
      await audit(tx, actorId, {
        action: 'DELETE',
        module: 'Admin',
        entity: 'app_config',
        key: role,
        summary: `ลบตำแหน่ง ${role} (${gone.length} แถวสิทธิ์)`,
      });
    return gone.length;
  });
  permissionsChanged();
  return n;
}
