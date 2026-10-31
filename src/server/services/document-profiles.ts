import 'server-only';
import type { z } from 'zod';
import type { documentProfileSave } from '@/server/contract/admin';
import { cached, invalidate, TTL_MASTER } from '@/server/cache';
import { asc, eq, ne, and, isNull, sql, type SQL } from 'drizzle-orm';
import { db, writeTx } from '@/db/client';
import { documentProfile, job, jobStatus, quotation, saleOrder } from '@/db/schema';
import { HttpError } from '@/server/auth';
import { assertValid } from '@/server/validate';
import { documentProfileSchema } from '@/lib/validation/admin';
import { taxIdDigits } from '@/lib/validation/customer';
import { clean, cleanCode } from '@/lib/validation';
import { audit, diff } from '@/server/audit';
import { nowThai } from '@/server/mappers/format';
import { RS } from '@/server/record-status';
import { AS, JOB_GROUP } from '@/lib/status-ids';
import { WAITING_CREATOR_ONLY } from '@/lib/validation/sale-order';
import { profileLock, type DocumentKind } from '@/lib/profile-lock';

/**
 * "ออกเอกสารในนาม" — the company/brand whose letterhead a job, quotation or sale order is printed with. SHD is the
 * built-in fallback; a NULL profile id is SHD. Document NUMBERS are NOT brand-specific (one J / Q / SO series, as
 * legacy); prefix_* columns always hold J / Q / SO. The profile can change until the document is approved / closed.
 */
export type DocumentProfile = {
  /** the row's uuid — document rows store its `pk` (issuingProfile, profileIdOf) */
  id: string;
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
  /** 'document' = an issuer (ออกเอกสารในนาม) · 'pick_slip' = only the header of ใบเบิกสินค้า */
  purpose: ProfilePurpose;
};
export const PROFILE_PURPOSES = ['document', 'pick_slip'] as const;
export type ProfilePurpose = (typeof PROFILE_PURPOSES)[number];

/** the built-in profile: legacy documents (no profile) print under it; it cannot be deleted or lose this code */
export const SHD_CODE = 'SHD';
/** the profile a new document is issued under: `pk` is what job / quotation / sale_order store — never sent */
export type IssuingProfile = DocumentProfile & { pk: number };
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
    purpose: r.purpose === 'pick_slip' ? 'pick_slip' : 'document',
  };
}

/** true = the issuer list (the ออกเอกสารในนาม choosers, login / track letterhead): active 'document' profiles;
 *  false = every live profile, pick slip ones too (the admin page) */
export function listDocumentProfiles(activeOnly = true): Promise<DocumentProfile[]> {
  return cached(`docprofiles:${activeOnly}`, TTL_MASTER, () => loadDocumentProfiles(activeOnly));
}
async function loadDocumentProfiles(activeOnly: boolean): Promise<DocumentProfile[]> {
  const rows = await db
    .select()
    .from(documentProfile)
    .where(
      and(
        isNull(documentProfile.deletedAt),
        activeOnly ? and(eq(documentProfile.isActive, true), eq(documentProfile.purpose, 'document')) : undefined,
      ),
    )
    .orderBy(asc(documentProfile.sortOrder), asc(documentProfile.pk));
  return rows.map(toProfile);
}

/** ใบเบิกสินค้า's header: the active pick slip profile (IPA), null = none (the slip falls back to the quotation's) */
export async function pickSlipProfile(): Promise<DocumentProfile | null> {
  const [r] = await db
    .select()
    .from(documentProfile)
    .where(
      and(
        eq(documentProfile.purpose, 'pick_slip'),
        eq(documentProfile.isActive, true),
        isNull(documentProfile.deletedAt),
      ),
    )
    .orderBy(asc(documentProfile.sortOrder), asc(documentProfile.pk))
    .limit(1);
  return r ? toProfile(r) : null;
}

/** every profile's uuid by pk — deleted ones too (their documents still print) — and SHD's row */
const profileKeys = () =>
  cached('docprofiles:keys', TTL_MASTER, async () => {
    const rows = await db
      .select({
        pk: documentProfile.pk,
        id: documentProfile.id,
        code: documentProfile.code,
        gone: documentProfile.deletedAt,
      })
      .from(documentProfile)
      .orderBy(asc(documentProfile.pk));
    const shd = rows.find((r) => r.code === SHD_CODE && !r.gone);
    return { byPk: new Map(rows.map((r) => [r.pk, r.id])), shd };
  });
const noShd = () => new HttpError(500, 'ไม่พบโปรไฟล์ผู้ออกเอกสาร SHD (document_profile ยังไม่ได้ migrate)');

/** SHD's uuid — what a document without a profile (legacy rows) is issued under */
export async function shdProfileId(): Promise<string> {
  const { shd } = await profileKeys();
  if (!shd) throw noShd();
  return shd.id;
}

/** the uuid of the profile a document row stores (`document_profile_pk`); NULL (legacy) = SHD's */
export async function profileIdOf(pk: number | null | undefined): Promise<string> {
  if (pk == null) return shdProfileId();
  // a profile added since the map was read (another instance, a test's insert) is read itself
  return (await profileKeys()).byPk.get(pk) ?? (await rowWhere(eq(documentProfile.pk, pk)))?.id ?? shdProfileId();
}

const rowWhere = async (where: SQL) => (await db.select().from(documentProfile).where(where).limit(1))[0];
const shdRow = () => rowWhere(and(eq(documentProfile.code, SHD_CODE), isNull(documentProfile.deletedAt))!);

/** the profile with uuid `id`; none given = SHD */
export async function getDocumentProfile(id: string | null | undefined): Promise<DocumentProfile | null> {
  const r = id ? await rowWhere(eq(documentProfile.id, id)) : await shdRow();
  return r ? toProfile(r) : null;
}

/** Profile a document should print with: its own (uuid), else the default (SHD). */
export async function profileForDocument(id: string | null | undefined): Promise<DocumentProfile> {
  const p = (await getDocumentProfile(id)) ?? (await getDocumentProfile(null));
  if (!p) throw noShd();
  return p;
}

const defaultRow = async () =>
  (
    await db
      .select()
      .from(documentProfile)
      .where(
        and(eq(documentProfile.isDefault, true), eq(documentProfile.isActive, true), isNull(documentProfile.deletedAt)),
      )
      .orderBy(asc(documentProfile.sortOrder), asc(documentProfile.pk))
      .limit(1)
  )[0] ?? (await shdRow());

export async function defaultDocumentProfile(): Promise<DocumentProfile> {
  const r = await defaultRow();
  if (!r) throw noShd();
  return toProfile(r);
}

/**
 * Resolve the profile to issue a NEW document under: the requested one if it is
 * active, else the default. Throws when an explicit one is unknown / inactive so
 * a stale dropdown never silently falls back to another brand's number series.
 * `requested`: a uuid (from the API), or a pk (the job's own profile, read from its row).
 */
export async function issuingProfile(requested: string | number | null | undefined): Promise<IssuingProfile> {
  const r = !requested
    ? await defaultRow()
    : await rowWhere(
        typeof requested === 'number' ? eq(documentProfile.pk, requested) : eq(documentProfile.id, requested),
      );
  if (!r) throw requested ? new HttpError(400, 'โปรไฟล์ผู้ออกเอกสารที่เลือกไม่พร้อมใช้งาน') : noShd();
  // a pick slip profile (IPA) issues nothing
  if (requested && (!r.isActive || r.deletedAt || r.purpose !== 'document'))
    throw new HttpError(400, 'โปรไฟล์ผู้ออกเอกสารที่เลือกไม่พร้อมใช้งาน');
  return { ...toProfile(r), pk: r.pk };
}

/**
 * Soft delete: the row stays so documents issued under it keep printing and its
 * prefixes stay reserved. SHD (the built-in fallback) and the current
 * default cannot be deleted — pick another default first.
 */
export async function deleteDocumentProfile(id: string, byUserId: number): Promise<void> {
  await writeTx(async (tx) => {
    await tx.execute(lockProfiles());
    const [before] = await tx.select().from(documentProfile).where(eq(documentProfile.id, id)).limit(1);
    if (!before || before.deletedAt) throw new HttpError(404, 'ไม่พบโปรไฟล์');
    if (before.code === SHD_CODE)
      throw new HttpError(400, 'โปรไฟล์ SHD เป็นโปรไฟล์หลักของระบบ ลบไม่ได้ (ปิดใช้งานได้)');
    if (before.isDefault)
      throw new HttpError(400, 'โปรไฟล์นี้เป็นค่าเริ่มต้นอยู่ ตั้งโปรไฟล์อื่นเป็นค่าเริ่มต้นก่อนแล้วค่อยลบ');
    // any document ever issued under this profile? (stops at the first hit)
    const hadDocuments =
      (await tx.select({ id: job.documentProfilePk }).from(job).where(eq(job.documentProfilePk, before.pk)).limit(1))
        .length > 0 ||
      (
        await tx
          .select({ id: quotation.documentProfilePk })
          .from(quotation)
          .where(eq(quotation.documentProfilePk, before.pk))
          .limit(1)
      ).length > 0 ||
      (
        await tx
          .select({ id: saleOrder.documentProfilePk })
          .from(saleOrder)
          .where(eq(saleOrder.documentProfilePk, before.pk))
          .limit(1)
      ).length > 0;
    await tx
      .update(documentProfile)
      .set({ deletedAt: nowThai(), deletedByAppUserPk: byUserId, isDefault: false, updatedAt: nowThai() })
      .where(eq(documentProfile.pk, before.pk));
    await audit(tx, byUserId, {
      action: 'DELETE',
      module: 'Admin',
      entity: 'document_profile',
      key: id,
      no: before.code,
      summary: `ลบโปรไฟล์ผู้ออกเอกสาร ${before.code} — ${before.nameTh}${hadDocuments ? ' (เคยออกเอกสารแล้ว เอกสารเดิมยังพิมพ์ได้)' : ''}`,
      changes: { deletedAt: [before.deletedAt, nowThai()] }, // before.deletedAt is null here (checked above)
    });
  });
  invalidate('docprofiles:');
}

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
    ...(i.purpose ? { purpose: i.purpose } : {}), // left out = as stored ('document' for a new one)
    sortOrder: Number(i.sortOrder ?? 0) || 0,
    updatedAt: nowThai(),
  };

  const saved = await writeTx(async (tx) => {
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
      // documents without a profile (legacy) print under SHD — found by this code
      if (before.code === SHD_CODE && code !== SHD_CODE)
        throw new HttpError(400, 'เปลี่ยนรหัสโปรไฟล์ SHD ไม่ได้', {
          fields: { code: 'เปลี่ยนรหัสโปรไฟล์ SHD ไม่ได้' },
        });
      // the form as it loaded the profile: a field another admin saved since → 409 stale, nothing written
      const loaded: Record<string, unknown> = i.expect ?? {};
      const now: Record<string, unknown> = toProfile(before);
      if (Object.keys(values).some((k) => loaded[k] != null && loaded[k] !== now[k]))
        throw new HttpError(409, 'ผู้ดูแลระบบคนอื่นเพิ่งแก้รายการนี้ — โหลดหน้าใหม่แล้วแก้อีกครั้ง', { stale: true });
      if (before.isDefault && values.isDefault === false)
        throw new HttpError(400, 'ต้องมีโปรไฟล์เริ่มต้น 1 รายการ — ตั้งรายการอื่นเป็นเริ่มต้นก่อน');
      if (before.isDefault && values.isActive === false) throw new HttpError(400, 'ปิดใช้งานโปรไฟล์เริ่มต้นไม่ได้');
    }
    // the default issues every document raised without a choice — a pick slip header never does
    if (values.isDefault && (values.purpose ?? before?.purpose) === 'pick_slip')
      throw new HttpError(400, 'โปรไฟล์หัวใบเบิกสินค้าตั้งเป็นค่าเริ่มต้นไม่ได้', {
        fields: { purpose: 'โปรไฟล์ค่าเริ่มต้นต้องเป็น "ออกเอกสาร"' },
      });
    if (values.isDefault)
      await tx
        .update(documentProfile)
        .set({ isDefault: false })
        .where(i.id ? ne(documentProfile.id, i.id) : undefined);

    let row: Row | undefined;
    if (before) {
      [row] = await tx.update(documentProfile).set(values).where(eq(documentProfile.pk, before.pk)).returning();
    } else {
      [row] = await tx.insert(documentProfile).values(values).returning();
    }
    if (!row) throw new HttpError(404, 'ไม่พบโปรไฟล์');
    await audit(tx, byUserId, {
      action: before ? 'UPDATE' : 'CREATE',
      module: 'Admin',
      entity: 'document_profile',
      key: row.id,
      no: row.code,
      summary: `${before ? 'แก้ไข' : 'เพิ่ม'}โปรไฟล์ผู้ออกเอกสาร ${row.code} ${row.nameTh}`,
      changes: diff(before ?? null, values),
    });
    return toProfile(row);
  });
  invalidate('docprofiles:'); // after the commit — dropped inside, a read in between would cache the old row again
  return saved;
}

/** returns the logo path it replaced (read under the row lock — the caller removes that file after the commit) */
export async function setDocumentProfileLogo(id: string, logoPath: string, byUserId: number): Promise<string> {
  const old = await writeTx(async (tx) => {
    const [before] = await tx.select().from(documentProfile).where(eq(documentProfile.id, id)).for('update');
    if (!before) throw new HttpError(404, 'ไม่พบโปรไฟล์');
    await tx.update(documentProfile).set({ logoPath, updatedAt: nowThai() }).where(eq(documentProfile.pk, before.pk));
    await audit(tx, byUserId, {
      action: 'UPDATE',
      module: 'Admin',
      entity: 'document_profile',
      key: id,
      no: before.code,
      summary: `เปลี่ยนโลโก้โปรไฟล์ ${before.code}`,
      changes: { logoPath: [before.logoPath, logoPath] },
    });
    return before.logoPath;
  });
  invalidate('docprofiles:');
  return old;
}

// Change "ออกเอกสารในนาม" of an existing document until it is approved / closed (409); the number never changes.
// Audited under the document's own module so it shows in its history.
export type { DocumentKind };
export { DOC_MODULE } from '@/lib/profile-lock';
const DOC = {
  job: {
    table: job,
    key: job.jobNo,
    col: job.documentProfilePk,
    status: job.jobStatusId,
    rs: job.recordStatus,
    module: 'Job Management',
    entity: 'job',
    label: 'งาน',
  },
  quotation: {
    table: quotation,
    key: quotation.quotationNo,
    col: quotation.documentProfilePk,
    status: quotation.quotationStatusId,
    rs: quotation.recordStatus,
    module: 'Quotation',
    entity: 'quotation',
    label: 'ใบเสนอราคา',
  },
  sale_order: {
    table: saleOrder,
    key: saleOrder.saleOrderNo,
    col: saleOrder.documentProfilePk,
    status: saleOrder.approveStatusId,
    rs: saleOrder.recordStatus,
    module: 'Sale Order',
    entity: 'sale_order',
    label: 'ใบสั่งขาย',
  },
} as const;

export async function setDocumentProfile(
  kind: DocumentKind,
  no: string,
  /** the profile's uuid */
  profileId: string,
  byUserId: number,
  byAdmin = false,
): Promise<IssuingProfile> {
  const d = DOC[kind];
  return writeTx(async (tx) => {
    await tx.execute(lockProfiles(true)); // the target is not deleted / deactivated until this commits
    const target = await issuingProfile(profileId); // must exist, be active and not deleted
    const [row] = await tx
      .select({ cur: d.col, status: d.status, rs: d.rs })
      .from(d.table)
      .where(eq(d.key, no))
      .for('update');
    if (!row) throw new HttpError(404, `ไม่พบ${d.label} ${no}`);
    // approved / closed: what the customer got stays as printed — read under the row lock, so a decision racing this waits
    const [g] =
      kind === 'job' && row.status != null
        ? await tx
            .select({ group: jobStatus.jobStatusGroup })
            .from(jobStatus)
            .where(eq(jobStatus.jobStatusId, row.status))
        : [];
    const locked = profileLock(kind, {
      statusId: row.status,
      cancelled: row.rs === RS.DELETED,
      closed: g?.group?.trim() === JOB_GROUP.FINISHED,
    });
    if (locked) throw new HttpError(409, locked);
    // a sale order waiting for approval is its creator's alone, as its save (sale-orders.ts saveSaleOrder)
    if (kind === 'sale_order' && row.status === AS.WAIT && !byAdmin) {
      const [so] = await tx
        .select({ by: saleOrder.createdByAppUserPk })
        .from(saleOrder)
        .where(eq(saleOrder.saleOrderNo, no));
      if (so?.by !== byUserId) throw new HttpError(403, WAITING_CREATOR_ONLY);
    }
    const cur = await profileIdOf(row.cur); // NULL (legacy) = SHD
    if (cur === target.id) return target;
    const from = await getDocumentProfile(cur);
    await tx.update(d.table).set({ documentProfilePk: target.pk }).where(eq(d.key, no));
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
