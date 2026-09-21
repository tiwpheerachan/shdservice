import { audit, diff } from "@/server/audit";
import "server-only";
import { cached, invalidate, TTL_MASTER } from "@/server/cache";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appConfig, appUser } from "@/db/schema";
import { isOwner, PENDING_ROLE } from "@/lib/access";
import { ADMIN_USER_TYPE } from "@/lib/modules";
import { findAppUserByEmail, fullName, HttpError, invalidateGrantCache, invalidateUserCache } from "@/server/auth";

/** After any app_user write: the staff dropdown and the per-request user lookup must see it now. */
function userChanged(email?: string | null) {
  invalidate("staff");
  invalidateUserCache(email ?? undefined);
}
import type { User, Permission } from "@/data/mock";
import { nowThai, fmtDateTime } from "@/server/mappers/format";
import { RS, statusFilter, uiStatus, fromUiStatus, statusStamp, type StatusMode } from "@/server/record-status";

const DEFAULT_APPROVED_TYPE = "Customer Service";

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  return { first: parts[0].slice(0, 50), last: parts.slice(1).join(" ").slice(0, 50) };
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
export async function provisionSsoUser(p: SsoProfile): Promise<{
  userId: number;
  userType: string | null;
  isActive: boolean;
}> {
  const email = p.email.trim().toLowerCase();
  const owner = isOwner(email);
  const existing = await findAppUserByEmail(email);
  const { first, last } = splitName(p.name || email.split("@")[0]);
  const profile = {
    larkId: p.larkId || null,
    department: p.department || null,
    title: p.title || null,
    avatar: p.avatar || null,
    lastLogin: nowThai(),
  };

  if (existing) {
    const userType = owner ? ADMIN_USER_TYPE : existing.userType?.trim() || null;
    await db
      .update(appUser)
      .set({
        // keep the legacy name if one exists; fill blanks from SSO
        firstName: existing.firstName?.trim() ? existing.firstName : first,
        lastName: existing.lastName?.trim() ? existing.lastName : last,
        phoneNo: existing.phoneNo?.trim() ? existing.phoneNo : p.phone.slice(0, 50) || null,
        userType: owner ? ADMIN_USER_TYPE : existing.userType,
        // owners are always ACTIVE; everyone else keeps their record_status
        ...(owner ? { ...statusStamp(RS.ACTIVE, existing.userId), deleted: false } : {}),
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
      isActive: owner ? true : existing.recordStatus === RS.ACTIVE,
    };
  }

  const [row] = await db
    .insert(appUser)
    .values({
      username: email.split("@")[0].slice(0, 50),
      password: "",
      firstName: first,
      lastName: last,
      userType: owner ? ADMIN_USER_TYPE : null,
      isActive: true,
      recordStatus: RS.ACTIVE,
      phoneNo: p.phone.slice(0, 50) || null,
      emailAddress: email,
      ...profile,
    })
    .returning({ userId: appUser.userId });
  userChanged(email);
  return { userId: row.userId, userType: owner ? ADMIN_USER_TYPE : null, isActive: true };
}

/* ------------------------------------------------------------------ *
 * Mapping app_user → the UI's `User` type
 * ------------------------------------------------------------------ */
type AppUserRow = typeof appUser.$inferSelect;

export function toUser(r: AppUserRow): User {
  return {
    id: String(r.userId),
    code: r.larkId ?? "",
    name: fullName(r.firstName, r.lastName) || r.username || "",
    username: r.username ?? "",
    role: r.userType?.trim() || PENDING_ROLE,
    branch: r.department ?? "",
    email: r.emailAddress?.trim() ?? "",
    phone: r.phoneNo ?? "",
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
export async function listSystemUsers(deleted: DeletedMode = "exclude"): Promise<User[]> {
  const rows = await db.select().from(appUser).where(statusFilter(appUser.recordStatus, deleted)).orderBy(asc(appUser.userId));
  return rows.map(toUser);
}

/** Everyone active — for technician / opener / salesperson dropdowns. */
export function listStaff(): Promise<{ id: number; name: string; userType: string }[]> {
  return cached("staff", TTL_MASTER, loadStaff);
}
async function loadStaff(): Promise<{ id: number; name: string; userType: string }[]> {
  const rows = await db
    .select({
      id: appUser.userId,
      first: appUser.firstName,
      last: appUser.lastName,
      username: appUser.username,
      userType: appUser.userType,
    })
    .from(appUser)
    .where(eq(appUser.recordStatus, RS.ACTIVE))
    .orderBy(asc(appUser.firstName), asc(appUser.lastName));
  return rows.map((r) => ({
    id: r.id,
    name: fullName(r.first, r.last) || r.username || `#${r.id}`,
    userType: r.userType?.trim() ?? "",
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

/** Admin create/update from the "ผู้ใช้ระบบ" page. Role = legacy user_type. */
export async function upsertUser(input: UpsertUserInput, actorId = 0): Promise<{ user: User; created: boolean }> {
  const email = (input.email ?? "").trim().toLowerCase();
  const userType = input.role.trim() === PENDING_ROLE ? null : input.role.trim() || null;
  const rs = fromUiStatus(input.status);
  const { first, last } = splitName(input.name);

  let targetId = input.id ? Number(input.id) : NaN;
  if (!Number.isFinite(targetId) && email) {
    const byEmail = await findAppUserByEmail(email);
    if (byEmail) targetId = byEmail.userId;
  }

  if (Number.isFinite(targetId)) {
    const [before] = await db.select().from(appUser).where(eq(appUser.userId, targetId));
    const userValues = {
        firstName: first,
        lastName: last,
        userType,
        ...statusStamp(rs, actorId),
        deleted: false,
        emailAddress: email || undefined,
        phoneNo: input.phone?.slice(0, 50) || undefined,
        larkId: input.code || undefined,
        department: input.branch || undefined,
        title: input.title || undefined,
        avatar: input.avatar || undefined,
        username: input.username?.slice(0, 50) || undefined,
      };
    const [row] = await db.update(appUser).set(userValues).where(eq(appUser.userId, targetId)).returning();
    if (!row) throw new HttpError(404, "user not found");
    userChanged(row.emailAddress);
    await audit(db, actorId, { action: "UPDATE", module: "Admin", entity: "app_user", key: targetId, summary: `แก้ไขผู้ใช้ ${fullName(first, last)} · สิทธิ์ ${userType ?? PENDING_ROLE}`, changes: diff(before as Record<string, unknown>, userValues as Record<string, unknown>, { skip: ["deleted", "isActive", "recordStatus"] }) });
    return { user: toUser(row), created: false };
  }

  const [row] = await db
    .insert(appUser)
    .values({
      username: (input.username || (email ? email.split("@")[0] : first) || "user").slice(0, 50),
      password: "",
      firstName: first,
      lastName: last,
      userType,
      ...statusStamp(rs, actorId),
      emailAddress: email || null,
      phoneNo: input.phone?.slice(0, 50) || null,
      larkId: input.code || null,
      department: input.branch || null,
      title: input.title || null,
      avatar: input.avatar || null,
    })
    .returning();
  userChanged(row.emailAddress);
  await audit(db, actorId, { action: "CREATE", module: "Admin", entity: "app_user", key: row.userId, summary: `เพิ่มผู้ใช้ ${fullName(first, last)} · ${email || "-"} · สิทธิ์ ${userType ?? PENDING_ROLE}` });
  return { user: toUser(row), created: true };
}

/** One-click approve: first real role + Active. */
export async function approveUser(userId: number, role?: string, actorId = 0): Promise<User> {
  const [row] = await db
    .update(appUser)
    .set({ userType: role?.trim() || DEFAULT_APPROVED_TYPE, ...statusStamp(RS.ACTIVE, actorId), deleted: false })
    .where(eq(appUser.userId, userId))
    .returning();
  if (!row) throw new HttpError(404, "user not found");
  userChanged(row.emailAddress);
  await audit(db, actorId, { action: "APPROVE", module: "Admin", entity: "app_user", key: userId, summary: `อนุมัติผู้ใช้ ${fullName(row.firstName, row.lastName)} → ${row.userType}`, changes: { userType: [null, row.userType] } });
  return toUser(row);
}

export async function setUserDeleted(userId: number, deleted: boolean, actorId = 0) {
  await db
    .update(appUser)
    .set({ ...statusStamp(deleted ? RS.DELETED : RS.ACTIVE, actorId), deleted })
    .where(eq(appUser.userId, userId));
  userChanged();
  await audit(db, actorId, { action: deleted ? "DELETE" : "STATUS", module: "Admin", entity: "app_user", key: userId, summary: deleted ? `ลบผู้ใช้ #${userId}` : `กู้คืนผู้ใช้ #${userId}`, changes: { recordStatus: [null, deleted ? RS.DELETED : RS.ACTIVE] } });
}

/* ------------------------------------------------------------------ *
 * Permissions (app_config) — role list, matrix, save
 * ------------------------------------------------------------------ */
export function listRoles(): Promise<string[]> {
  return cached("roles", TTL_MASTER, loadRoles);
}
async function loadRoles(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ t: appConfig.userType })
    .from(appConfig)
    .orderBy(asc(appConfig.userType));
  const set = new Set<string>([ADMIN_USER_TYPE]);
  for (const r of rows) if (r.t?.trim()) set.add(r.t.trim());
  return Array.from(set);
}

export function listModules(): Promise<string[]> {
  return cached("modules", TTL_MASTER, loadModules);
}
async function loadModules(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ m: appConfig.moduleName })
    .from(appConfig)
    .orderBy(asc(appConfig.moduleName));
  return rows.map((r) => r.m?.trim()).filter((m): m is string => !!m);
}

export async function listPermissions(): Promise<Permission[]> {
  const rows = await db.select().from(appConfig).orderBy(asc(appConfig.userType), asc(appConfig.moduleName));
  return rows.map((r) => ({
    id: String(r.configId),
    role: r.userType?.trim() ?? "",
    menu: r.moduleName?.trim() ?? "",
    add: !!r.canInsert,
    edit: !!r.canEdit,
    del: !!r.canDelete,
    view: !!r.canView,
  }));
}

export async function savePermissions(
  items: { role: string; menu: string; add: boolean; edit: boolean; del: boolean; view: boolean }[],
  actorId = 0
): Promise<number> {
  let n = 0;
  await db.transaction(async (tx) => {
    const beforeRows = await tx.select().from(appConfig);
    const beforeMap = new Map(beforeRows.map((r) => [`${r.userType?.trim()}::${r.moduleName?.trim()}`, r]));
    const changed: Record<string, [unknown, unknown]> = {};
    for (const it of items) {
      const existing = await tx
        .select({ id: appConfig.configId })
        .from(appConfig)
        .where(and(eq(appConfig.userType, it.role), eq(appConfig.moduleName, it.menu)))
        .limit(1);
      const values = { canInsert: it.add, canEdit: it.edit, canDelete: it.del, canView: it.view };
      if (existing[0]) {
        await tx.update(appConfig).set(values).where(eq(appConfig.configId, existing[0].id));
      } else {
        await tx.insert(appConfig).values({ userType: it.role, moduleName: it.menu, ...values });
      }
      const b = beforeMap.get(`${it.role}::${it.menu}`);
      const pack = (g: { canInsert?: boolean | null; canEdit?: boolean | null; canDelete?: boolean | null; canView?: boolean | null } | undefined) =>
        g ? `${g.canView ? "V" : "-"}${g.canInsert ? "A" : "-"}${g.canEdit ? "E" : "-"}${g.canDelete ? "D" : "-"}` : null;
      const was = pack(b);
      const now = pack(values);
      if (was !== now) changed[it.menu] = [was, now];
      n++;
    }
    const role = items[0]?.role ?? "";
    if (Object.keys(changed).length) {
      await audit(tx, actorId, { action: "UPDATE", module: "Admin", entity: "app_config", key: role, summary: `แก้สิทธิ์บทบาท ${role} · ${Object.keys(changed).length} เมนู (V=ดู A=เพิ่ม E=แก้ D=ลบ)`, changes: changed });
    }
  });
  invalidateGrantCache();
  invalidate("roles");
  invalidate("modules");
  return n;
}

export { desc };
