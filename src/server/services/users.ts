import { audit, diff } from '@/server/audit';
import 'server-only';
import { cached, invalidate, TTL_MASTER } from '@/server/cache';
import { and, asc, desc, eq, ne, or, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { appConfig, appUser } from '@/db/schema';
import { isOwner, PENDING_ROLE } from '@/lib/access';
import { ADMIN_USER_TYPE } from '@/lib/modules';
import { findAppUserByEmail, fullName, HttpError, invalidateGrantCache, invalidateUserCache } from '@/server/auth';

/** After any app_user write: the staff dropdown and the per-request user lookup must see it now. */
function userChanged(email?: string | null) {
  invalidate('staff');
  invalidateUserCache(email ?? undefined);
}
import type { User, Permission } from '@/data/mock';
import { nowThai, fmtDateTime } from '@/server/mappers/format';
import { clean } from '@/lib/validation';
import { RS, statusFilter, uiStatus, fromUiStatus, statusStamp, type StatusMode } from '@/server/record-status';

const DEFAULT_APPROVED_TYPE = 'Customer Service';

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
 * one when unknown), refreshes the SSO profile columns + last_login, forces
 * owners to System Admin, and returns the effective role/state.
 */
export async function provisionSsoUser(
  p: SsoProfile,
  retried = false,
): Promise<{
  userId: number;
  userType: string | null;
  isActive: boolean;
  /** app_user.session_version — stamped into the session cookie (drizzle/0015) */
  sessionVersion: number;
}> {
  const email = p.email.trim().toLowerCase();
  const owner = isOwner(email);
  const existing = await findAppUserByEmail(email);
  const { first, last } = splitName(p.name || (email.split('@')[0] ?? email));
  const profile = {
    larkId: p.larkId || null,
    department: p.department || null,
    title: p.title || null,
    avatar: p.avatar || null,
    lastLogin: nowThai(),
  };

  if (existing) {
    // owner = bootstrap only: a row with no role yet becomes System Admin; a role or a
    // disable an admin set later sticks (owners are no longer un-removable)
    const userType = existing.userType?.trim() || (owner ? ADMIN_USER_TYPE : null);
    await db
      .update(appUser)
      .set({
        // keep the legacy name if one exists; fill blanks from SSO
        firstName: existing.firstName?.trim() ? existing.firstName : first,
        lastName: existing.lastName?.trim() ? existing.lastName : last,
        phoneNo: existing.phoneNo?.trim() ? existing.phoneNo : p.phone.slice(0, 50) || null,
        userType,
        // only overwrite profile fields we actually received
        larkId: profile.larkId ?? existing.larkId,
        department: profile.department ?? existing.department,
        title: profile.title ?? existing.title,
        avatar: profile.avatar ?? existing.avatar,
        lastLogin: profile.lastLogin,
      })
      .where(eq(appUser.userId, existing.userId));
    return {
      userId: existing.userId,
      userType,
      isActive: existing.recordStatus === RS.ACTIVE,
      sessionVersion: existing.sessionVersion ?? 0,
    };
  }

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
    [row] = await insert(local);
  } catch (e) {
    const constraint = pgConstraint(e);
    // a second tab finished the first sign-in a moment ago → that row is ours
    if (constraint === 'ux_app_user_email' && !retried) return provisionSsoUser(p, true);
    // legacy unique (username, password): somchai@a and somchai@b share the local part
    if (constraint === 'ix_username_and_password')
      [row] = await insert(`${local.slice(0, 44)}.${crypto.randomUUID().slice(0, 4)}`);
    else throw e;
  }
  if (!row) throw new Error('app_user insert returned no row');
  userChanged(email);
  return {
    userId: row.userId,
    userType: owner ? ADMIN_USER_TYPE : null,
    isActive: true,
    sessionVersion: row.sessionVersion ?? 0,
  };
}

/** Name of the violated constraint of a Postgres unique error (drizzle wraps it in .cause). */
function pgConstraint(e: unknown): string | undefined {
  for (let x: unknown = e, i = 0; x && i < 3; x = (x as { cause?: unknown }).cause, i++) {
    const c = x as { code?: unknown; constraint?: unknown };
    if (c.code === '23505' && typeof c.constraint === 'string') return c.constraint;
  }
  return undefined;
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
export function listStaff(usedAs?: 'engineer' | 'sales'): Promise<{ id: number; name: string; userType: string }[]> {
  return cached(usedAs ? `staff:${usedAs}` : 'staff', TTL_MASTER, () => loadStaff(usedAs));
}
async function loadStaff(usedAs?: 'engineer' | 'sales'): Promise<{ id: number; name: string; userType: string }[]> {
  const used =
    usedAs === 'engineer'
      ? sql`${appUser.userId} IN (SELECT engineer_id FROM job)`
      : usedAs === 'sales'
        ? sql`${appUser.userId} IN (SELECT document_create_by FROM sale_out_hd)`
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
  return rows.map((r) => ({
    id: r.id,
    name: (fullName(r.first, r.last) || r.username || `#${r.id}`) + (r.status === RS.ACTIVE ? '' : ' (ไม่ใช้งานแล้ว)'),
    userType: r.userType?.trim() ?? '',
  }));
}

export type UpsertUserInput = {
  id?: string;
  name: string;
  role: string;
  email?: string;
  username?: string;
  code?: string;
  branch?: string;
  phone?: string;
  status?: string;
  avatar?: string;
  title?: string;
};

/** the stored username / phone of the user being edited — userSchema lets unchanged legacy values pass */
export async function userPrev(id: unknown): Promise<{ username: string | null; phone: string | null } | null> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const [row] = await db
    .select({ username: appUser.username, phone: appUser.phoneNo })
    .from(appUser)
    .where(eq(appUser.userId, n))
    .limit(1);
  return row ?? null;
}

/** Admin create/update from the "ผู้ใช้ระบบ" page. Role = legacy user_type. */
export async function upsertUser(input: UpsertUserInput, actorId = 0): Promise<{ user: User; created: boolean }> {
  const email = clean(input.email).toLowerCase();
  const role = clean(input.role);
  const userType = role === PENDING_ROLE ? null : role || null;
  const rs = fromUiStatus(input.status);
  const { first, last } = splitName(clean(input.name));
  const username = clean(input.username);
  const phone = clean(input.phone).replace(/[\s-]/g, '');

  const targetId = input.id ? Number(input.id) : NaN;
  const [before] = Number.isFinite(targetId) ? await db.select().from(appUser).where(eq(appUser.userId, targetId)) : [];
  if (Number.isFinite(targetId) && !before) throw new HttpError(404, 'user not found');

  // the role must be one of the roles (or the one the user already has)
  if (userType && userType !== before?.userType?.trim() && !(await listRoles()).includes(userType))
    throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง 1 ช่อง', { fields: { role: 'ไม่พบประเภทผู้ใช้งานนี้ในรายการ' } });
  // email / username belong to one user: a new user with someone's email used to UPDATE that user silently
  const clash: Record<string, string> = {};
  if (email) {
    const other = await findAppUserByEmail(email);
    if (other && other.userId !== before?.userId)
      clash.email = `อีเมลนี้เป็นของผู้ใช้ ${fullName(other.firstName, other.lastName) || other.username || `#${other.userId}`} แล้ว — แก้ไขจากรายการแทน`;
  }
  if (username && username.toLowerCase() !== clean(before?.username).toLowerCase()) {
    const [other] = await db
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

  if (before) {
    const userValues = {
      firstName: first,
      lastName: last,
      userType,
      ...statusStamp(rs, actorId),
      deleted: false,
      emailAddress: email || undefined,
      phoneNo: phone || undefined,
      larkId: clean(input.code) || undefined,
      department: clean(input.branch) || undefined,
      title: input.title || undefined,
      avatar: input.avatar || undefined,
      username: username || undefined,
    };
    const [row] = await db.update(appUser).set(userValues).where(eq(appUser.userId, targetId)).returning();
    if (!row) throw new HttpError(404, 'user not found');
    userChanged(row.emailAddress);
    await audit(db, actorId, {
      action: 'UPDATE',
      module: 'Admin',
      entity: 'app_user',
      key: targetId,
      summary: `แก้ไขผู้ใช้ ${fullName(first, last)} · สิทธิ์ ${userType ?? PENDING_ROLE}`,
      changes: diff(before as Record<string, unknown>, userValues as Record<string, unknown>, {
        skip: ['deleted', 'isActive'],
      }),
    }); // recordStatus stays: disable / re-enable is what an audit must show
    return { user: toUser(row), created: false };
  }

  const [row] = await db
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
  userChanged(row.emailAddress);
  await audit(db, actorId, {
    action: 'CREATE',
    module: 'Admin',
    entity: 'app_user',
    key: row.userId,
    summary: `เพิ่มผู้ใช้ ${fullName(first, last)} · ${email || '-'} · สิทธิ์ ${userType ?? PENDING_ROLE}`,
  });
  return { user: toUser(row), created: true };
}

/** One-click approve: first real role + Active. */
export async function approveUser(userId: number, role?: string, actorId = 0): Promise<User> {
  const [old] = await db.select({ type: appUser.userType }).from(appUser).where(eq(appUser.userId, userId));
  const [row] = await db
    .update(appUser)
    .set({ userType: role?.trim() || DEFAULT_APPROVED_TYPE, ...statusStamp(RS.ACTIVE, actorId), deleted: false })
    .where(eq(appUser.userId, userId))
    .returning();
  if (!row) throw new HttpError(404, 'user not found');
  userChanged(row.emailAddress);
  await audit(db, actorId, {
    action: 'APPROVE',
    module: 'Admin',
    entity: 'app_user',
    key: userId,
    summary: `อนุมัติผู้ใช้ ${fullName(row.firstName, row.lastName)} → ${row.userType}`,
    changes: { userType: [old?.type ?? null, row.userType] },
  });
  return toUser(row);
}

export async function setUserDeleted(userId: number, deleted: boolean, actorId = 0) {
  const [old] = await db.select({ rs: appUser.recordStatus }).from(appUser).where(eq(appUser.userId, userId));
  await db
    .update(appUser)
    .set({ ...statusStamp(deleted ? RS.DELETED : RS.ACTIVE, actorId), deleted })
    .where(eq(appUser.userId, userId));
  userChanged();
  await audit(db, actorId, {
    action: deleted ? 'DELETE' : 'STATUS',
    module: 'Admin',
    entity: 'app_user',
    key: userId,
    summary: deleted ? `ลบผู้ใช้ #${userId}` : `กู้คืนผู้ใช้ #${userId}`,
    changes: { recordStatus: [old?.rs ?? null, deleted ? RS.DELETED : RS.ACTIVE] },
  });
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

export async function savePermissions(
  items: { role: string; menu: string; add: boolean; edit: boolean; del: boolean; view: boolean }[],
  actorId = 0,
): Promise<number> {
  let n = 0;
  await db.transaction(async (tx) => {
    const beforeRows = await tx.select().from(appConfig);
    const beforeMap = new Map(beforeRows.map((r) => [`${r.userType?.trim()}::${r.moduleName?.trim()}`, r]));
    const changed: Record<string, [unknown, unknown]> = {};
    // one upsert on ix_user_type_and_module_name (unique (user_type, module_name)) instead of a
    // SELECT + UPDATE/INSERT per row; a pair sent twice keeps its last value (as the loop did)
    const rows = new Map(
      items.map((it) => [
        `${it.role}\0${it.menu}`,
        {
          userType: it.role,
          moduleName: it.menu,
          canInsert: it.add,
          canEdit: it.edit,
          canDelete: it.del,
          canView: it.view,
        },
      ]),
    );
    if (rows.size) {
      await tx
        .insert(appConfig)
        .values([...rows.values()])
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
    for (const it of items) {
      const values = { canInsert: it.add, canEdit: it.edit, canDelete: it.del, canView: it.view };
      const b = beforeMap.get(`${it.role}::${it.menu}`);
      const pack = (
        g:
          | {
              canInsert?: boolean | null;
              canEdit?: boolean | null;
              canDelete?: boolean | null;
              canView?: boolean | null;
            }
          | undefined,
      ) =>
        g
          ? `${g.canView ? 'V' : '-'}${g.canInsert ? 'A' : '-'}${g.canEdit ? 'E' : '-'}${g.canDelete ? 'D' : '-'}`
          : null;
      const was = pack(b);
      const now = pack(values);
      if (was !== now) changed[it.menu] = [was, now];
      n++;
    }
    const role = items[0]?.role ?? '';
    if (Object.keys(changed).length) {
      await audit(tx, actorId, {
        action: 'UPDATE',
        module: 'Admin',
        entity: 'app_config',
        key: role,
        summary: `แก้สิทธิ์บทบาท ${role} · ${Object.keys(changed).length} เมนู (V=ดู A=เพิ่ม E=แก้ D=ลบ)`,
        changes: changed,
      });
    }
  });
  invalidateGrantCache();
  invalidate('roles');
  invalidate('modules');
  return n;
}

export { desc };
