import 'server-only';
import { cached, TTL_STATIC } from '@/server/cache';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { orderBy, likeTerm, offsetOf, totalOf, type Page, type PageQuery } from '@/server/paging';
import { db, writeTx } from '@/db/client';
import type { Db, Tx } from '@/db/client';
import { customer, province, district, subDistrict, appUser } from '@/db/schema';
import type { Customer } from '@/data/types';
import { HttpError, fullName } from '@/server/auth';
import { assertVersion } from '@/server/http-error';
import { nowThai, str, fmtDateTime } from '@/server/mappers/format';
import { nextRunningNo } from '@/db/running-no';
import { audit, diff, isUuid } from '@/server/audit';
import { RS, statusFilter, uiStatus, fromUiStatus, statusStamp, type StatusMode } from '@/server/record-status';
import {
  asciiDigits,
  customerSchema,
  conflictErrors,
  localPhone,
  normalizePhone,
  phoneDigitVariants,
  taxIdDigits,
  withPrefix,
  ADDRESS_PREFIXES,
} from '@/lib/validation/customer';
import { clean } from '@/lib/validation';
import { MAX_EXPORT_ROWS } from '@/lib/export-limit';
import { assertValid } from '@/server/validate';
import type { z } from 'zod';
import type { customerSave } from '@/server/contract/sales';
import { phonesIn } from '@/server/track-otp';
import { pkOf } from '@/server/ids';

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

/** the uuids and names of a customer's จังหวัด / อำเภอ / ตำบล (the API's address ids) — null = not picked */
type Places = {
  city: string | null;
  district: string | null;
  subDistrict: string | null;
  cityName: string | null;
  districtName: string | null;
  subDistrictName: string | null;
};

/** province.pk (= the legacy city_id) of กรุงเทพมหานคร: แขวง / เขต and no จ. prefix */
const BANGKOK_CITY_PK = 10;

/**
 * The one-line address, composed on read (customer_address is a legacy snapshot new / edited customers do not write):
 * address lines + ตำบล / อำเภอ / จังหวัด names + postal code. A row without address lines reads its stored text.
 */
function addressLine(r: Row, places?: Places): string {
  const bkk = r.provincePk === BANGKOK_CITY_PK;
  const named = (prefix: string, n: string | null | undefined) => (n ? withPrefix(prefix, n) : '');
  const line = [
    str(r.customerAddress1),
    str(r.customerAddress2),
    named(bkk ? 'แขวง' : 'ต.', places?.subDistrictName),
    named(bkk ? 'เขต' : 'อ.', places?.districtName),
    named(bkk ? '' : 'จ.', places?.cityName),
    str(r.postalCode),
  ]
    .filter(Boolean)
    .join(' ');
  if (str(r.customerAddress1) || str(r.customerAddress2)) return line;
  return r.customerAddress?.trim() || line;
}

/** withPrefix() in SQL: `prefix` + the name, unless it already starts with one of its level's prefixes */
function prefixedSql(name: SQL, prefix: string): SQL {
  if (!prefix) return name;
  const own = ADDRESS_PREFIXES.find((f) => f.includes(prefix)) ?? [prefix];
  const starts = sql.join(
    own.map((p) => sql`${p + '%'}`),
    sql`, `,
  );
  return sql`case when ${name} like any (array[${starts}]) then ${name} else ${prefix} || ${name} end`;
}
const placeSql = (table: 'sub_district' | 'district' | 'province', pk: SQL | AnyColumn) =>
  sql`(select nullif(btrim(t.name_th), '') from ${sql.raw(table)} t where t.pk = ${pk})`;

/**
 * addressLine() in SQL, for queries that read many customers at once (the sale report): the same composition and
 * prefixes — address lines + แขวง / ต., เขต / อ., จ. (none in Bangkok) + postal code, else the legacy stored text.
 * NULL when there is nothing (addressLine: '').
 */
export const customerAddressSql = (() => {
  const bkk = sql`${customer.provincePk} = ${BANGKOK_CITY_PK}`;
  const a1 = sql`nullif(btrim(${customer.customerAddress1}), '')`;
  const a2 = sql`nullif(btrim(${customer.customerAddress2}), '')`;
  const level = (table: 'sub_district' | 'district' | 'province', pk: AnyColumn, inBkk: string, other: string) =>
    sql`case when ${bkk} then ${prefixedSql(placeSql(table, pk), inBkk)} else ${prefixedSql(placeSql(table, pk), other)} end`;
  const line = sql`nullif(concat_ws(' ', ${a1}, ${a2},
    ${level('sub_district', customer.subDistrictPk, 'แขวง', 'ต.')},
    ${level('district', customer.districtPk, 'เขต', 'อ.')},
    ${level('province', customer.provincePk, '', 'จ.')},
    nullif(btrim(${customer.postalCode}), '')), '')`;
  return sql<string | null>`case when ${a1} is not null or ${a2} is not null then ${line}
    else coalesce(nullif(btrim(${customer.customerAddress}), ''), ${line}) end`;
})();

export function toCustomer(r: Row, createdBy = '', places?: Places): Customer {
  return {
    createdDate: fmtDateTime(r.createdDate),
    createdBy,
    code: r.customerCode ?? '',
    name: r.customerName ?? '',
    address: addressLine(r, places),
    phone: r.phoneNumber ?? '',
    email: r.email ?? '',
    line: r.lineId ?? '',
    taxId: r.customerCardId ?? '',
    status: uiStatus(r.recordStatus),
    // extra DB-backed fields (optional on the UI type)
    id: r.id,
    type: r.customerType ?? 'Normal',
    online: r.isCustomerOnline !== false,
    address1: r.customerAddress1 ?? '',
    address2: r.customerAddress2 ?? '',
    cityId: places?.city ?? undefined,
    districtId: places?.district ?? undefined,
    subDistrictId: places?.subDistrict ?? undefined,
    postalCode: r.postalCode ?? '',
    priceGroup: PRICE_GROUP_LABEL[r.usePriceGroup ?? 'Retail'] ?? PRICE_GROUP_LABEL.Retail,
    version: r.rowVersion,
  };
}

/** filter bar of the ข้อมูลลูกค้า page — AND-ed; text fields are partial matches */
export type CustomerFilters = {
  code?: string;
  name?: string;
  phone?: string;
  email?: string;
  taxId?: string;
  type?: string; // Normal | Corporate | Dealer
  province?: string; // province.id (uuid)
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

/** customer rows with their address uuids (not picked = NULL, joins nothing) and who created them */
const fromCustomer = (q: Db | Tx = db) =>
  q
    .select({
      c: customer,
      city: province.id,
      district: district.id,
      subDistrict: subDistrict.id,
      cityName: province.nameTh,
      districtName: district.nameTh,
      subDistrictName: subDistrict.nameTh,
      f: appUser.firstName,
      l: appUser.lastName,
    })
    .from(customer)
    .leftJoin(province, eq(province.pk, customer.provincePk))
    .leftJoin(district, eq(district.pk, customer.districtPk))
    .leftJoin(subDistrict, eq(subDistrict.pk, customer.subDistrictPk))
    .leftJoin(appUser, eq(appUser.pk, customer.createdByAppUserPk));
type Joined = Awaited<ReturnType<typeof fromCustomer>>[number];
const joined = (r: Joined, createdBy = '') => toCustomer(r.c, createdBy, r);
/** the one customer `w` finds (with its address uuids) */
async function oneCustomer(w: SQL | undefined, q: Db | Tx = db): Promise<Customer | null> {
  const [r] = await fromCustomer(q).where(w).limit(1);
  return r ? joined(r) : null;
}

/**
 * Customer list. 43k rows in the legacy DB, so the default is the most recent
 * `limit`; `q` searches code / name / phone / email / tax id server-side.
 */
export async function listCustomers(
  opts: {
    q?: string;
    deleted?: DeletedMode;
    limit?: number;
    filters?: CustomerFilters;
  } = {},
): Promise<Customer[]> {
  const { q = '', deleted = 'exclude', limit = 500, filters = {} } = opts;
  const rows = await fromCustomer()
    .where(customerWhere(q, deleted, filters))
    .orderBy(desc(customer.pk))
    .limit(Math.min(limit, MAX_EXPORT_ROWS));
  return rows.map((r) => joined(r));
}

const SORT = {
  code: customer.customerCode,
  name: customer.customerName,
  phone: customer.phoneNumber,
  email: customer.email,
  status: customer.recordStatus,
  // as addressLine() reads it (without the ต. / อ. / จ. prefixes — the order comes from the address lines first);
  // the place names come from fromCustomer's joins, which the paged rows query has
  address: sql`case when btrim(coalesce(${customer.customerAddress1}, '') || coalesce(${customer.customerAddress2}, '')) <> ''
    then concat_ws(' ', nullif(btrim(${customer.customerAddress1}), ''), nullif(btrim(${customer.customerAddress2}), ''),
      ${subDistrict.nameTh}, ${district.nameTh}, ${province.nameTh}, nullif(btrim(${customer.postalCode}), ''))
    else coalesce(btrim(${customer.customerAddress}), '') end`,
};

/**
 * Phone match on DIGITS only, both sides: ~30% of legacy numbers are stored "081-4969925" /
 * "081 496 9925", so "0814969925" would not match an ilike. Same rule as
 * /track; backed by the trigram expression index in drizzle/0024.
 */
const phoneDigits = sql`regexp_replace(coalesce(${customer.phoneNumber}, ''), '\\D', '', 'g')`;
const cardDigits = sql`regexp_replace(coalesce(${customer.customerCardId}, ''), '\\D', '', 'g')`;
/** digits only — Thai digits ๐-๙ typed in a search box count as 0-9 */
const digits = (v: unknown) => asciiDigits(str(v)).replace(/\D/g, '');
// "+66 89 999 3466" typed → also "0899993466", and "0899993466" also finds a stored "+66 89 999 3466"
const phoneHas = (digits: string) =>
  or(...phoneDigitVariants(digits).map((d) => sql`${phoneDigits} LIKE ${'%' + d + '%'}`));

/**
 * Name as clean() writes it — invisible characters dropped, any whitespace run (NBSP too) → one space: ~1,050
 * legacy names hold double spaces / zero-width marks and would not match an ilike of the typed name.
 * Backed by the expression trigram index gin_customer_name_clean (drizzle/0034) — keep the two character-for-character
 * identical, or the search falls back to a seq scan of 43k rows.
 */
const nameText = sql`regexp_replace(regexp_replace(${customer.customerName}, '[\\u200B-\\u200F\\u202A-\\u202E\\u2060\\uFEFF]', '', 'g'), '[\\s\\u00A0]+', ' ', 'g')`;

function customerWhere(q: string, deleted: DeletedMode, f: CustomerFilters = {}) {
  const active = statusFilter(customer.recordStatus, deleted);
  const term = q.trim();
  const termDigits = digits(term);
  const search = term
    ? or(
        ilike(customer.customerCode, likeTerm(term)),
        ilike(nameText, likeTerm(clean(term))),
        ilike(customer.phoneNumber, likeTerm(term)),
        termDigits.length >= 4 ? phoneHas(termDigits) : undefined,
        ilike(customer.email, likeTerm(term)),
        ilike(customer.customerCardId, likeTerm(term)),
        // a tax id typed with dashes ("0-1055-56616-06-9"), or a legacy one stored with them
        // gin_customer_card_id_digits (drizzle/0006) indexes this exact expression (cardDigits)
        termDigits.length >= 5 && /^[\d๐-๙\s-]+$/.test(term)
          ? sql`${cardDigits} LIKE ${likeTerm(termDigits)}`
          : undefined,
      )
    : undefined;
  const like = (v?: string) => (v && v.trim() ? likeTerm(v.trim()) : null);
  // digits only, both sides: "0-1055-…" typed finds it; a box with no digit at all finds nothing (not every row)
  const byDigits = (v: string | undefined, has: (d: string) => SQL | undefined) =>
    !str(v) ? undefined : digits(v) ? has(digits(v)) : sql`false`;
  return and(
    active,
    search,
    like(f.code) ? ilike(customer.customerCode, like(f.code)!) : undefined,
    clean(f.name) ? ilike(nameText, likeTerm(clean(f.name))) : undefined,
    byDigits(f.phone, phoneHas),
    like(f.email) ? ilike(customer.email, like(f.email)!) : undefined,
    byDigits(f.taxId, (d) => sql`${cardDigits} LIKE ${likeTerm(d)}`),
    f.type ? eq(customer.customerType, f.type) : undefined,
    f.province && isUuid(f.province)
      ? inArray(
          customer.provincePk,
          db.select({ c: province.pk }).from(province).where(eq(province.id, f.province.trim())),
        )
      : undefined,
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
    fromCustomer()
      .where(w)
      .orderBy(...orderBy(p.sort, SORT, [desc(customer.pk)]))
      .limit(p.pageSize)
      .offset(offsetOf(p)),
  ]);
  return {
    rows: rows.map((r) => joined(r, fullName(r.f, r.l))),
    total: totalOf(counted),
    page: p.page,
    pageSize: p.pageSize,
  };
}

/** `deleted`: 'exclude' for a picker (a deleted customer is System Admin's alone); 'all' for the documents already on it */
export async function getCustomerByCode(code: string, deleted: DeletedMode = 'all'): Promise<Customer | null> {
  return oneCustomer(and(eq(customer.customerCode, code), statusFilter(customer.recordStatus, deleted)));
}

/** by its uuid (the customers page's ?edit= link) — `deleted` as getCustomerByCode */
export function getCustomerByUuid(id: string, deleted: DeletedMode = 'all'): Promise<Customer | null> {
  return oneCustomer(and(eq(customer.id, id), statusFilter(customer.recordStatus, deleted)));
}

/**
 * The customer a document is written for: one deleted or set Inactive gets nothing new (409), but `current` (the
 * customer already on the document) still saves. `key` = customer.pk, for the document's FK column. Read FOR SHARE in
 * the document's write transaction so a concurrent delete / Inactive switch (FOR UPDATE) finishes first, or waits.
 */
export async function customerForDocument(
  tx: Tx,
  code: string,
  current?: number | string | null,
): Promise<(Customer & { key: number }) | null> {
  const [j] = await fromCustomer(tx).where(eq(customer.customerCode, code)).limit(1).for('share', { of: customer });
  if (!j) return null;
  const r = j.c;
  const found = { ...joined(j), key: r.pk };
  if (current === r.pk || current === r.customerCode) return found;
  if (r.recordStatus === RS.DELETED) throw new HttpError(409, 'ลูกค้ารายนี้ถูกลบแล้ว เลือกลูกค้ารายอื่น');
  if (r.recordStatus === RS.INACTIVE)
    throw new HttpError(409, 'ลูกค้ารายนี้ปิดใช้งาน (Inactive) — เปิดใช้งานก่อน หรือเลือกรายอื่น');
  return found;
}

/** by customer.pk (the internal key a job holds) */
export function getCustomerById(pk: number): Promise<Customer | null> {
  return oneCustomer(eq(customer.pk, pk));
}

export type CustomerInput = z.output<typeof customerSave.body>;

/** province / district / sub_district pks of the uuids a save sent; not picked = NULL (FK) */
type PlaceKeys = { provincePk: number | null; districtPk: number | null; subDistrictPk: number | null };
async function placeKeys(tx: Tx, i: CustomerInput): Promise<PlaceKeys> {
  // one after another: a transaction is one connection (pg: no second query while one runs)
  return {
    provincePk: i.cityId ? await pkOf(province, i.cityId, 'จังหวัด', tx) : null,
    districtPk: i.districtId ? await pkOf(district, i.districtId, 'เขต / อำเภอ', tx) : null,
    subDistrictPk: i.subDistrictId ? await pkOf(subDistrict, i.subDistrictId, 'แขวง / ตำบล', tx) : null,
  };
}

/** ตำบล / อำเภอ / จังหวัด names for a customer's address uuids (a Customer as getCustomerByCode returns it) —
 *  blanks when not picked (legacy customers). */
export async function addressNames(c: Pick<Customer, 'cityId' | 'districtId' | 'subDistrictId'> | null | undefined) {
  const pick = async (q: Promise<{ n: string }[]> | null) => (q ? ((await q)[0]?.n ?? '') : '');
  const sdId = c?.subDistrictId,
    dId = c?.districtId,
    cId = c?.cityId;
  const [sdName, dName, pName] = await Promise.all([
    pick(sdId ? db.select({ n: subDistrict.nameTh }).from(subDistrict).where(eq(subDistrict.id, sdId)).limit(1) : null),
    pick(dId ? db.select({ n: district.nameTh }).from(district).where(eq(district.id, dId)).limit(1) : null),
    pick(cId ? db.select({ n: province.nameTh }).from(province).where(eq(province.id, cId)).limit(1) : null),
  ]);
  return { subDistrict: sdName, district: dName, province: pName };
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

const normEmail = (v: unknown) => str(v).toLowerCase();

/**
 * Identity fields that may never be shared by two customers: phone, email, tax/citizen id.
 * Compared after normalisation (digits only / lower-case); DELETED rows are ignored;
 * `excludeCode` = the row being edited.
 */
export async function findCustomerConflicts(
  v: { phone?: string; email?: string; taxId?: string },
  excludeCode?: string,
  q: Tx | typeof db = db,
): Promise<CustomerConflict[]> {
  const phone = digits(v.phone);
  const email = normEmail(v.email);
  const taxId = digits(v.taxId);
  const checks: {
    field: CustomerConflict['field'];
    value: string;
    cond: ReturnType<typeof sql>;
    keep?: (r: { phone: string | null }) => boolean;
  }[] = [];
  if (phone.length >= 6) {
    // the whole field (+66 … = 0 …), or any mobile either side holds in a legacy "a / b" field: LIKE on the
    // 9 digits after the 0 finds candidates, phonesIn decides (never a number read across two numbers)
    const mobiles = [...phonesIn(str(v.phone))];
    checks.push({
      field: 'phone',
      value: phone,
      cond: or(
        ...phoneDigitVariants(phone).map((d) => sql`${phoneDigits} = ${d}`),
        ...mobiles.map((m) => sql`${phoneDigits} LIKE ${'%' + m.slice(1) + '%'}`),
      )!,
      keep: (r) => {
        const theirs = phonesIn(r.phone ?? '');
        return phoneDigitVariants(phone).includes(digits(r.phone)) || mobiles.some((m) => theirs.has(m));
      },
    });
  }
  if (email)
    checks.push({ field: 'email', value: email, cond: sql`lower(trim(coalesce(${customer.email},''))) = ${email}` });
  if (taxId.length >= 5)
    checks.push({
      field: 'taxId',
      value: taxId,
      cond: sql`${cardDigits} = ${taxId}`,
    });
  if (!checks.length) return [];
  const query = (c: (typeof checks)[number]) =>
    q
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
      .limit(50);
  // one query per field, one after another (q may be a transaction: one connection)
  const found: Awaited<ReturnType<typeof query>>[] = [];
  for (const c of checks) found.push(await query(c));
  return checks.flatMap((c, k) =>
    found[k]!.filter((r) => !c.keep || c.keep(r))
      .slice(0, 5)
      .map((r) => ({
        field: c.field,
        value: c.value,
        code: r.code ?? '',
        name: r.name ?? '',
        phone: r.phone ?? '',
        email: r.email ?? '',
        taxId: r.taxId ?? '',
      })),
  );
}

/**
 * The keys a save claims (pg_advisory_xact_lock), normalised as findCustomerConflicts compares: two saves that would
 * clash share at least one — the whole phone field (0-form), each mobile in it, the e-mail, the tax id digits.
 */
function identityKeys(v: { phone?: string; email?: string; taxId?: string }): string[] {
  const phone = digits(v.phone);
  const taxId = digits(v.taxId);
  const keys = new Set<string>();
  if (phone.length >= 6) {
    keys.add(`phone:${phoneDigitVariants(phone).find((d) => d.startsWith('0')) ?? phone}`);
    for (const m of phonesIn(str(v.phone))) keys.add(`mobile:${m}`);
  }
  if (normEmail(v.email)) keys.add(`email:${normEmail(v.email)}`);
  if (taxId.length >= 5) keys.add(`tax:${taxId}`);
  return [...keys].sort(); // one order for every save — two never wait on each other's second key
}

/** The columns a save writes from the form, cleaned (phone / one-line address / status apart). */
function columnsOf(i: Omit<CustomerInput, 'cityId' | 'districtId' | 'subDistrictId'>, place: PlaceKeys) {
  const taxId = taxIdDigits(i.taxId);
  return {
    customerName: clean(i.name),
    // digits only; a legacy value nobody changed (not 13 digits) is kept as it was
    customerCardId: /^\d{13}$/.test(taxId) ? taxId : clean(i.taxId),
    customerType: clean(i.type) || 'Normal',
    isCustomerOnline: i.online !== false,
    customerAddress1: clean(i.address1),
    customerAddress2: clean(i.address2),
    provincePk: place.provincePk,
    districtPk: place.districtPk,
    // the postal code is NOT checked against sub_district.postal_code: the master is wrong for many
    // ตำบล (every Mueang Chiang Mai one says 50000; real 50200 / 50300) — the form only hints at a difference
    subDistrictPk: place.subDistrictPk,
    postalCode: clean(i.postalCode),
    email: clean(i.email).toLowerCase(),
    lineId: clean(i.line),
    usePriceGroup: PRICE_GROUP_VALUE[clean(i.priceGroup)] ?? (clean(i.priceGroup) || 'Retail'),
  };
}
/** Create/update a customer. New codes come from running "Customer" (C00001). */
export async function saveCustomer(i: CustomerInput, byUserPk: number): Promise<Customer> {
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

  return writeTx(async (tx) => {
    // no unique index (legacy rows hold real duplicates): two saves claiming the same value at once queue on its
    // key, and the second one checks after the first committed — before the row lock below, so never a deadlock
    for (const k of identityKeys(check))
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`customer:${k}`}, 0))`);
    const conflicts = await findCustomerConflicts(check, i.code, tx);
    const [first] = conflicts;
    if (first) {
      const label = { phone: 'เบอร์โทรศัพท์', email: 'อีเมล', taxId: 'เลขบัตร/ผู้เสียภาษี' };
      // an edit is not "creating" anything: it says whose number it is
      const message = prev
        ? `${label[first.field]}นี้เป็นของลูกค้า ${first.code} ${first.name} แล้ว`
        : `${label[first.field]}นี้มีลูกค้าอยู่แล้ว (${first.code} ${first.name}) — ห้ามสร้างซ้ำ`;
      throw new HttpError(409, message, { conflicts, fields: conflictErrors(conflicts) });
    }

    // cleaned values (customerSchema checked their length against the columns — nothing is cut)
    const place = await placeKeys(tx, i);
    const cols = { ...columnsOf(i, place), phoneNumber: phone };
    const status = fromUiStatus(i.status);
    if (i.code) {
      const [before] = await tx.select().from(customer).where(eq(customer.customerCode, i.code)).for('update');
      if (!before) throw new HttpError(404, 'customer not found');
      // restored through the records page (Customer del) — the form's status would revive it with edit only
      if (before.recordStatus === RS.DELETED) throw new HttpError(409, 'ลูกค้ารายนี้ถูกลบแล้ว แก้ไขไม่ได้');
      assertVersion(i.version, before.rowVersion);
      // "never worse": only what really changes is written. The stored row goes through the same cleaning
      // as the form (which shows a legacy address-only row's address in บรรทัด 1) — equal → the stored value
      // stays as it is (a legacy trailing space); saved unchanged = no UPDATE, no audit, no row_version bump
      const shown = toCustomer(before);
      const was: Record<string, unknown> = {
        ...columnsOf(
          { ...shown, address1: shown.address1 || shown.address },
          { provincePk: before.provincePk, districtPk: before.districtPk, subDistrictPk: before.subDistrictPk },
        ),
        phoneNumber: shown.phone,
      };
      const set: Partial<typeof customer.$inferInsert> = Object.fromEntries(
        Object.entries(cols).filter(([k, v]) => v !== was[k]),
      );
      // customer_address (the legacy one-line text) is not written — it is composed on read (addressLine)
      if (uiStatus(before.recordStatus) !== uiStatus(status)) Object.assign(set, statusStamp(status, byUserPk));
      const saved = () => oneCustomer(eq(customer.pk, before.pk), tx) as Promise<Customer>;
      if (!Object.keys(set).length) return saved();
      await tx.update(customer).set(set).where(eq(customer.pk, before.pk));
      await audit(tx, byUserPk, {
        action: 'UPDATE',
        module: 'Customer',
        entity: 'customer',
        key: before.id,
        no: before.customerCode,
        summary: `แก้ไขลูกค้า ${name}`,
        // the address master keys stay out of the log (pk never leaves the server)
        changes: diff(before as Record<string, unknown>, set as Record<string, unknown>, {
          skip: ['provincePk', 'districtPk', 'subDistrictPk'],
        }),
      });
      return saved();
    }
    const code = await nextRunningNo(tx, 'Customer');
    const [row] = await tx
      .insert(customer)
      .values({
        ...cols,
        ...statusStamp(status, byUserPk),
        customerCode: code,
        createdDate: nowThai(),
        createdByAppUserPk: byUserPk,
        faxNumber: '',
      })
      .returning();
    if (!row) throw new Error('customer insert returned no row');
    await audit(tx, byUserPk, {
      action: 'CREATE',
      module: 'Customer',
      entity: 'customer',
      key: row.id,
      no: code,
      summary: `เพิ่มลูกค้า ${code} ${name} · ${phone}`,
    });
    return (await oneCustomer(eq(customer.pk, row.pk), tx))!;
  });
}

export function listProvinces() {
  return cached('provinces', TTL_STATIC, () =>
    db.select({ id: province.id, name: province.nameTh }).from(province).orderBy(asc(province.nameTh)),
  );
}
/** the districts of the province whose uuid is `city` (none → no rows) */
export async function listDistricts(city?: string) {
  if (!city) return [];
  return db
    .select({ id: district.id, name: district.nameTh })
    .from(district)
    .innerJoin(province, eq(province.pk, district.provincePk))
    .where(eq(province.id, city))
    .orderBy(asc(district.nameTh));
}
/** the sub-districts of the district whose uuid is `district` (none → no rows) */
export async function listSubDistricts(districtId?: string) {
  if (!districtId) return [];
  return db
    .select({ id: subDistrict.id, name: subDistrict.nameTh, postal: subDistrict.postalCode })
    .from(subDistrict)
    .innerJoin(district, eq(district.pk, subDistrict.districtPk))
    .where(eq(district.id, districtId))
    .orderBy(asc(subDistrict.nameTh));
}

/** "+ เพิ่มชื่อ" (customer form, as the legacy app had it): a แขวง / ตำบล the list lacks, for everyone from then on.
 *  The body was checked by its operation (addressCreate); the same name in that district is refused. */
export async function addSubDistrict(i: { district: string; name: string; postal: string }, byUserPk: number) {
  const name = clean(i.name);
  const postal = clean(i.postal);
  return writeTx(async (tx) => {
    // ponytail: one lock for the table — the same-name check below has no unique index behind it; adds are rare
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('sub_district', 0))`);
    const [d] = await tx
      .select({ provincePk: district.provincePk, pk: district.pk })
      .from(district)
      .where(eq(district.id, i.district));
    if (!d) throw new HttpError(404, 'ไม่พบเขต / อำเภอนี้ กรุณาโหลดหน้าใหม่');
    const [dup] = await tx
      .select({ pk: subDistrict.pk })
      .from(subDistrict)
      .where(and(eq(subDistrict.districtPk, d.pk), sql`btrim(${subDistrict.nameTh}) = ${name}`));
    if (dup) {
      const message = `มี "${name}" ในเขต / อำเภอนี้แล้ว`;
      throw new HttpError(409, message, { fields: { name: message } });
    }
    const [row] = await tx
      .insert(subDistrict)
      .values({
        provincePk: d.provincePk,
        districtPk: d.pk,
        nameTh: name,
        nameEn: '',
        postalCode: postal,
      })
      .returning({ id: subDistrict.id, name: subDistrict.nameTh, postal: subDistrict.postalCode });
    if (!row) throw new Error('sub_district insert returned no row');
    await audit(tx, byUserPk, {
      action: 'CREATE',
      module: 'Customer',
      entity: 'sub_district',
      key: row.id,
      summary: `เพิ่มแขวง / ตำบล ${name} ${postal}`,
      meta: { districtId: i.district },
    });
    return row;
  });
}
