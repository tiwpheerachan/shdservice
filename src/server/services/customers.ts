import "server-only";
import { cached, TTL_STATIC } from "@/server/cache";
import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { orderBy, offsetOf, type Page, type PageQuery } from "@/server/paging";
import { db } from "@/db/client";
import type { Tx } from "@/db/client";
import { customer, mtCity, mtDistrict, mtSubDistrict, appUser } from "@/db/schema";
import type { Customer } from "@/data/mock";
import { HttpError, fullName } from "@/server/auth";
import { nowThai, str, fmtDateTime } from "@/server/mappers/format";
import { nextRunningNo } from "@/db/running-no";
import { audit, diff } from "@/server/audit";
import { statusFilter, uiStatus, fromUiStatus, statusStamp, type StatusMode } from "@/server/record-status";

export type DeletedMode = StatusMode;

type Row = typeof customer.$inferSelect;

/** Legacy `use_price_group` values ↔ UI labels. */
export const PRICE_GROUP_LABEL: Record<string, string> = {
  Retail: "ขายปลีก (Retail Price)",
  Wholesale: "ขายส่ง (Wholesale Price)",
  Special: "ราคาพิเศษ (Special Price)",
};
const PRICE_GROUP_VALUE: Record<string, string> = Object.fromEntries(
  Object.entries(PRICE_GROUP_LABEL).map(([k, v]) => [v, k])
);

export function toCustomer(r: Row, createdBy = ""): Customer {
  return {
    createdDate: fmtDateTime(r.createdDate),
    createdBy,
    code: r.customerCode ?? "",
    name: r.customerName ?? "",
    address: r.customerAddress ?? "",
    phone: r.phoneNumber ?? "",
    email: r.email ?? "",
    line: r.lineId ?? "",
    taxId: r.customerCardId ?? "",
    status: uiStatus(r.recordStatus),
    // extra DB-backed fields (optional on the UI type)
    id: r.customerId,
    type: r.customerType ?? "Normal",
    online: r.isCustomerOnline !== false,
    address1: r.customerAddress1 ?? "",
    address2: r.customerAddress2 ?? "",
    cityId: r.cityId ?? -1,
    districtId: r.districtId ?? -1,
    subDistrictId: r.subDistrictId ?? -1,
    postalCode: r.postalCode ?? "",
    priceGroup: PRICE_GROUP_LABEL[r.usePriceGroup ?? "Retail"] ?? PRICE_GROUP_LABEL.Retail,
  };
}

/**
 * Customer list. 43k rows in the legacy DB, so the default is the most recent
 * `limit`; `q` searches code / name / phone / email / tax id server-side.
 */
/** filter bar of the ข้อมูลลูกค้า page — AND-ed; text fields are partial matches */
export type CustomerFilters = {
  code?: string;
  name?: string;
  phone?: string;
  email?: string;
  taxId?: string;
  type?: string; // Normal | Corporate | Dealer
  province?: string; // mt_city.city_id
  status?: string; // Active | Inactive
};
export const customerFiltersFromQuery = (f: Record<string, string>): CustomerFilters => ({
  code: f.code, name: f.name, phone: f.phone, email: f.email, taxId: f.taxId, type: f.type, province: f.province, status: f.status,
});

export async function listCustomers(opts: {
  q?: string;
  deleted?: DeletedMode;
  limit?: number;
  filters?: CustomerFilters;
} = {}): Promise<Customer[]> {
  const { q = "", deleted = "exclude", limit = 500, filters = {} } = opts;
  const rows = await db
    .select()
    .from(customer)
    .where(customerWhere(q, deleted, filters))
    .orderBy(desc(customer.customerId))
    .limit(Math.min(limit, 5000));
  return rows.map((r) => toCustomer(r));
}

const SORT = {
  code: customer.customerCode,
  name: customer.customerName,
  phone: customer.phoneNumber,
  email: customer.email,
  status: customer.recordStatus,
  address: customer.customerAddress,
};

function customerWhere(q: string, deleted: DeletedMode, f: CustomerFilters = {}) {
  const active = statusFilter(customer.recordStatus, deleted);
  const term = q.trim();
  const search = term
    ? or(
        ilike(customer.customerCode, `%${term}%`),
        ilike(customer.customerName, `%${term}%`),
        ilike(customer.phoneNumber, `%${term}%`),
        ilike(customer.email, `%${term}%`),
        ilike(customer.customerCardId, `%${term}%`)
      )
    : undefined;
  const like = (v?: string) => (v && v.trim() ? `%${v.trim()}%` : null);
  const phone = f.phone ? f.phone.replace(/\D/g, "") : "";
  return and(
    active,
    search,
    like(f.code) ? ilike(customer.customerCode, like(f.code)!) : undefined,
    like(f.name) ? ilike(customer.customerName, like(f.name)!) : undefined,
    phone ? ilike(customer.phoneNumber, `%${phone}%`) : undefined,
    like(f.email) ? ilike(customer.email, like(f.email)!) : undefined,
    like(f.taxId) ? ilike(customer.customerCardId, like(f.taxId)!) : undefined,
    f.type ? eq(customer.customerType, f.type) : undefined,
    f.province && /^\d+$/.test(f.province) ? eq(customer.cityId, Number(f.province)) : undefined,
    f.status === "Active" ? eq(customer.recordStatus, "ACTIVE") : f.status === "Inactive" ? eq(customer.recordStatus, "INACTIVE") : undefined
  );
}

/** Server-side page for the customer list (43k rows). */
export async function pageCustomers(p: PageQuery, deleted: DeletedMode = "exclude", f: CustomerFilters = {}): Promise<Page<Customer>> {
  const w = customerWhere(p.q, deleted, f);
  // count + page in parallel: the response takes max(count, rows) instead of their sum
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(customer).where(w),
    db
      .select({ c: customer, f: appUser.firstName, l: appUser.lastName })
      .from(customer)
      .leftJoin(appUser, eq(appUser.userId, customer.createBy))
      .where(w)
      .orderBy(...orderBy(p.sort, SORT, [desc(customer.customerId)]))
      .limit(p.pageSize)
      .offset(offsetOf(p)),
  ]);
  return { rows: rows.map((r) => toCustomer(r.c, fullName(r.f, r.l))), total: Number(total), page: p.page, pageSize: p.pageSize };
}

export async function getCustomerByCode(code: string): Promise<Customer | null> {
  const rows = await db.select().from(customer).where(eq(customer.customerCode, code)).limit(1);
  return rows[0] ? toCustomer(rows[0]) : null;
}

export async function getCustomerById(id: number): Promise<Customer | null> {
  const rows = await db.select().from(customer).where(eq(customer.customerId, id)).limit(1);
  return rows[0] ? toCustomer(rows[0]) : null;
}

export type CustomerInput = {
  code?: string;
  name: string;
  taxId?: string;
  type?: string;
  online?: boolean;
  address1?: string;
  address2?: string;
  cityId?: number;
  districtId?: number;
  subDistrictId?: number;
  postalCode?: string;
  phone: string;
  email?: string;
  line?: string;
  priceGroup?: string;
  status?: string;
};

/** Build the legacy single-line address from the parts (what the old app did). */
async function composeAddress(tx: Tx, i: CustomerInput): Promise<string> {
  const parts: string[] = [str(i.address1), str(i.address2)];
  if (i.subDistrictId && i.subDistrictId > 0) {
    const [sd] = await tx.select({ n: mtSubDistrict.nameTh }).from(mtSubDistrict).where(eq(mtSubDistrict.subDistrictId, i.subDistrictId));
    if (sd) parts.push((i.cityId === 10 ? "แขวง" : "ต.") + sd.n);
  }
  if (i.districtId && i.districtId > 0) {
    const [d] = await tx.select({ n: mtDistrict.nameTh }).from(mtDistrict).where(eq(mtDistrict.districtId, i.districtId));
    if (d) parts.push((i.cityId === 10 ? "เขต" : "อ.") + d.n);
  }
  if (i.cityId && i.cityId > 0) {
    const [c] = await tx.select({ n: mtCity.nameTh }).from(mtCity).where(eq(mtCity.cityId, i.cityId));
    if (c) parts.push((i.cityId === 10 ? "" : "จ.") + c.n);
  }
  parts.push(str(i.postalCode));
  return parts.filter(Boolean).join(" ").slice(0, 200);
}

/** ตำบล / อำเภอ / จังหวัด names for a customer's ids — blanks when not picked (legacy customers). */
export async function addressNames(c: { cityId?: number; districtId?: number; subDistrictId?: number } | null | undefined) {
  const pick = async (q: Promise<{ n: string }[]> | null) => (q ? ((await q)[0]?.n ?? "") : "");
  const sdId = c?.subDistrictId ?? 0, dId = c?.districtId ?? 0, cId = c?.cityId ?? 0;
  const [subDistrict, district, province] = await Promise.all([
    pick(sdId > 0 ? db.select({ n: mtSubDistrict.nameTh }).from(mtSubDistrict).where(eq(mtSubDistrict.subDistrictId, sdId)).limit(1) : null),
    pick(dId > 0 ? db.select({ n: mtDistrict.nameTh }).from(mtDistrict).where(eq(mtDistrict.districtId, dId)).limit(1) : null),
    pick(cId > 0 ? db.select({ n: mtCity.nameTh }).from(mtCity).where(eq(mtCity.cityId, cId)).limit(1) : null),
  ]);
  return { subDistrict, district, province };
}

export type CustomerConflict = { field: "phone" | "email" | "taxId"; value: string; code: string; name: string; phone: string; email: string; taxId: string };

const digits = (v: unknown) => str(v).replace(/\D/g, "");
const normEmail = (v: unknown) => str(v).toLowerCase();

/**
 * Identity fields that may never be shared by two customers: phone, email, tax/citizen id.
 * Compared after normalisation (digits only / lower-case); DELETED rows are ignored;
 * `excludeCode` = the row being edited.
 */
export async function findCustomerConflicts(
  v: { phone?: string; email?: string; taxId?: string },
  excludeCode?: string
): Promise<CustomerConflict[]> {
  const phone = digits(v.phone);
  const email = normEmail(v.email);
  const taxId = digits(v.taxId);
  const checks: { field: CustomerConflict["field"]; value: string; cond: ReturnType<typeof sql> }[] = [];
  if (phone.length >= 6) checks.push({ field: "phone", value: phone, cond: sql`regexp_replace(coalesce(${customer.phoneNumber},''), '\\D', '', 'g') = ${phone}` });
  if (email) checks.push({ field: "email", value: email, cond: sql`lower(trim(coalesce(${customer.email},''))) = ${email}` });
  if (taxId.length >= 5) checks.push({ field: "taxId", value: taxId, cond: sql`regexp_replace(coalesce(${customer.customerCardId},''), '\\D', '', 'g') = ${taxId}` });
  if (!checks.length) return [];
  const out: CustomerConflict[] = [];
  for (const c of checks) {
    const rows = await db
      .select({ code: customer.customerCode, name: customer.customerName, phone: customer.phoneNumber, email: customer.email, taxId: customer.customerCardId })
      .from(customer)
      .where(and(c.cond, sql`${customer.recordStatus} <> 'DELETED'`, excludeCode ? sql`${customer.customerCode} <> ${excludeCode}` : undefined))
      .limit(5);
    for (const r of rows) out.push({ field: c.field, value: c.value, code: r.code ?? "", name: r.name ?? "", phone: r.phone ?? "", email: r.email ?? "", taxId: r.taxId ?? "" });
  }
  return out;
}

/** Create/update a customer. New codes come from running "Customer" (C00001). */
export async function saveCustomer(i: CustomerInput, byUserId: number): Promise<Customer> {
  const name = str(i.name).slice(0, 200);
  if (!name) throw new HttpError(400, "ต้องระบุชื่อลูกค้า");
  const phone = str(i.phone).slice(0, 50);
  if (!phone && !i.code) throw new HttpError(400, "ต้องระบุเบอร์โทรศัพท์");

  // uniqueness: block a NEW customer that reuses phone / email / tax id; on edit only
  // the fields that actually change are checked (legacy data already holds duplicates)
  const prev = i.code ? await getCustomerByCode(i.code) : null;
  const check = {
    phone: !prev || digits(prev.phone) !== digits(phone) ? phone : undefined,
    email: !prev || normEmail(prev.email) !== normEmail(i.email) ? str(i.email) : undefined,
    taxId: !prev || digits(prev.taxId) !== digits(i.taxId) ? str(i.taxId) : undefined,
  };
  const conflicts = await findCustomerConflicts(check, i.code);
  if (conflicts.length) {
    const label = { phone: "เบอร์โทรศัพท์", email: "อีเมล", taxId: "เลขบัตร/ผู้เสียภาษี" };
    const first = conflicts[0];
    throw new HttpError(409, `${label[first.field]}นี้มีลูกค้าอยู่แล้ว (${first.code} ${first.name}) — ห้ามสร้างซ้ำ`, { conflicts });
  }

  return db.transaction(async (tx) => {
    const values = {
      customerName: name,
      customerCardId: str(i.taxId).slice(0, 20),
      customerType: str(i.type) || "Normal",
      isCustomerOnline: i.online !== false,
      customerAddress: await composeAddress(tx, i),
      customerAddress1: str(i.address1).slice(0, 100),
      customerAddress2: str(i.address2).slice(0, 100),
      cityId: i.cityId ?? -1,
      districtId: i.districtId ?? -1,
      subDistrictId: i.subDistrictId ?? -1,
      postalCode: str(i.postalCode).slice(0, 5),
      phoneNumber: phone,
      email: str(i.email).slice(0, 50),
      lineId: str(i.line).slice(0, 50),
      usePriceGroup: PRICE_GROUP_VALUE[str(i.priceGroup)] ?? (str(i.priceGroup) || "Retail"),
      ...statusStamp(fromUiStatus(i.status), byUserId),
    };
    if (i.code) {
      const [before] = await tx.select().from(customer).where(eq(customer.customerCode, i.code));
      const [row] = await tx.update(customer).set(values).where(eq(customer.customerCode, i.code)).returning();
      if (!row) throw new HttpError(404, "customer not found");
      await audit(tx, byUserId, { action: "UPDATE", module: "Customer", entity: "customer", key: i.code, summary: `แก้ไขลูกค้า ${name}`, changes: diff(before as Record<string, unknown>, values as Record<string, unknown>) });
      return toCustomer(row);
    }
    const code = await nextRunningNo(tx, "Customer");
    const [row] = await tx
      .insert(customer)
      .values({ ...values, customerCode: code, createdDate: nowThai(), createBy: byUserId, faxNumber: "" })
      .returning();
    await audit(tx, byUserId, { action: "CREATE", module: "Customer", entity: "customer", key: code, summary: `เพิ่มลูกค้า ${name} · ${phone}` });
    return toCustomer(row);
  });
}

/* Address master data for cascading dropdowns */
export function listProvinces() {
  return cached("provinces", TTL_STATIC, () =>
    db.select({ id: mtCity.cityId, name: mtCity.nameTh }).from(mtCity).orderBy(asc(mtCity.nameTh))
  );
}
export async function listDistricts(cityId: number) {
  return db
    .select({ id: mtDistrict.districtId, name: mtDistrict.nameTh })
    .from(mtDistrict)
    .where(eq(mtDistrict.cityId, cityId))
    .orderBy(asc(mtDistrict.nameTh));
}
export async function listSubDistricts(districtId: number) {
  return db
    .select({ id: mtSubDistrict.subDistrictId, name: mtSubDistrict.nameTh, postal: mtSubDistrict.postalCode })
    .from(mtSubDistrict)
    .where(eq(mtSubDistrict.districtId, districtId))
    .orderBy(asc(mtSubDistrict.nameTh));
}

export { sql };
