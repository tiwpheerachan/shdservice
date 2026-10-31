import 'server-only';
import type { z } from 'zod';
import type { shippingProfileSave } from '@/server/contract/admin';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { db, writeTx } from '@/db/client';
import { shippingProfile } from '@/db/schema';
import { HttpError } from '@/server/auth';
import { assertValid } from '@/server/validate';
import { shippingProfileSchema } from '@/lib/validation/admin';
import { clean, cleanCode } from '@/lib/validation';
import { audit, diff } from '@/server/audit';
import { cached, invalidate, TTL_MASTER } from '@/server/cache';
import { nowThai } from '@/server/mappers/format';

/**
 * "โปรไฟล์บริษัทขนส่ง" — the courier a repaired device is shipped back with; /track shows its logo and a link into the
 * courier's own tracking site. `trackUrl` holds {no} where the tracking number goes (editable: carriers change URLs).
 */
export type ShippingProfile = {
  /** the row's uuid — job.return_shipper_id stores its `pk` */
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  logoPath: string;
  /** what an <img> can load, or "" */
  logoUrl: string;
  trackUrl: string;
  /** other names (legacy free text "THAIPOST", "t" …), comma separated — src/lib/shipper.ts */
  aliases: string;
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
  logoUrl: r.logoPath ? `/api/files?path=${encodeURIComponent(r.logoPath)}` : '',
  trackUrl: r.trackUrl,
  aliases: r.aliases,
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
      .orderBy(asc(shippingProfile.sortOrder), asc(shippingProfile.pk));
    return rows.map(toProfile);
  });
}

/** by uuid (the API), or by pk (a job's stored return_shipper_id) */
export async function getShippingProfile(id: string | number | null | undefined): Promise<ShippingProfile | null> {
  if (!id || (typeof id === 'number' && id <= 0)) return null;
  const [r] = await db
    .select()
    .from(shippingProfile)
    .where(typeof id === 'number' ? eq(shippingProfile.pk, id) : eq(shippingProfile.id, id))
    .limit(1);
  return r ? toProfile(r) : null;
}

/** final URL for a parcel, or "" when the courier has no template */
export function trackUrlFor(profile: Pick<ShippingProfile, 'trackUrl'> | null, trackingNo: string): string {
  const no = (trackingNo ?? '').trim();
  if (!profile?.trackUrl || !no) return '';
  return profile.trackUrl.replace(/\{no\}/gi, encodeURIComponent(no));
}

/** "THAIPOST,ไปรษณีย์ ,, EMS" → "THAIPOST, ไปรษณีย์, EMS" (trimmed, no blanks, no repeats) */
const aliasList = (v: unknown) =>
  [
    ...new Set(
      clean(v)
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
    ),
  ].join(', ');

export type ShippingProfileInput = z.output<typeof shippingProfileSave.body>;

export async function saveShippingProfile(i: ShippingProfileInput, byUserId: number): Promise<ShippingProfile> {
  assertValid(shippingProfileSchema, i); // same rules as the page: errors under code / nameTh / trackUrl (≤ 300)
  const code = cleanCode(i.code);
  const nameTh = clean(i.nameTh);
  const trackUrl = clean(i.trackUrl);

  const values = {
    code,
    nameTh,
    nameEn: clean(i.nameEn),
    trackUrl,
    aliases: aliasList(i.aliases),
    isActive: i.isActive !== false,
    sortOrder: Number(i.sortOrder ?? 0) || 0,
    updatedAt: nowThai(),
  };

  const saved = await writeTx(async (tx) => {
    const others = await tx
      .select()
      .from(shippingProfile)
      .where(and(isNull(shippingProfile.deletedAt), i.id ? ne(shippingProfile.id, i.id) : undefined));
    for (const o of others)
      if (o.code === code) {
        const msg = `รหัส ${code} ถูกใช้แล้ว (${o.nameTh})`;
        throw new HttpError(409, msg, { fields: { code: msg } });
      }
    // a new profile with no order of its own goes last, not first (0)
    if (!i.id && !values.sortOrder) values.sortOrder = Math.max(0, ...others.map((o) => o.sortOrder)) + 1;

    let before: Row | undefined;
    if (i.id) {
      [before] = await tx.select().from(shippingProfile).where(eq(shippingProfile.id, i.id)).for('update');
      if (!before || before.deletedAt) throw new HttpError(404, 'ไม่พบโปรไฟล์');
      // the form as it loaded the profile: a field another admin saved since → 409 stale, nothing written
      const loaded: Record<string, unknown> = i.expect ?? {};
      const now: Record<string, unknown> = toProfile(before);
      if (Object.keys(values).some((k) => loaded[k] != null && loaded[k] !== now[k]))
        throw new HttpError(409, 'ผู้ดูแลระบบคนอื่นเพิ่งแก้รายการนี้ — โหลดหน้าใหม่แล้วแก้อีกครั้ง', { stale: true });
    }
    const [row] = before
      ? await tx.update(shippingProfile).set(values).where(eq(shippingProfile.pk, before.pk)).returning()
      : await tx.insert(shippingProfile).values(values).returning();
    if (!row) throw new HttpError(404, 'ไม่พบโปรไฟล์');
    await audit(tx, byUserId, {
      action: before ? 'UPDATE' : 'CREATE',
      module: 'Admin',
      entity: 'shipping_profile',
      key: row.id,
      no: row.code,
      summary: `${before ? 'แก้ไข' : 'เพิ่ม'}โปรไฟล์บริษัทขนส่ง ${row.code} ${row.nameTh}`,
      changes: diff(before ?? null, values),
    });
    return toProfile(row);
  });
  invalidate('shippers:'); // after the commit — dropped inside, a read in between would cache the old row again
  return saved;
}

/** soft delete — jobs already shipped keep pointing at the row so old links still work */
export async function deleteShippingProfile(id: string, byUserId: number): Promise<void> {
  await writeTx(async (tx) => {
    const [before] = await tx.select().from(shippingProfile).where(eq(shippingProfile.id, id)).limit(1);
    if (!before || before.deletedAt) throw new HttpError(404, 'ไม่พบโปรไฟล์');
    await tx
      .update(shippingProfile)
      .set({ deletedAt: nowThai(), deletedByAppUserPk: byUserId, updatedAt: nowThai() })
      .where(eq(shippingProfile.pk, before.pk));
    await audit(tx, byUserId, {
      action: 'DELETE',
      module: 'Admin',
      entity: 'shipping_profile',
      key: id,
      no: before.code,
      summary: `ลบโปรไฟล์บริษัทขนส่ง ${before.code} — ${before.nameTh}`,
      changes: { deletedAt: [before.deletedAt, nowThai()] }, // before.deletedAt is null here (checked above)
    });
  });
  invalidate('shippers:');
}

/** returns the logo path it replaced (read under the row lock — the caller removes that file after the commit) */
export async function setShippingProfileLogo(id: string, logoPath: string, byUserId: number): Promise<string> {
  const old = await writeTx(async (tx) => {
    const [before] = await tx.select().from(shippingProfile).where(eq(shippingProfile.id, id)).for('update');
    if (!before) throw new HttpError(404, 'ไม่พบโปรไฟล์');
    await tx.update(shippingProfile).set({ logoPath, updatedAt: nowThai() }).where(eq(shippingProfile.pk, before.pk));
    await audit(tx, byUserId, {
      action: 'UPDATE',
      module: 'Admin',
      entity: 'shipping_profile',
      key: id,
      no: before.code,
      summary: `เปลี่ยนโลโก้บริษัทขนส่ง ${before.code}`,
      changes: { logoPath: [before.logoPath, logoPath] },
    });
    return before.logoPath;
  });
  invalidate('shippers:');
  return old;
}
