import "server-only";
import { cached, invalidate, TTL_MASTER } from "@/server/cache";
import { asc, eq, ne, and, sql, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { documentProfile } from "@/db/schema";
import { HttpError } from "@/server/auth";
import { audit, diff } from "@/server/audit";
import { nowThai } from "@/server/mappers/format";

/**
 * "ออกเอกสารในนาม" — the company/brand a quotation, sale order or job is issued
 * under (drizzle/0007). SHD is id 1 and the default; documents with a NULL
 * profile id are SHD. Prefixes feed the per-profile running numbers.
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
  prefixJob: string;
  prefixQuotation: string;
  prefixSaleOrder: string;
  isDefault: boolean;
  isActive: boolean;
  isDeleted: boolean;
  sortOrder: number;
};

export const SHD_PROFILE_ID = 1;
const BUILTIN_LOGO = "/logo-shd-mark.png";

type Row = typeof documentProfile.$inferSelect;
function toProfile(r: Row): DocumentProfile {
  return {
    id: r.id,
    code: r.code,
    nameTh: r.nameTh,
    nameEn: r.nameEn,
    addressLine1: r.addressLine1,
    addressLine2: r.addressLine2,
    address: [r.addressLine1, r.addressLine2].filter(Boolean).join(" "),
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
    prefixJob: r.prefixJob,
    prefixQuotation: r.prefixQuotation,
    prefixSaleOrder: r.prefixSaleOrder,
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
  const [r] = await db.select().from(documentProfile).where(eq(documentProfile.id, id && id > 0 ? id : SHD_PROFILE_ID)).limit(1);
  return r ? toProfile(r) : null;
}

/** Profile a document should print with: its own, else the default (SHD). */
export async function profileForDocument(id: number | null | undefined): Promise<DocumentProfile> {
  const p = (await getDocumentProfile(id)) ?? (await getDocumentProfile(SHD_PROFILE_ID));
  if (!p) throw new HttpError(500, "ไม่พบโปรไฟล์ผู้ออกเอกสาร (document_profile ยังไม่ได้ migrate)");
  return p;
}

export async function defaultDocumentProfile(): Promise<DocumentProfile> {
  const [r] = await db
    .select()
    .from(documentProfile)
    .where(and(eq(documentProfile.isDefault, true), eq(documentProfile.isActive, true), isNull(documentProfile.deletedAt)))
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
  if (!p || !p.isActive || p.isDeleted) throw new HttpError(400, "โปรไฟล์ผู้ออกเอกสารที่เลือกไม่พร้อมใช้งาน");
  return p;
}

/**
 * Soft delete: the row stays so documents issued under it keep printing and its
 * prefixes stay reserved. SHD (id 1, the built-in fallback) and the current
 * default cannot be deleted — pick another default first.
 */
export async function deleteDocumentProfile(id: number, byUserId: number): Promise<void> {
  if (id === SHD_PROFILE_ID) throw new HttpError(400, "โปรไฟล์ SHD เป็นโปรไฟล์หลักของระบบ ลบไม่ได้ (ปิดใช้งานได้)");
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(documentProfile).where(eq(documentProfile.id, id)).limit(1);
    if (!before || before.deletedAt) throw new HttpError(404, "ไม่พบโปรไฟล์");
    if (before.isDefault) throw new HttpError(400, "โปรไฟล์นี้เป็นค่าเริ่มต้นอยู่ ตั้งโปรไฟล์อื่นเป็นค่าเริ่มต้นก่อนแล้วค่อยลบ");
    const issued = await tx.execute(
      sql`select 1 from running_no where company_id = ${id} and running_type in ('Job','Quotation','SaleOrder') and number > 0 limit 1`
    );
    const hadDocuments = (issued.rows?.length ?? 0) > 0;
    await tx
      .update(documentProfile)
      .set({ deletedAt: nowThai(), deletedBy: byUserId, isDefault: false, updatedAt: nowThai() })
      .where(eq(documentProfile.id, id));
    await audit(tx, byUserId, {
      action: "DELETE",
      module: "Admin",
      entity: "document_profile",
      key: id,
      summary: `ลบโปรไฟล์ผู้ออกเอกสาร ${before.code} — ${before.nameTh}${hadDocuments ? " (เคยออกเอกสารแล้ว เอกสารเดิมยังพิมพ์ได้)" : ""}`,
      changes: { deletedAt: [null, nowThai()] },
    });
  });
  invalidate("docprofiles:");
}

export type DocumentProfileInput = {
  id?: number;
  code: string;
  nameTh: string;
  nameEn?: string;
  addressLine1?: string;
  addressLine2?: string;
  phone?: string;
  email?: string;
  taxId?: string;
  bankName?: string;
  bankAccountType?: string;
  bankAccountNo?: string;
  bankAccountName?: string;
  prefixJob: string;
  prefixQuotation: string;
  prefixSaleOrder: string;
  isDefault?: boolean;
  isActive?: boolean;
  sortOrder?: number;
};

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const PREFIX_RE = /^[A-Z]{1,6}$/;

export async function saveDocumentProfile(i: DocumentProfileInput, byUserId: number): Promise<DocumentProfile> {
  const code = str(i.code, 20).toUpperCase();
  const nameTh = str(i.nameTh);
  const prefixes = { prefixJob: str(i.prefixJob, 10).toUpperCase(), prefixQuotation: str(i.prefixQuotation, 10).toUpperCase(), prefixSaleOrder: str(i.prefixSaleOrder, 10).toUpperCase() };
  if (!code) throw new HttpError(400, "ต้องระบุรหัสโปรไฟล์ (เช่น SHD)");
  if (!nameTh) throw new HttpError(400, "ต้องระบุชื่อบริษัท");
  for (const [k, v] of Object.entries(prefixes)) {
    if (!PREFIX_RE.test(v)) throw new HttpError(400, `prefix ${k === "prefixJob" ? "งานซ่อม" : k === "prefixQuotation" ? "ใบเสนอราคา" : "ใบสั่งขาย"} ต้องเป็นอักษร A–Z 1–6 ตัว`);
  }
  if (new Set(Object.values(prefixes)).size < 3) throw new HttpError(400, "prefix ของงานซ่อม / ใบเสนอราคา / ใบสั่งขาย ต้องต่างกัน");

  const values = {
    code,
    nameTh,
    nameEn: str(i.nameEn),
    addressLine1: str(i.addressLine1),
    addressLine2: str(i.addressLine2),
    phone: str(i.phone, 50),
    email: str(i.email, 100).toLowerCase(),
    taxId: str(i.taxId, 20),
    bankName: str(i.bankName, 100),
    bankAccountType: str(i.bankAccountType, 50),
    bankAccountNo: str(i.bankAccountNo, 50),
    bankAccountName: str(i.bankAccountName),
    ...prefixes,
    isDefault: !!i.isDefault,
    isActive: i.isActive !== false,
    sortOrder: Number(i.sortOrder ?? 0) || 0,
    updatedAt: nowThai(),
  };

  return db.transaction(async (tx) => {
    // uniqueness: code and each prefix must not belong to another profile (numbers are primary keys)
    const others = await tx.select().from(documentProfile).where(i.id ? ne(documentProfile.id, i.id) : undefined);
    for (const o of others) {
      if (o.code === code) throw new HttpError(409, `รหัสโปรไฟล์ ${code} ถูกใช้แล้ว (${o.nameTh})`);
      if (o.prefixJob === prefixes.prefixJob) throw new HttpError(409, `prefix งานซ่อม ${prefixes.prefixJob} ถูกใช้โดย ${o.code} แล้ว`);
      if (o.prefixQuotation === prefixes.prefixQuotation) throw new HttpError(409, `prefix ใบเสนอราคา ${prefixes.prefixQuotation} ถูกใช้โดย ${o.code} แล้ว`);
      if (o.prefixSaleOrder === prefixes.prefixSaleOrder) throw new HttpError(409, `prefix ใบสั่งขาย ${prefixes.prefixSaleOrder} ถูกใช้โดย ${o.code} แล้ว`);
    }

    let before: Row | undefined;
    if (i.id) {
      [before] = await tx.select().from(documentProfile).where(eq(documentProfile.id, i.id)).limit(1);
      if (!before || before.deletedAt) throw new HttpError(404, "ไม่พบโปรไฟล์");
      // prefixes are baked into every number already issued — freeze them once used
      // any running_no row for this profile with number > 0 means documents exist
      const used = await tx.execute(
        sql`select 1 from running_no where company_id = ${before.id} and running_type in ('Job','Quotation','SaleOrder') and number > 0 limit 1`
      );
      const frozen = (used.rows?.length ?? 0) > 0;
      if (frozen && (before.prefixJob !== prefixes.prefixJob || before.prefixQuotation !== prefixes.prefixQuotation || before.prefixSaleOrder !== prefixes.prefixSaleOrder)) {
        throw new HttpError(409, "โปรไฟล์นี้ออกเลขเอกสารไปแล้ว เปลี่ยน prefix ไม่ได้");
      }
      if (before.isDefault && values.isDefault === false) throw new HttpError(400, "ต้องมีโปรไฟล์เริ่มต้น 1 รายการ — ตั้งรายการอื่นเป็นเริ่มต้นก่อน");
      if (before.isDefault && values.isActive === false) throw new HttpError(400, "ปิดใช้งานโปรไฟล์เริ่มต้นไม่ได้");
    }
    if (values.isDefault) await tx.update(documentProfile).set({ isDefault: false }).where(i.id ? ne(documentProfile.id, i.id) : undefined);

    let row: Row;
    if (before) {
      [row] = await tx.update(documentProfile).set(values).where(eq(documentProfile.id, before.id)).returning();
    } else {
      [row] = await tx.insert(documentProfile).values(values).returning();
    }
    await audit(tx, byUserId, {
      action: before ? "UPDATE" : "CREATE",
      module: "Admin",
      entity: "document_profile",
      key: row.id,
      summary: `${before ? "แก้ไข" : "เพิ่ม"}โปรไฟล์ผู้ออกเอกสาร ${row.code} ${row.nameTh}`,
      changes: diff(before ?? null, values),
    });
    invalidate("docprofiles:");
    return toProfile(row);
  });
}

export async function setDocumentProfileLogo(id: number, logoPath: string, byUserId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(documentProfile).where(eq(documentProfile.id, id)).limit(1);
    if (!before) throw new HttpError(404, "ไม่พบโปรไฟล์");
    await tx.update(documentProfile).set({ logoPath, updatedAt: nowThai() }).where(eq(documentProfile.id, id));
    await audit(tx, byUserId, { action: "UPDATE", module: "Admin", entity: "document_profile", key: id, summary: `เปลี่ยนโลโก้โปรไฟล์ ${before.code}`, changes: { logoPath: [before.logoPath, logoPath] } });
  });
  invalidate("docprofiles:");
}
