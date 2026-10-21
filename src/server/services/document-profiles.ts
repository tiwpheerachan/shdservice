import 'server-only';
import type { z } from 'zod';
import type { documentProfileSave } from '@/server/contract/admin';
import { cached, invalidate, TTL_MASTER } from '@/server/cache';
import { asc, eq, ne, and, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { documentProfile, job, quotationHd, saleOutHd } from '@/db/schema';
import { HttpError } from '@/server/auth';
import { assertValid } from '@/server/validate';
import { documentProfileSchema } from '@/lib/validation/admin';
import { taxIdDigits } from '@/lib/validation/customer';
import { clean, cleanCode } from '@/lib/validation';
import { audit, diff } from '@/server/audit';
import { nowThai } from '@/server/mappers/format';

/**
 * "ออกเอกสารในนาม" — the company/brand whose letterhead (logo, name, address,
 * tax id, bank account) a job, quotation or sale order is printed with
 * (drizzle/0007, revised 0010). SHD is id 1 and the default; documents with a
 * NULL profile id are SHD.
 *
 * Document NUMBERS are NOT brand-specific: J / Q / SO + year + one running
 * series for the whole company, exactly like the legacy app. The profile can be
 * changed on a document at any time (edit screen, or from the print button) and
 * the change is audited. The prefix_* columns are legacy of the first design and
 * always hold J / Q / SO.
 */
export type DocumentProfile = {
  id: number;
  code: string;
  nameTh: string;
  nameEn: string;
  addressLine1: string;
  addressLine2: string;
  address: string;
  phone: string;
  email: string;
  taxId: string;
  bankName: string;
  bankAccountType: string;
  bankAccountNo: string;
  bankAccountName: string;
  /** bucket path or "" (SHD built-in mark) */
  logoPath: string;
  /** what an <img> can load: /api/files?path=… or the built-in mark */
  logoUrl: string;
  stampPath: string;
  isDefault: boolean;
  isActive: boolean;
  isDeleted: boolean;
  sortOrder: number;
};

export const SHD_PROFILE_ID = 1;
const BUILTIN_LOGO = '/logo-shd-mark.png';

/** One profile change at a time (save / delete): "exactly one default" is checked and written by one of them
 *  at a time. A document taking a profile holds it shared, so the profile cannot be deleted under it. */
const lockProfiles = (shared = false) =>
  shared
    ? sql`SELECT pg_advisory_xact_lock_shared(hashtext('document_profile'))`
    : sql`SELECT pg_advisory_xact_lock(hashtext('document_profile'))`;

type Row = typeof documentProfile.$inferSelect;
function toProfile(r: Row): DocumentProfile {
  return {
    id: r.id,
    code: r.code,
    nameTh: r.nameTh,
    nameEn: r.nameEn,
    addressLine1: r.addressLine1,
    addressLine2: r.addressLine2,
    address: [r.addressLine1, r.addressLine2].filter(Boolean).join(' '),
    phone: r.phone,
    email: r.email,
    taxId: r.taxId,
    bankName: r.bankName,
    bankAccountType: r.bankAccountType,
    bankAccountNo: r.bankAccountNo,
    bankAccountName: r.bankAccountName,
    logoPath: r.logoPath,
    logoUrl: r.logoPath ? `/api/files?path=${encodeURIComponent(r.logoPath)}` : BUILTIN_LOGO,
    stampPath: r.stampPath,
    isDefault: r.isDefault,
    isActive: r.isActive,
    isDeleted: !!r.deletedAt,
    sortOrder: r.sortOrder,
  };
}

export function listDocumentProfiles(activeOnly = true): Promise<DocumentProfile[]> {
  return cached(`docprofiles:${activeOnly}`, TTL_MASTER, () => loadDocumentProfiles(activeOnly));
}
async function loadDocumentProfiles(activeOnly: boolean): Promise<DocumentProfile[]> {
  const rows = await db
    .select()
    .from(documentProfile)
    .where(and(isNull(documentProfile.deletedAt), activeOnly ? eq(documentProfile.isActive, true) : undefined))
    .orderBy(asc(documentProfile.sortOrder), asc(documentProfile.id));
  return rows.map(toProfile);
}

export async function getDocumentProfile(id: number | null | undefined): Promise<DocumentProfile | null> {
  const [r] = await db
    .select()
    .from(documentProfile)
    .where(eq(documentProfile.id, id && id > 0 ? id : SHD_PROFILE_ID))
    .limit(1);
  return r ? toProfile(r) : null;
}

/** Profile a document should print with: its own, else the default (SHD). */
export async function profileForDocument(id: number | null | undefined): Promise<DocumentProfile> {
  const p = (await getDocumentProfile(id)) ?? (await getDocumentProfile(SHD_PROFILE_ID));
  if (!p) throw new HttpError(500, 'ไม่พบโปรไฟล์ผู้ออกเอกสาร (document_profile ยังไม่ได้ migrate)');
  return p;
}

export async function defaultDocumentProfile(): Promise<DocumentProfile> {
  const [r] = await db
    .select()
    .from(documentProfile)
    .where(
      and(eq(documentProfile.isDefault, true), eq(documentProfile.isActive, true), isNull(documentProfile.deletedAt)),
    )
    .orderBy(asc(documentProfile.sortOrder), asc(documentProfile.id))
    .limit(1);
  return r ? toProfile(r) : profileForDocument(SHD_PROFILE_ID);
}

/**
 * Resolve the profile to issue a NEW document under: the requested id if it is
 * active, else the default. Throws when an explicit id is unknown / inactive so
 * a stale dropdown never silently falls back to another brand's number series.
 */
export async function issuingProfile(requested: number | null | undefined): Promise<DocumentProfile> {
  if (!requested || requested <= 0) return defaultDocumentProfile();
  const p = await getDocumentProfile(requested);
  if (!p || !p.isActive || p.isDeleted) throw new HttpError(400, 'โปรไฟล์ผู้ออกเอกสารที่เลือกไม่พร้อมใช้งาน');
  return p;
}

/**
 * Soft delete: the row stays so documents issued under it keep printing and its
 * prefixes stay reserved. SHD (id 1, the built-in fallback) and the current
 * default cannot be deleted — pick another default first.
 */
export async function deleteDocumentProfile(id: number, byUserId: number): Promise<void> {
  if (id === SHD_PROFILE_ID) throw new HttpError(400, 'โปรไฟล์ SHD เป็นโปรไฟล์หลักของระบบ ลบไม่ได้ (ปิดใช้งานได้)');
  await db.transaction(async (tx) => {
    await tx.execute(lockProfiles());
    const [before] = await tx.select().from(documentProfile).where(eq(documentProfile.id, id)).limit(1);
    if (!before || before.deletedAt) throw new HttpError(404, 'ไม่พบโปรไฟล์');
    if (before.isDefault)
      throw new HttpError(400, 'โปรไฟล์นี้เป็นค่าเริ่มต้นอยู่ ตั้งโปรไฟล์อื่นเป็นค่าเริ่มต้นก่อนแล้วค่อยลบ');
    // any document ever issued under this profile? (stops at the first hit)
    const hadDocuments =
      (await tx.select({ id: job.documentProfileId }).from(job).where(eq(job.documentProfileId, id)).limit(1)).length >
        0 ||
      (
        await tx
          .select({ id: quotationHd.documentProfileId })
          .from(quotationHd)
          .where(eq(quotationHd.documentProfileId, id))
          .limit(1)
      ).length > 0 ||
      (
        await tx
          .select({ id: saleOutHd.documentProfileId })
          .from(saleOutHd)
          .where(eq(saleOutHd.documentProfileId, id))
          .limit(1)
      ).length > 0;
    await tx
      .update(documentProfile)
      .set({ deletedAt: nowThai(), deletedBy: byUserId, isDefault: false, updatedAt: nowThai() })
      .where(eq(documentProfile.id, id));
    await audit(tx, byUserId, {
      action: 'DELETE',
      module: 'Admin',
      entity: 'document_profile',
      key: id,
      summary: `ลบโปรไฟล์ผู้ออกเอกสาร ${before.code} — ${before.nameTh}${hadDocuments ? ' (เคยออกเอกสารแล้ว เอกสารเดิมยังพิมพ์ได้)' : ''}`,
      changes: { deletedAt: [before.deletedAt, nowThai()] }, // before.deletedAt is null here (checked above)
    });
  });
  invalidate('docprofiles:');
}

/** the parsed body of the save route (documentProfileSave in src/server/contract/admin.ts) */
export type DocumentProfileInput = z.output<typeof documentProfileSave.body>;

/** document-type prefixes are system-wide (see db/running-no.ts) — stored on the row only because the columns are NOT NULL */
const SYSTEM_PREFIXES = { prefixJob: 'J', prefixQuotation: 'Q', prefixSaleOrder: 'SO' } as const;

export async function saveDocumentProfile(i: DocumentProfileInput, byUserId: number): Promise<DocumentProfile> {
  assertValid(documentProfileSchema, i); // same rules as the page: errors under each field
  const code = cleanCode(i.code);
  const nameTh = clean(i.nameTh);

  // cleaned values — the schema checked them against the columns, nothing is cut off
  const values = {
    code,
    nameTh,
    nameEn: clean(i.nameEn),
    addressLine1: clean(i.addressLine1),
    addressLine2: clean(i.addressLine2),
    phone: clean(i.phone),
    email: clean(i.email).toLowerCase(),
    taxId: taxIdDigits(i.taxId),
    bankName: clean(i.bankName),
    bankAccountType: clean(i.bankAccountType),
    bankAccountNo: clean(i.bankAccountNo),
    bankAccountName: clean(i.bankAccountName),
    ...SYSTEM_PREFIXES,
    isDefault: !!i.isDefault,
    isActive: i.isActive !== false,
    sortOrder: Number(i.sortOrder ?? 0) || 0,
    updatedAt: nowThai(),
  };

  const saved = await db.transaction(async (tx) => {
    await tx.execute(lockProfiles());
    // the short code is what dropdowns show — unique among LIVE profiles (a deleted one frees its code)
    const others = await tx
      .select()
      .from(documentProfile)
      .where(and(isNull(documentProfile.deletedAt), i.id ? ne(documentProfile.id, i.id) : undefined));
    for (const o of others) {
      if (o.code === code) {
        const msg = `รหัสโปรไฟล์ ${code} ถูกใช้แล้ว (${o.nameTh})`;
        throw new HttpError(409, msg, { fields: { code: msg } });
      }
    }
    // a new profile with no order of its own goes last, not first (0)
    if (!i.id && !values.sortOrder) values.sortOrder = Math.max(0, ...others.map((o) => o.sortOrder)) + 1;

    let before: Row | undefined;
    if (i.id) {
      [before] = await tx.select().from(documentProfile).where(eq(documentProfile.id, i.id)).for('update');
      if (!before || before.deletedAt) throw new HttpError(404, 'ไม่พบโปรไฟล์');
      // the form as it loaded the profile: a field another admin saved since → 409 stale, nothing written
      const loaded: Record<string, unknown> = i.expect ?? {};
      const now: Record<string, unknown> = toProfile(before);
      if (Object.keys(values).some((k) => loaded[k] != null && loaded[k] !== now[k]))
        throw new HttpError(409, 'ผู้ดูแลระบบคนอื่นเพิ่งแก้รายการนี้ — โหลดหน้าใหม่แล้วแก้อีกครั้ง', { stale: true });
      if (before.isDefault && values.isDefault === false)
        throw new HttpError(400, 'ต้องมีโปรไฟล์เริ่มต้น 1 รายการ — ตั้งรายการอื่นเป็นเริ่มต้นก่อน');
      if (before.isDefault && values.isActive === false) throw new HttpError(400, 'ปิดใช้งานโปรไฟล์เริ่มต้นไม่ได้');
    }
    if (values.isDefault)
      await tx
        .update(documentProfile)
        .set({ isDefault: false })
        .where(i.id ? ne(documentProfile.id, i.id) : undefined);

    let row: Row | undefined;
    if (before) {
      [row] = await tx.update(documentProfile).set(values).where(eq(documentProfile.id, before.id)).returning();
    } else {
      [row] = await tx.insert(documentProfile).values(values).returning();
    }
    if (!row) throw new HttpError(404, 'ไม่พบโปรไฟล์');
    await audit(tx, byUserId, {
      action: before ? 'UPDATE' : 'CREATE',
      module: 'Admin',
      entity: 'document_profile',
      key: row.id,
      summary: `${before ? 'แก้ไข' : 'เพิ่ม'}โปรไฟล์ผู้ออกเอกสาร ${row.code} ${row.nameTh}`,
      changes: diff(before ?? null, values),
    });
    return toProfile(row);
  });
  invalidate('docprofiles:'); // after the commit — dropped inside, a read in between would cache the old row again
  return saved;
}

/** returns the logo path it replaced (read under the row lock — the caller removes that file after the commit) */
export async function setDocumentProfileLogo(id: number, logoPath: string, byUserId: number): Promise<string> {
  const old = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(documentProfile).where(eq(documentProfile.id, id)).for('update');
    if (!before) throw new HttpError(404, 'ไม่พบโปรไฟล์');
    await tx.update(documentProfile).set({ logoPath, updatedAt: nowThai() }).where(eq(documentProfile.id, id));
    await audit(tx, byUserId, {
      action: 'UPDATE',
      module: 'Admin',
      entity: 'document_profile',
      key: id,
      summary: `เปลี่ยนโลโก้โปรไฟล์ ${before.code}`,
      changes: { logoPath: [before.logoPath, logoPath] },
    });
    return before.logoPath;
  });
  invalidate('docprofiles:');
  return old;
}

/* ------------------------------------------------------------------ *
 * Change "ออกเอกสารในนาม" of an existing document — allowed at any time; the
 * number never changes (numbers are not brand-specific). Audited under the
 * document's own module so it shows in the job's history.
 * ------------------------------------------------------------------ */
export type DocumentKind = 'job' | 'quotation' | 'sale_order';
const DOC = {
  job: {
    table: job,
    key: job.jobNo,
    col: job.documentProfileId,
    module: 'Job Management',
    entity: 'job',
    label: 'งาน',
  },
  quotation: {
    table: quotationHd,
    key: quotationHd.quotationNo,
    col: quotationHd.documentProfileId,
    module: 'Quotation',
    entity: 'quotation_hd',
    label: 'ใบเสนอราคา',
  },
  sale_order: {
    table: saleOutHd,
    key: saleOutHd.saleOutHdNo,
    col: saleOutHd.documentProfileId,
    module: 'Sale Order',
    entity: 'sale_out_hd',
    label: 'ใบสั่งขาย',
  },
} as const;
export const DOC_MODULE: Record<DocumentKind, 'Job Management' | 'Quotation' | 'Sale Order'> = {
  job: 'Job Management',
  quotation: 'Quotation',
  sale_order: 'Sale Order',
};

export async function setDocumentProfile(
  kind: DocumentKind,
  no: string,
  profileId: number,
  byUserId: number,
): Promise<DocumentProfile> {
  const d = DOC[kind];
  return db.transaction(async (tx) => {
    await tx.execute(lockProfiles(true)); // the target is not deleted / deactivated until this commits
    const target = await issuingProfile(profileId); // must exist, be active and not deleted
    const [row] = await tx.select({ cur: d.col }).from(d.table).where(eq(d.key, no)).for('update');
    if (!row) throw new HttpError(404, `ไม่พบ${d.label} ${no}`);
    const cur = row.cur ?? SHD_PROFILE_ID;
    if (cur === target.id) return target;
    const from = await getDocumentProfile(cur);
    await tx.update(d.table).set({ documentProfileId: target.id }).where(eq(d.key, no));
    await audit(tx, byUserId, {
      action: 'UPDATE',
      module: d.module,
      entity: d.entity,
      key: no,
      summary: `เปลี่ยนออกเอกสารในนาม ${d.label} ${no}: ${from?.code ?? cur} → ${target.code}`,
      changes: { documentProfileId: [cur, target.id] },
    });
    return target;
  });
}
