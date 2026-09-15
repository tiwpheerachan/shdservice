import "server-only";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { appConfig, appUser } from "@/db/schema";
import { isOwner, PENDING_ROLE } from "@/lib/access";
import { ADMIN_USER_TYPE } from "@/lib/modules";
import { findAppUserByEmail, fullName, HttpError, invalidateGrantCache } from "@/server/auth";
import type { User, Permission } from "@/data/mock";
import { nowThai, fmtDateTime } from "@/server/mappers/format";

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
        isActive: owner ? true : existing.isActive,
        deleted: owner ? false : existing.deleted,
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
      isActive: owner ? true : existing.isActive !== false && !existing.deleted,
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
      phoneNo: p.phone.slice(0, 50) || null,
      emailAddress: email,
      ...profile,
    })
    .returning({ userId: appUser.userId });
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
    status: r.isActive === false ? "Inactive" : "Active",
    avatar: r.avatar ?? null,
    title: r.title ?? null,
  };
}

export type DeletedMode = "exclude" | "only" | "all";

/**
 * "ผู้ใช้ระบบ" = every app_user row (legacy staff + SSO-provisioned people).
 * Admins manage roles here directly — a person does not need to have logged in
 * first; when they later sign in through SSO they are matched by email and get
 * the role already assigned.
 */
export async function listSystemUsers(deleted: DeletedMode = "exclude"): Promise<User[]> {
  const del =
    deleted === "exclude" ? eq(appUser.deleted, false) : deleted === "only" ? eq(appUser.deleted, true) : undefined;
  const rows = await db.select().from(appUser).where(del).orderBy(asc(appUser.userId));
  return rows.map(toUser);
}

/** Everyone active — for technician / opener / salesperson dropdowns. */
export async function listStaff(): Promise<{ id: number; name: string; userType: string }[]> {
  const rows = await db
    .select({
      id: appUser.userId,
      first: appUser.firstName,
      last: appUser.lastName,
      username: appUser.username,
      userType: appUser.userType,
    })
    .from(appUser)
    .where(and(ne(appUser.isActive, false), eq(appUser.deleted, false)))
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
export async function upsertUser(input: UpsertUserInput): Promise<{ user: User; created: boolean }> {
  const email = (input.email ?? "").trim().toLowerCase();
  const userType = input.role.trim() === PENDING_ROLE ? null : input.role.trim() || null;
  const isActive = (input.status ?? "Active").toLowerCase() === "active";
  const { first, last } = splitName(input.name);

  let targetId = input.id ? Number(input.id) : NaN;
  if (!Number.isFinite(targetId) && email) {
    const byEmail = await findAppUserByEmail(email);
    if (byEmail) targetId = byEmail.userId;
  }

  if (Number.isFinite(targetId)) {
    const [row] = await db
      .update(appUser)
      .set({
        firstName: first,
        lastName: last,
        userType,
        isActive,
        emailAddress: email || undefined,
        phoneNo: input.phone?.slice(0, 50) || undefined,
        larkId: input.code || undefined,
        department: input.branch || undefined,
        title: input.title || undefined,
        avatar: input.avatar || undefined,
        username: input.username?.slice(0, 50) || undefined,
      })
      .where(eq(appUser.userId, targetId))
      .returning();
    if (!row) throw new HttpError(404, "user not found");
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
      isActive,
      emailAddress: email || null,
      phoneNo: input.phone?.slice(0, 50) || null,
      larkId: input.code || null,
      department: input.branch || null,
      title: input.title || null,
      avatar: input.avatar || null,
    })
    .returning();
  return { user: toUser(row), created: true };
}

/** One-click approve: first real role + Active. */
export async function approveUser(userId: number, role?: string): Promise<User> {
  const [row] = await db
    .update(appUser)
    .set({ userType: role?.trim() || DEFAULT_APPROVED_TYPE, isActive: true, deleted: false })
    .where(eq(appUser.userId, userId))
    .returning();
  if (!row) throw new HttpError(404, "user not found");
  return toUser(row);
}

export async function setUserDeleted(userId: number, deleted: boolean) {
  await db.update(appUser).set({ deleted }).where(eq(appUser.userId, userId));
}

/* ------------------------------------------------------------------ *
 * Permissions (app_config) — role list, matrix, save
 * ------------------------------------------------------------------ */
export async function listRoles(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ t: appConfig.userType })
    .from(appConfig)
    .orderBy(asc(appConfig.userType));
  const set = new Set<string>([ADMIN_USER_TYPE]);
  for (const r of rows) if (r.t?.trim()) set.add(r.t.trim());
  return Array.from(set);
}

export async function listModules(): Promise<string[]> {
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
  items: { role: string; menu: string; add: boolean; edit: boolean; del: boolean; view: boolean }[]
): Promise<number> {
  let n = 0;
  await db.transaction(async (tx) => {
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
      n++;
    }
  });
  invalidateGrantCache();
  return n;
}

export { desc };
