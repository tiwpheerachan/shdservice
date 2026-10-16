import 'server-only';
import { cached, TTL_STATIC } from '@/server/cache';
import { and, asc, count, desc, eq, gt, ilike, or, sql } from 'drizzle-orm';
import { orderBy, likeTerm, offsetOf, totalOf, type Page, type PageQuery } from '@/server/paging';
import { db } from '@/db/client';
import type { Tx } from '@/db/client';
import { customer, mtCity, mtDistrict, mtSubDistrict, appUser } from '@/db/schema';
import type { Customer } from '@/data/mock';
import { HttpError, fullName } from '@/server/auth';
import { assertVersion } from '@/server/http-error';
import { nowThai, str, fmtDateTime } from '@/server/mappers/format';
import { nextRunningNo } from '@/db/running-no';
import { audit, diff } from '@/server/audit';
import { statusFilter, uiStatus, fromUiStatus, statusStamp, type StatusMode } from '@/server/record-status';
import {
  customerSchema,
  conflictErrors,
  localPhone,
  normalizePhone,
  phoneDigitVariants,
  taxIdDigits,
  withPrefix,
} from '@/lib/validation/customer';
import { clean } from '@/lib/validation';
import { assertValid } from '@/server/validate';

export type DeletedMode = StatusMode;

type Row = typeof customer.$inferSelect;

/** Legacy `use_price_group` values ↔ UI labels. */
export const PRICE_GROUP_LABEL: Record<string, string> = {
  Retail: 'ขายปลีก (Retail Price)',
  Wholesale: 'ขายส่ง (Wholesale Price)',
  Special: 'ราคาพิเศษ (Special Price)',
};
const PRICE_GROUP_VALUE: Record<string, string> = Object.fromEntries(
  Object.entries(PRICE_GROUP_LABEL).map(([k, v]) => [v, k]),
);

export function toCustomer(r: Row, createdBy = ''): Customer {
  return {
    createdDate: fmtDateTime(r.createdDate),
    createdBy,
    code: r.customerCode ?? '',
    name: r.customerName ?? '',
    address: r.customerAddress ?? '',
    phone: r.phoneNumber ?? '',
    email: r.email ?? '',
    line: r.lineId ?? '',
    taxId: r.customerCardId ?? '',
    status: uiStatus(r.recordStatus),
    // extra DB-backed fields (optional on the UI type)
    id: r.customerId,
    type: r.customerType ?? 'Normal',
    online: r.isCustomerOnline !== false,
    address1: r.customerAddress1 ?? '',
    address2: r.customerAddress2 ?? '',
    cityId: r.cityId ?? -1,
    districtId: r.districtId ?? -1,
    subDistrictId: r.subDistrictId ?? -1,
    postalCode: r.postalCode ?? '',
    priceGroup: PRICE_GROUP_LABEL[r.usePriceGroup ?? 'Retail'] ?? PRICE_GROUP_LABEL.Retail,
    version: r.rowVersion,
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
  code: f.code,
  name: f.name,
  phone: f.phone,
  email: f.email,
  taxId: f.taxId,
  type: f.type,
  province: f.province,
  status: f.status,
});

export async function listCustomers(
  opts: {
    q?: string;
    deleted?: DeletedMode;
    limit?: number;
    filters?: CustomerFilters;
  } = {},
): Promise<Customer[]> {
  const { q = '', deleted = 'exclude', limit = 500, filters = {} } = opts;
  const rows = await db
    .select()
    .from(customer)
    .where(customerWhere(q, deleted, filters))
    .orderBy(desc(customer.customerId))
    .limit(Math.min(limit, 20000)); // 20k = the Excel export cap (src/server/export.ts)
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

/**
 * Phone match on DIGITS only, both sides: ~30% of legacy numbers are stored "081-4969925" /
 * "081 496 9925", so "0814969925" never matched an ilike (dogfood 2026-10-14). Same rule as
 * /track; backed by the trigram expression index in drizzle/0024.
 */
const phoneDigits = sql`regexp_replace(coalesce(${customer.phoneNumber}, ''), '\\D', '', 'g')`;
// "+66 89 999 3466" typed → also "0899993466", and "0899993466" also finds a stored "+66 89 999 3466"
const phoneHas = (digits: string) =>
  or(...phoneDigitVariants(digits).map((d) => sql`${phoneDigits} LIKE ${'%' + d + '%'}`));

function customerWhere(q: string, deleted: DeletedMode, f: CustomerFilters = {}) {
  const active = statusFilter(customer.recordStatus, deleted);
  const term = q.trim();
  const termDigits = term.replace(/\D/g, '');
  const search = term
    ? or(
        ilike(customer.customerCode, likeTerm(term)),
        ilike(customer.customerName, likeTerm(term)),
        ilike(customer.phoneNumber, likeTerm(term)),
        termDigits.length >= 4 ? phoneHas(termDigits) : undefined,
        ilike(customer.email, likeTerm(term)),
        ilike(customer.customerCardId, likeTerm(term)),
      )
    : undefined;
  const like = (v?: string) => (v && v.trim() ? likeTerm(v.trim()) : null);
  const phone = f.phone ? f.phone.replace(/\D/g, '') : '';
  return and(
    active,
    search,
    like(f.code) ? ilike(customer.customerCode, like(f.code)!) : undefined,
    like(f.name) ? ilike(customer.customerName, like(f.name)!) : undefined,
    phone ? phoneHas(phone) : undefined,
    like(f.email) ? ilike(customer.email, like(f.email)!) : undefined,
    like(f.taxId) ? ilike(customer.customerCardId, like(f.taxId)!) : undefined,
    f.type ? eq(customer.customerType, f.type) : undefined,
    f.province && /^\d+$/.test(f.province) ? eq(customer.cityId, Number(f.province)) : undefined,
    f.status === 'Active'
      ? eq(customer.recordStatus, 'ACTIVE')
      : f.status === 'Inactive'
        ? eq(customer.recordStatus, 'INACTIVE')
        : undefined,
  );
}

/** Server-side page for the customer list (43k rows). */
export async function pageCustomers(
  p: PageQuery,
  deleted: DeletedMode = 'exclude',
  f: CustomerFilters = {},
): Promise<Page<Customer>> {
  const w = customerWhere(p.q, deleted, f);
  // count + page in parallel: the response takes max(count, rows) instead of their sum
  const [counted, rows] = await Promise.all([
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
  return {
    rows: rows.map((r) => toCustomer(r.c, fullName(r.f, r.l))),
    total: totalOf(counted),
    page: p.page,
    pageSize: p.pageSize,
  };
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
  /** row_version the edit form loaded: another save since → 409; absent = no check */
  version?: number;
};

/** Build the legacy single-line address from the parts (what the old app did). */
async function composeAddress(tx: Tx, i: CustomerInput): Promise<string> {
  const parts: string[] = [str(i.address1), str(i.address2)];
  if (i.subDistrictId && i.subDistrictId > 0) {
    const [sd] = await tx
      .select({ n: mtSubDistrict.nameTh })
      .from(mtSubDistrict)
      .where(eq(mtSubDistrict.subDistrictId, i.subDistrictId));
    if (sd) parts.push(withPrefix(i.cityId === 10 ? 'แขวง' : 'ต.', sd.n));
  }
  if (i.districtId && i.districtId > 0) {
    const [d] = await tx
      .select({ n: mtDistrict.nameTh })
      .from(mtDistrict)
      .where(eq(mtDistrict.districtId, i.districtId));
    if (d) parts.push(withPrefix(i.cityId === 10 ? 'เขต' : 'อ.', d.n));
  }
  if (i.cityId && i.cityId > 0) {
    const [c] = await tx.select({ n: mtCity.nameTh }).from(mtCity).where(eq(mtCity.cityId, i.cityId));
    if (c) parts.push(withPrefix(i.cityId === 10 ? '' : 'จ.', c.n));
  }
  parts.push(str(i.postalCode));
  return parts.filter(Boolean).join(' ').slice(0, 200);
}

/** ตำบล / อำเภอ / จังหวัด names for a customer's ids — blanks when not picked (legacy customers). */
export async function addressNames(
  c: { cityId?: number; districtId?: number; subDistrictId?: number } | null | undefined,
) {
  const pick = async (q: Promise<{ n: string }[]> | null) => (q ? ((await q)[0]?.n ?? '') : '');
  const sdId = c?.subDistrictId ?? 0,
    dId = c?.districtId ?? 0,
    cId = c?.cityId ?? 0;
  const [subDistrict, district, province] = await Promise.all([
    pick(
      sdId > 0
        ? db
            .select({ n: mtSubDistrict.nameTh })
            .from(mtSubDistrict)
            .where(eq(mtSubDistrict.subDistrictId, sdId))
            .limit(1)
        : null,
    ),
    pick(
      dId > 0
        ? db.select({ n: mtDistrict.nameTh }).from(mtDistrict).where(eq(mtDistrict.districtId, dId)).limit(1)
        : null,
    ),
    pick(cId > 0 ? db.select({ n: mtCity.nameTh }).from(mtCity).where(eq(mtCity.cityId, cId)).limit(1) : null),
  ]);
  return { subDistrict, district, province };
}

export type CustomerConflict = {
  field: 'phone' | 'email' | 'taxId';
  value: string;
  code: string;
  name: string;
  phone: string;
  email: string;
  taxId: string;
};

const digits = (v: unknown) => str(v).replace(/\D/g, '');
const normEmail = (v: unknown) => str(v).toLowerCase();

/**
 * Identity fields that may never be shared by two customers: phone, email, tax/citizen id.
 * Compared after normalisation (digits only / lower-case); DELETED rows are ignored;
 * `excludeCode` = the row being edited.
 */
export async function findCustomerConflicts(
  v: { phone?: string; email?: string; taxId?: string },
  excludeCode?: string,
): Promise<CustomerConflict[]> {
  const phone = digits(v.phone);
  const email = normEmail(v.email);
  const taxId = digits(v.taxId);
  const checks: { field: CustomerConflict['field']; value: string; cond: ReturnType<typeof sql> }[] = [];
  if (phone.length >= 6)
    checks.push({
      field: 'phone',
      value: phone,
      cond: or(...phoneDigitVariants(phone).map((d) => sql`${phoneDigits} = ${d}`))!, // +66 … = 0 …
    });
  if (email)
    checks.push({ field: 'email', value: email, cond: sql`lower(trim(coalesce(${customer.email},''))) = ${email}` });
  if (taxId.length >= 5)
    checks.push({
      field: 'taxId',
      value: taxId,
      cond: sql`regexp_replace(coalesce(${customer.customerCardId},''), '\\D', '', 'g') = ${taxId}`,
    });
  if (!checks.length) return [];
  const out: CustomerConflict[] = [];
  for (const c of checks) {
    const rows = await db
      .select({
        code: customer.customerCode,
        name: customer.customerName,
        phone: customer.phoneNumber,
        email: customer.email,
        taxId: customer.customerCardId,
      })
      .from(customer)
      .where(
        and(
          c.cond,
          sql`${customer.recordStatus} <> 'DELETED'`,
          excludeCode ? sql`${customer.customerCode} <> ${excludeCode}` : undefined,
        ),
      )
      .limit(5);
    for (const r of rows)
      out.push({
        field: c.field,
        value: c.value,
        code: r.code ?? '',
        name: r.name ?? '',
        phone: r.phone ?? '',
        email: r.email ?? '',
        taxId: r.taxId ?? '',
      });
  }
  return out;
}

/** The columns a save writes from the form, cleaned (phone / one-line address / status apart). */
function columnsOf(i: CustomerInput) {
  const taxId = taxIdDigits(i.taxId);
  return {
    customerName: clean(i.name),
    // digits only; a legacy value nobody changed (not 13 digits) is kept as it was
    customerCardId: /^\d{13}$/.test(taxId) ? taxId : clean(i.taxId),
    customerType: clean(i.type) || 'Normal',
    isCustomerOnline: i.online !== false,
    customerAddress1: clean(i.address1),
    customerAddress2: clean(i.address2),
    cityId: i.cityId ?? -1,
    districtId: i.districtId ?? -1,
    // the postal code is NOT checked against mt_sub_district.postal_code: the master is wrong for many
    // ตำบล (every Mueang Chiang Mai one says 50000; real 50200 / 50300) — the form only hints at a difference
    subDistrictId: i.subDistrictId ?? -1,
    postalCode: clean(i.postalCode),
    email: clean(i.email).toLowerCase(),
    lineId: clean(i.line),
    usePriceGroup: PRICE_GROUP_VALUE[clean(i.priceGroup)] ?? (clean(i.priceGroup) || 'Retail'),
  };
}
/** the parts customer_address is built from */
const ADDRESS_PARTS = ['customerAddress1', 'customerAddress2', 'cityId', 'districtId', 'subDistrictId', 'postalCode'];

/** Create/update a customer. New codes come from running "Customer" (C00001). */
export async function saveCustomer(i: CustomerInput, byUserId: number): Promise<Customer> {
  const prev = i.code ? await getCustomerByCode(i.code) : null;
  // same rules as the form (lib/validation/customer); unchanged legacy values still save
  assertValid(customerSchema(prev), i);
  const name = clean(i.name);
  // an untouched phone is kept exactly as stored; a new / changed one is cleaned and written 0-prefixed
  const phone =
    prev && normalizePhone(prev.phone) === normalizePhone(i.phone)
      ? prev.phone
      : localPhone(clean(normalizePhone(i.phone)));
  const taxId = taxIdDigits(i.taxId);

  // uniqueness: block a NEW customer that reuses phone / email / tax id; on edit only
  // the fields that actually change are checked (legacy data already holds duplicates)
  const check = {
    phone: !prev || digits(prev.phone) !== digits(phone) ? phone : undefined,
    email: !prev || normEmail(prev.email) !== normEmail(i.email) ? str(i.email) : undefined,
    taxId: !prev || digits(prev.taxId) !== digits(i.taxId) ? taxId : undefined,
  };
  const conflicts = await findCustomerConflicts(check, i.code);
  const [first] = conflicts;
  if (first) {
    const label = { phone: 'เบอร์โทรศัพท์', email: 'อีเมล', taxId: 'เลขบัตร/ผู้เสียภาษี' };
    // an edit is not "creating" anything: it says whose number it is
    const message = prev
      ? `${label[first.field]}นี้เป็นของลูกค้า ${first.code} ${first.name} แล้ว`
      : `${label[first.field]}นี้มีลูกค้าอยู่แล้ว (${first.code} ${first.name}) — ห้ามสร้างซ้ำ`;
    throw new HttpError(409, message, { conflicts, fields: conflictErrors(conflicts) });
  }

  return db.transaction(async (tx) => {
    // cleaned values (customerSchema checked their length against the columns — nothing is cut)
    const cols = { ...columnsOf(i), phoneNumber: phone };
    const address = () =>
      composeAddress(tx, { ...i, address1: cols.customerAddress1, address2: cols.customerAddress2 });
    const status = fromUiStatus(i.status);
    if (i.code) {
      const [before] = await tx.select().from(customer).where(eq(customer.customerCode, i.code)).for('update');
      if (!before) throw new HttpError(404, 'customer not found');
      assertVersion(i.version, before.rowVersion);
      // "never worse": only what really changes is written. The stored row goes through the same cleaning
      // as the form (which shows a legacy address-only row's address in บรรทัด 1) — equal → the stored value
      // stays as it is (a legacy trailing space); saved unchanged = no UPDATE, no audit, no row_version bump
      const shown = toCustomer(before);
      const was: Record<string, unknown> = {
        ...columnsOf({ ...shown, address1: shown.address1 || shown.address }),
        phoneNumber: shown.phone,
      };
      const set: Partial<typeof customer.$inferInsert> = Object.fromEntries(
        Object.entries(cols).filter(([k, v]) => v !== was[k]),
      );
      // the one-line address is re-built only when one of its parts changes (a legacy one stays as typed)
      if (ADDRESS_PARTS.some((k) => k in set)) set.customerAddress = await address();
      if (uiStatus(before.recordStatus) !== uiStatus(status)) Object.assign(set, statusStamp(status, byUserId));
      if (!Object.keys(set).length) return shown;
      const [row] = await tx.update(customer).set(set).where(eq(customer.customerId, before.customerId)).returning();
      await audit(tx, byUserId, {
        action: 'UPDATE',
        module: 'Customer',
        entity: 'customer',
        key: i.code,
        summary: `แก้ไขลูกค้า ${name}`,
        changes: diff(before as Record<string, unknown>, set as Record<string, unknown>),
      });
      return toCustomer(row!);
    }
    const code = await nextRunningNo(tx, 'Customer');
    const [row] = await tx
      .insert(customer)
      .values({
        ...cols,
        customerAddress: await address(),
        ...statusStamp(status, byUserId),
        customerCode: code,
        createdDate: nowThai(),
        createBy: byUserId,
        faxNumber: '',
      })
      .returning();
    if (!row) throw new Error('customer insert returned no row');
    await audit(tx, byUserId, {
      action: 'CREATE',
      module: 'Customer',
      entity: 'customer',
      key: code,
      summary: `เพิ่มลูกค้า ${name} · ${phone}`,
    });
    return toCustomer(row);
  });
}

/* Address master data for cascading dropdowns */
export function listProvinces() {
  return cached('provinces', TTL_STATIC, () =>
    // city_id -1 is the legacy "not chosen" row with an empty name — never a choice
    db
      .select({ id: mtCity.cityId, name: mtCity.nameTh })
      .from(mtCity)
      .where(gt(mtCity.cityId, 0))
      .orderBy(asc(mtCity.nameTh)),
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
