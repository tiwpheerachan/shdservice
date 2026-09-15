import "server-only";
import { and, asc, count, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { orderBy, offsetOf, type Page, type PageQuery } from "@/server/paging";
import { db } from "@/db/client";
import type { Tx } from "@/db/client";
import { customer, mtCity, mtDistrict, mtSubDistrict } from "@/db/schema";
import type { Customer } from "@/data/mock";
import { HttpError } from "@/server/auth";
import { nowThai, str } from "@/server/mappers/format";
import { nextRunningNo } from "@/db/running-no";

export type DeletedMode = "exclude" | "only" | "all";

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

export function toCustomer(r: Row): Customer {
  return {
    code: r.customerCode ?? "",
    name: r.customerName ?? "",
    address: r.customerAddress ?? "",
    phone: r.phoneNumber ?? "",
    email: r.email ?? "",
    line: r.lineId ?? "",
    taxId: r.customerCardId ?? "",
    status: r.isActive === false ? "Inactive" : "Active",
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
export async function listCustomers(opts: {
  q?: string;
  deleted?: DeletedMode;
  limit?: number;
} = {}): Promise<Customer[]> {
  const { q = "", deleted = "exclude", limit = 500 } = opts;
  const active =
    deleted === "exclude" ? ne(customer.isActive, false) : deleted === "only" ? eq(customer.isActive, false) : undefined;
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
  const rows = await db
    .select()
    .from(customer)
    .where(and(active, search))
    .orderBy(desc(customer.customerId))
    .limit(Math.min(limit, 5000));
  return rows.map(toCustomer);
}

const SORT = {
  code: customer.customerCode,
  name: customer.customerName,
  phone: customer.phoneNumber,
  email: customer.email,
  status: customer.isActive,
  address: customer.customerAddress,
};

function customerWhere(q: string, deleted: DeletedMode) {
  const active =
    deleted === "exclude" ? ne(customer.isActive, false) : deleted === "only" ? eq(customer.isActive, false) : undefined;
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
  return and(active, search);
}

/** Server-side page for the customer list (43k rows). */
export async function pageCustomers(p: PageQuery, deleted: DeletedMode = "exclude"): Promise<Page<Customer>> {
  const w = customerWhere(p.q, deleted);
  const [{ total }] = await db.select({ total: count() }).from(customer).where(w);
  const rows = await db
    .select()
    .from(customer)
    .where(w)
    .orderBy(...orderBy(p.sort, SORT, [desc(customer.customerId)]))
    .limit(p.pageSize)
    .offset(offsetOf(p));
  return { rows: rows.map(toCustomer), total: Number(total), page: p.page, pageSize: p.pageSize };
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

/** Create/update a customer. New codes come from running "Customer" (C00001). */
export async function saveCustomer(i: CustomerInput, byUserId: number): Promise<Customer> {
  const name = str(i.name).slice(0, 200);
  if (!name) throw new HttpError(400, "ต้องระบุชื่อลูกค้า");
  const phone = str(i.phone).slice(0, 50);
  if (!phone && !i.code) throw new HttpError(400, "ต้องระบุเบอร์โทรศัพท์");

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
      isActive: (i.status ?? "Active") !== "Inactive",
    };
    if (i.code) {
      const [row] = await tx.update(customer).set(values).where(eq(customer.customerCode, i.code)).returning();
      if (!row) throw new HttpError(404, "customer not found");
      return toCustomer(row);
    }
    const code = await nextRunningNo(tx, "Customer");
    const [row] = await tx
      .insert(customer)
      .values({ ...values, customerCode: code, createdDate: nowThai(), createBy: byUserId, faxNumber: "" })
      .returning();
    return toCustomer(row);
  });
}

/* Address master data for cascading dropdowns */
export async function listProvinces() {
  return db.select({ id: mtCity.cityId, name: mtCity.nameTh }).from(mtCity).orderBy(asc(mtCity.nameTh));
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
