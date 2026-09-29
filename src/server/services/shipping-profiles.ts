import "server-only";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { shippingProfile } from "@/db/schema";
import { HttpError } from "@/server/auth";
import { audit, diff } from "@/server/audit";
import { cached, invalidate, TTL_MASTER } from "@/server/cache";
import { nowThai } from "@/server/mappers/format";

/**
 * "โปรไฟล์บริษัทขนส่ง" (drizzle/0013) — the courier a repaired device is shipped
 * back with. Used by the customer tracking page to show a logo and a link into
 * the courier's own tracking site; `trackUrl` holds {no} where the tracking
 * number goes, and is editable because carriers change their URLs.
 */
export type ShippingProfile = {
  id: number;
  code: string;
  nameTh: string;
  nameEn: string;
  logoPath: string;
  /** what an <img> can load, or "" */
  logoUrl: string;
  trackUrl: string;
  isActive: boolean;
  isDeleted: boolean;
  sortOrder: number;
};

type Row = typeof shippingProfile.$inferSelect;
const toProfile = (r: Row): ShippingProfile => ({
  id: r.id,
  code: r.code,
  nameTh: r.nameTh,
  nameEn: r.nameEn,
  logoPath: r.logoPath,
  logoUrl: r.logoPath ? `/api/files?path=${encodeURIComponent(r.logoPath)}` : "",
  trackUrl: r.trackUrl,
  isActive: r.isActive,
  isDeleted: !!r.deletedAt,
  sortOrder: r.sortOrder,
});

export function listShippingProfiles(activeOnly = true): Promise<ShippingProfile[]> {
  return cached(`shippers:${activeOnly}`, TTL_MASTER, async () => {
    const rows = await db
      .select()
      .from(shippingProfile)
      .where(and(isNull(shippingProfile.deletedAt), activeOnly ? eq(shippingProfile.isActive, true) : undefined))
      .orderBy(asc(shippingProfile.sortOrder), asc(shippingProfile.id));
    return rows.map(toProfile);
  });
}

export async function getShippingProfile(id: number | null | undefined): Promise<ShippingProfile | null> {
  if (!id || id <= 0) return null;
  const [r] = await db.select().from(shippingProfile).where(eq(shippingProfile.id, id)).limit(1);
  return r ? toProfile(r) : null;
}

/** final URL for a parcel, or "" when the courier has no template */
export function trackUrlFor(profile: Pick<ShippingProfile, "trackUrl"> | null, trackingNo: string): string {
  const no = (trackingNo ?? "").trim();
  if (!profile?.trackUrl || !no) return "";
  return profile.trackUrl.replace(/\{no\}/gi, encodeURIComponent(no));
}

export type ShippingProfileInput = {
  id?: number;
  code: string;
  nameTh: string;
  nameEn?: string;
  trackUrl?: string;
  isActive?: boolean;
  sortOrder?: number;
};

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function saveShippingProfile(i: ShippingProfileInput, byUserId: number): Promise<ShippingProfile> {
  const code = str(i.code, 20).toUpperCase();
  const nameTh = str(i.nameTh);
  const trackUrl = str(i.trackUrl, 300);
  if (!code) throw new HttpError(400, "ต้องระบุรหัส (เช่น FLASH)");
  if (!nameTh) throw new HttpError(400, "ต้องระบุชื่อบริษัทขนส่ง");
  if (trackUrl && !/^https:\/\//i.test(trackUrl)) throw new HttpError(400, "ลิงก์ติดตามต้องขึ้นต้นด้วย https://");
  if (trackUrl && !/\{no\}/i.test(trackUrl)) throw new HttpError(400, "ลิงก์ติดตามต้องมี {no} ตรงตำแหน่งเลขพัสดุ");

  const values = {
    code,
    nameTh,
    nameEn: str(i.nameEn),
    trackUrl,
    isActive: i.isActive !== false,
    sortOrder: Number(i.sortOrder ?? 0) || 0,
    updatedAt: nowThai(),
  };

  return db.transaction(async (tx) => {
    const others = await tx
      .select()
      .from(shippingProfile)
      .where(and(isNull(shippingProfile.deletedAt), i.id ? ne(shippingProfile.id, i.id) : undefined));
    for (const o of others) if (o.code === code) throw new HttpError(409, `รหัส ${code} ถูกใช้แล้ว (${o.nameTh})`);

    let before: Row | undefined;
    if (i.id) {
      [before] = await tx.select().from(shippingProfile).where(eq(shippingProfile.id, i.id)).limit(1);
      if (!before || before.deletedAt) throw new HttpError(404, "ไม่พบโปรไฟล์");
    }
    const [row] = before
      ? await tx.update(shippingProfile).set(values).where(eq(shippingProfile.id, before.id)).returning()
      : await tx.insert(shippingProfile).values(values).returning();
    await audit(tx, byUserId, {
      action: before ? "UPDATE" : "CREATE",
      module: "Admin",
      entity: "shipping_profile",
      key: row.id,
      summary: `${before ? "แก้ไข" : "เพิ่ม"}โปรไฟล์บริษัทขนส่ง ${row.code} ${row.nameTh}`,
      changes: diff(before ?? null, values),
    });
    invalidate("shippers:");
    return toProfile(row);
  });
}

/** soft delete — jobs already shipped keep pointing at the row so old links still work */
export async function deleteShippingProfile(id: number, byUserId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(shippingProfile).where(eq(shippingProfile.id, id)).limit(1);
    if (!before || before.deletedAt) throw new HttpError(404, "ไม่พบโปรไฟล์");
    await tx
      .update(shippingProfile)
      .set({ deletedAt: nowThai(), deletedBy: byUserId, updatedAt: nowThai() })
      .where(eq(shippingProfile.id, id));
    await audit(tx, byUserId, {
      action: "DELETE",
      module: "Admin",
      entity: "shipping_profile",
      key: id,
      summary: `ลบโปรไฟล์บริษัทขนส่ง ${before.code} — ${before.nameTh}`,
      changes: { deletedAt: [null, nowThai()] },
    });
  });
  invalidate("shippers:");
}

export async function setShippingProfileLogo(id: number, logoPath: string, byUserId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(shippingProfile).where(eq(shippingProfile.id, id)).limit(1);
    if (!before) throw new HttpError(404, "ไม่พบโปรไฟล์");
    await tx.update(shippingProfile).set({ logoPath, updatedAt: nowThai() }).where(eq(shippingProfile.id, id));
    await audit(tx, byUserId, {
      action: "UPDATE",
      module: "Admin",
      entity: "shipping_profile",
      key: id,
      summary: `เปลี่ยนโลโก้บริษัทขนส่ง ${before.code}`,
      changes: { logoPath: [before.logoPath, logoPath] },
    });
  });
  invalidate("shippers:");
}
