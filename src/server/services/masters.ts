import 'server-only';
import { cached, invalidate, TTL_MASTER } from '@/server/cache';
import { and, asc, count, desc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { category, color, jobType, manufacturer, model, productType, symptom } from '@/db/schema';
import type { MasterRow, Symptom, Model } from '@/data/types';
import { HttpError } from '@/server/auth';
import { fmtDateTime, money, nowThai, num } from '@/server/mappers/format';
import { nextRunningNo } from '@/db/running-no';
import { audit, diff, type AuditChanges } from '@/server/audit';
import { productsChanged } from './stock';
import { orderBy as orderByCols, likeTerm, offsetOf, totalOf, type Page, type PageQuery } from '@/server/paging';
import {
  RS,
  statusFilter,
  uiStatus,
  fromUiStatus,
  statusStamp,
  statusSummary,
  type StatusMode,
  type RecordStatus,
} from '@/server/record-status';
import { assertValid } from '@/server/validate';
import {
  DUPLICATE_NAME,
  MASTER_DETAIL_MAX,
  MASTER_NAME_LABEL,
  masterNameKey,
  masterSchema,
  modelSchema,
} from '@/lib/validation/admin';
import { clean } from '@/lib/validation';

export type DeletedMode = StatusMode;

const status = (rs: string | null) => uiStatus(rs) as MasterRow['status'];

/** an edit that only switched the status reads as a status change in the audit log — as the status switch writes it */
function editAudit(changes: AuditChanges | null, noun: string, key: string | number, name: string, summary: string) {
  const rs = changes?.recordStatus;
  const onlyStatus = !!rs && Object.keys(changes!).every((k) => k === 'recordStatus' || k === 'isActive');
  return onlyStatus
    ? {
        action: rs[1] === 'DELETED' ? ('DELETE' as const) : ('STATUS' as const),
        summary: statusSummary({ noun, key, name, old: rs[0] as string, rs: rs[1] as string }),
      }
    : { action: 'UPDATE' as const, summary };
}

/** a save's status columns, judged on the locked row: an edit that sends no status or keeps the stored one writes none
 *  (status_changed_at / _by say when the status last changed, not when the row was last saved) */
const saveStamp = (sent: string | undefined, before: { recordStatus: string | null } | undefined, byUserId: number) =>
  before && (sent === undefined || fromUiStatus(sent) === before.recordStatus)
    ? {}
    : statusStamp(fromUiStatus(sent), byUserId);

/** the column as masterNameKey() sees a name (no spaces, lower case) */
const nameKeyOf = (col: Parameters<typeof eq>[0]) =>
  sql`lower(regexp_replace(coalesce(${col}, ''), '[[:space:]]', '', 'g'))`;
/** 409 under the name field: the same name ignoring case and spaces exists.
 *  The message names the row that has it — it may be Inactive or deleted, i.e. not in the list — and the
 *  field error IS that message: the toast fades, the line under the name stays. */
function duplicate(dup: { name: string | null; ref?: string; rs?: string | null }) {
  const where = [
    dup.ref && `รหัส ${dup.ref}`,
    dup.rs === RS.DELETED ? 'อยู่ในรายการที่ลบ' : dup.rs === RS.INACTIVE ? 'Inactive' : '',
  ].filter(Boolean);
  const msg = `${DUPLICATE_NAME}: "${clean(dup.name)}"${where.length ? ` (${where.join(' · ')})` : ''}`;
  return new HttpError(409, msg, { fields: { name: msg } });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** One name at a time per list (as masterNameKey sees it): two admins saving "Red" and "red " at the same
 *  instant queue here, and the second one's duplicate check sees the first one's row. */
const lockName = (tx: Tx, list: string, name: unknown) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`master:${list}:${masterNameKey(name)}`}))`);

type Loaded = 'name' | 'detail' | 'status' | 'brand' | 'price';
/** what the edit dialog loaded (name / detail / status — models: name / brand / price / status — as the list showed them) */
export type MasterExpect = Partial<Record<Loaded, string | null>> | null;
/** 409 stale: a value the dialog loaded no longer matches the row — another admin saved it meanwhile */
function assertLoaded(now: Partial<Record<Loaded, unknown>>, expect?: MasterExpect) {
  if (!expect) return;
  if ((Object.keys(now) as Loaded[]).some((k) => expect[k] != null && clean(expect[k]) !== clean(now[k])))
    throw new HttpError(409, 'ผู้ดูแลระบบคนอื่นเพิ่งแก้รายการนี้ — โหลดหน้าใหม่แล้วแก้อีกครั้ง', { stale: true });
}

/* ------------------------------------------------------------------ *
 * Simple id/name/detail/is_active masters
 * ------------------------------------------------------------------ */
type SimpleKind = 'categories' | 'manufacturers' | 'colors' | 'job_types' | 'product_types';

/** what the audit page calls each master table */
const KIND_NOUN: Record<SimpleKind, string> = {
  categories: 'หมวดหมู่',
  manufacturers: 'ยี่ห้อ',
  colors: 'สี',
  job_types: 'ประเภทงาน',
  product_types: 'ประเภทสินค้า',
};
const SIMPLE = {
  categories: {
    table: category,
    id: category.categoryId,
    uuid: category.id,
    name: category.categoryName,
    detail: category.categoryDescription,
    extra: category.shotCode,
    active: category.recordStatus,
    days: null,
    // drizzle insert/update keys (TS property names, not DB column names)
    keys: { name: 'categoryName', detail: 'categoryDescription', extra: 'shotCode', active: 'isActive', days: null },
    nameLen: 50,
  },
  manufacturers: {
    table: manufacturer,
    id: manufacturer.manufacturerId,
    uuid: manufacturer.id,
    name: manufacturer.manufacturerName,
    detail: manufacturer.logoName,
    extra: null,
    active: manufacturer.recordStatus,
    days: null,
    keys: { name: 'manufacturerName', detail: 'logoName', extra: null, active: 'isActive', days: null },
    nameLen: 50,
  },
  colors: {
    table: color,
    id: color.pk,
    uuid: color.id,
    name: color.colorName,
    detail: color.description,
    extra: null,
    active: color.recordStatus,
    days: null,
    keys: { name: 'colorName', detail: 'description', extra: null, active: 'isActive', days: null },
    nameLen: 50,
  },
  job_types: {
    table: jobType,
    id: jobType.jobTypeId,
    uuid: jobType.id,
    name: jobType.jobTypeName,
    detail: jobType.jobTypeDescription,
    extra: null,
    active: jobType.recordStatus,
    keys: {
      name: 'jobTypeName',
      detail: 'jobTypeDescription',
      extra: null,
      active: 'isActive',
      days: 'defaultDueDays',
    },
    days: jobType.defaultDueDays, // SLA → the real due date of a job nobody picked one for
    nameLen: 50,
  },
  product_types: {
    table: productType,
    id: productType.productTypeId,
    uuid: productType.id,
    name: productType.productTypeName,
    detail: productType.productTypeDescription,
    extra: null,
    active: productType.recordStatus,
    days: null,
    keys: { name: 'productTypeName', detail: 'productTypeDescription', extra: null, active: 'isActive', days: null },
    nameLen: 50,
  },
} as const;

export function isSimpleKind(k: string): k is SimpleKind {
  return k in SIMPLE;
}

export function listSimple(kind: SimpleKind, deleted: DeletedMode = 'exclude'): Promise<MasterRow[]> {
  return cached(`master:${kind}:${deleted}`, TTL_MASTER, () => loadSimple(kind, deleted));
}
async function loadSimple(kind: SimpleKind, deleted: DeletedMode): Promise<MasterRow[]> {
  const d = SIMPLE[kind];
  const rows = await db
    .select({
      id: d.uuid,
      name: d.name,
      detail: d.detail ?? sql<string>`''`,
      extra: d.extra ?? sql<string>`''`,
      days: d.days ?? sql<number | null>`null`,
      active: d.active,
    })
    .from(d.table)
    .where(statusFilter(d.active, deleted))
    .orderBy(asc(d.id));
  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? '',
    detail: r.detail ?? '',
    status: status(r.active),
    extra: r.extra ?? '',
    ...(r.days != null ? { days: Number(r.days) } : {}),
  }));
}

export async function saveSimple(
  kind: SimpleKind,
  input: {
    id?: string;
    name: string;
    detail?: string;
    extra?: string;
    days?: string;
    status?: string;
    expect?: MasterExpect;
  },
  byUserId = 0,
): Promise<MasterRow> {
  const d = SIMPLE[kind];
  assertValid(
    masterSchema(MASTER_NAME_LABEL[kind], { days: !!d.keys.days, detailMax: MASTER_DETAIL_MAX[kind] }),
    input,
  );
  const name = clean(input.name);
  const values: Record<string, unknown> = { [d.keys.name]: name };
  if (d.keys.detail) values[d.keys.detail] = clean(input.detail);
  // the page has no field for it (categories.shot_code): not sent = keep it
  if (d.keys.extra && input.extra !== undefined) values[d.keys.extra] = clean(input.extra).slice(0, 50);
  if (d.keys.days) values[d.keys.days] = Number(input.days);

  /** the row's uuid (input.id — checked by the contract): the one edited, or the one inserted */
  const id = await db.transaction(async (tx) => {
    await lockName(tx, kind, name);
    const [before] = input.id ? await tx.select().from(d.table).where(eq(d.uuid, input.id)).for('update') : [];
    if (input.id && !before) throw new HttpError(404, `ไม่พบ${KIND_NOUN[kind]}นี้ — โหลดหน้าใหม่`);
    const old = before as Record<string, unknown> | undefined;
    if (old)
      assertLoaded(
        {
          name: old[d.keys.name],
          detail: d.keys.detail ? old[d.keys.detail] : '',
          status: status(old.recordStatus as string | null),
        },
        input.expect,
      );
    Object.assign(values, saveStamp(input.status, old as { recordStatus: string | null } | undefined, byUserId));
    // unique name ignoring case + spaces (legacy has unique indexes on most names); a row keeping its own
    // name is not checked — 5 legacy symptom pairs already clash and must stay editable
    if (!old || masterNameKey(old[d.keys.name]) !== masterNameKey(name)) {
      const dup = await tx
        .select({ name: d.name, rs: d.active })
        .from(d.table)
        .where(and(sql`${nameKeyOf(d.name)} = ${masterNameKey(name)}`, input.id ? ne(d.uuid, input.id) : undefined))
        .limit(1);
      if (dup[0]) throw duplicate({ name: dup[0].name, rs: dup[0].rs });
    }
    if (old) {
      await tx.update(d.table).set(values).where(eq(d.uuid, input.id!));
      // saved with nothing changed → no audit line (as a user save)
      const changes = diff(old, values);
      if (changes)
        await audit(tx, byUserId, {
          ...editAudit(changes, KIND_NOUN[kind], name, '', `แก้ไข${KIND_NOUN[kind]}: ${name}`),
          module: 'Admin',
          entity: kind,
          key: input.id!,
          changes,
        });
      return input.id!;
    }
    const [row] = await tx.insert(d.table).values(values).returning({ id: d.uuid });
    if (!row) throw new Error(`${kind} insert returned no row`);
    await audit(tx, byUserId, {
      action: 'CREATE',
      module: 'Admin',
      entity: kind,
      key: row.id,
      summary: `เพิ่ม${KIND_NOUN[kind]}: ${name}`,
    });
    return row.id;
  });

  invalidate(`master:${kind}:`);
  if (input.id) {
    // the picker list shows category / brand names, the model list brand names
    if (kind === 'categories' || kind === 'manufacturers') productsChanged();
    if (kind === 'manufacturers') invalidate('master:models:');
    // "all": an edit may just have set the row INACTIVE
    const saved = (await listSimple(kind, 'all')).find((r) => r.id === input.id);
    if (!saved) throw new Error(`${kind} #${input.id} not found after update`);
    return saved;
  }
  const created = (await listSimple(kind, 'all')).find((r) => r.id === id);
  if (!created) throw new Error(`${kind} #${id} not found after insert`);
  return created;
}

/** ACTIVE ↔ INACTIVE toggle or DELETED (soft delete). */
/** `id` = the row's uuid (records route checked it) — the audit key; the summary names the row */
export async function setSimpleStatus(kind: SimpleKind, id: string, rs: RecordStatus, byUserId: number) {
  const d = SIMPLE[kind];
  await db.transaction(async (tx) => {
    const [old] = await tx.select({ rs: d.active, name: d.name }).from(d.table).where(eq(d.uuid, id)).for('update');
    if (!old) throw new HttpError(404, `ไม่พบ${KIND_NOUN[kind]}นี้ — โหลดหน้าใหม่`);
    if (old.rs === rs) return; // already so: no stamp, no audit line (as records.ts)
    await tx
      .update(d.table)
      .set({ [d.keys.active]: rs === 'ACTIVE', ...statusStamp(rs, byUserId, false) })
      .where(eq(d.uuid, id));
    await audit(tx, byUserId, {
      action: rs === 'DELETED' ? 'DELETE' : 'STATUS',
      module: 'Admin',
      entity: kind,
      key: id,
      summary: statusSummary({ noun: KIND_NOUN[kind], key: clean(old.name), old: old.rs, rs }),
      changes: { recordStatus: [old.rs ?? null, rs] },
    });
  });
  invalidate(`master:${kind}:`);
}

/* ------------------------------------------------------------------ *
 * Symptoms (+ group)
 * ------------------------------------------------------------------ */
export function listSymptoms(deleted: DeletedMode = 'exclude'): Promise<Symptom[]> {
  return cached(`master:symptoms:${deleted}`, TTL_MASTER, () => loadSymptoms(deleted));
}
async function loadSymptoms(deleted: DeletedMode): Promise<Symptom[]> {
  const rows = await db
    .select()
    .from(symptom)
    .where(statusFilter(symptom.recordStatus, deleted))
    .orderBy(asc(symptom.symptomId));
  return rows.map((r) => ({
    id: r.id,
    name: r.symptomName ?? '',
    detail: r.symptomDescription ?? '',
    group: r.symptomGroupName ?? '',
    status: status(r.recordStatus),
    extra: '',
  }));
}

export async function saveSymptom(
  input: {
    id?: string;
    name: string;
    detail?: string;
    group?: string;
    status?: string;
    expect?: MasterExpect;
  },
  byUserId = 0,
): Promise<Symptom> {
  assertValid(masterSchema(MASTER_NAME_LABEL.symptoms, { detailMax: MASTER_DETAIL_MAX.symptoms }), input);
  const name = clean(input.name);
  const values = {
    symptomName: name,
    symptomDescription: clean(input.detail),
    symptomGroupName: clean(input.group),
  };
  const id = await db.transaction(async (tx) => {
    await lockName(tx, 'symptoms', name);
    const [before] = input.id ? await tx.select().from(symptom).where(eq(symptom.id, input.id)).for('update') : [];
    if (input.id && !before) throw new HttpError(404, 'ไม่พบอาการเสียนี้ — โหลดหน้าใหม่');
    if (before)
      assertLoaded(
        { name: before.symptomName, detail: before.symptomDescription, status: status(before.recordStatus) },
        input.expect,
      );
    if (!before || masterNameKey(before.symptomName) !== masterNameKey(name)) {
      const [dup] = await tx
        .select({ name: symptom.symptomName, rs: symptom.recordStatus })
        .from(symptom)
        .where(
          and(
            sql`${nameKeyOf(symptom.symptomName)} = ${masterNameKey(name)}`,
            input.id ? ne(symptom.id, input.id) : undefined,
          ),
        )
        .limit(1);
      if (dup) throw duplicate({ name: dup.name, rs: dup.rs });
    }
    if (input.id) {
      const id = input.id;
      const set = { ...values, ...saveStamp(input.status, before, byUserId) };
      await tx.update(symptom).set(set).where(eq(symptom.id, id));
      const changes = diff(before as Record<string, unknown>, set as Record<string, unknown>);
      if (changes)
        await audit(tx, byUserId, {
          ...editAudit(changes, 'อาการเสีย', name, '', `แก้ไขอาการเสีย: ${name}`),
          module: 'Admin',
          entity: 'symptom',
          key: id,
          changes,
        });
      return id;
    }
    const [row] = await tx
      .insert(symptom)
      .values({ ...values, ...saveStamp(input.status, undefined, byUserId) })
      .returning({ id: symptom.id });
    if (!row) throw new Error('symptom insert returned no row');
    await audit(tx, byUserId, {
      action: 'CREATE',
      module: 'Admin',
      entity: 'symptom',
      key: row.id,
      summary: `เพิ่มอาการเสีย: ${name}`,
    });
    return row.id;
  });
  invalidate('master:symptoms:');
  return (await listSymptoms('exclude')).find((r) => r.id === id)!;
}

/** `id` = the symptom's uuid (records route checked it) */
export async function setSymptomStatus(id: string, rs: RecordStatus, byUserId: number) {
  await db.transaction(async (tx) => {
    const [old] = await tx
      .select({ rs: symptom.recordStatus, name: symptom.symptomName })
      .from(symptom)
      .where(eq(symptom.id, id))
      .for('update');
    if (!old) throw new HttpError(404, 'ไม่พบอาการเสียนี้ — โหลดหน้าใหม่');
    if (old.rs === rs) return; // already so: no stamp, no audit line (as records.ts)
    await tx.update(symptom).set(statusStamp(rs, byUserId)).where(eq(symptom.id, id));
    await audit(tx, byUserId, {
      action: rs === 'DELETED' ? 'DELETE' : 'STATUS',
      module: 'Admin',
      entity: 'symptom',
      key: id,
      summary: statusSummary({ noun: 'อาการเสีย', key: clean(old.name), old: old.rs, rs }),
      changes: { recordStatus: [old.rs ?? null, rs] },
    });
  });
  invalidate('master:symptoms:');
}

/* ------------------------------------------------------------------ *
 * Models (code from running "Model" = MD00001)
 * ------------------------------------------------------------------ */
export function listModels(deleted: DeletedMode = 'exclude'): Promise<Model[]> {
  return cached(`master:models:${deleted}`, TTL_MASTER, () => loadModels(deleted));
}
async function loadModels(deleted: DeletedMode): Promise<Model[]> {
  const rows = await db
    .select({
      code: model.modelCode,
      name: model.modelName,
      brand: manufacturer.manufacturerName,
      price: model.marketPrice,
      updated: model.lastUpdate,
      active: model.recordStatus,
      id: model.modelId,
    })
    .from(model)
    .leftJoin(manufacturer, eq(manufacturer.manufacturerId, model.manufacturerId))
    .where(statusFilter(model.recordStatus, deleted))
    .orderBy(asc(model.modelCode));
  return rows.map((r) => ({
    code: r.code ?? String(r.id),
    name: r.name ?? '',
    brand: r.brand ?? '',
    price: num(r.price),
    updated: fmtDateTime(r.updated),
    status: status(r.active),
  }));
}

export async function saveModel(
  input: {
    code?: string;
    name: string;
    brand: string;
    price?: number | string;
    status?: string;
    expect?: MasterExpect;
  },
  byUserId = 0,
): Promise<Model> {
  assertValid(modelSchema, input);
  const name = clean(input.name);
  const brand = await db
    .select({ id: manufacturer.manufacturerId })
    .from(manufacturer)
    .where(sql`btrim(${manufacturer.manufacturerName}, E' \t\r\n') = ${clean(input.brand)}`) // legacy names carry trailing spaces
    .limit(1);
  if (!brand[0]) throw new HttpError(400, 'ไม่พบยี่ห้อ ' + clean(input.brand));
  const brandId = brand[0].id;
  const values = {
    modelName: name,
    manufacturerId: brandId,
    marketPrice: money(num(input.price)),
    lastUpdate: nowThai(),
  };

  const code = await db.transaction(async (tx) => {
    await lockName(tx, `models:${brandId}`, name);
    const [before] = input.code
      ? await tx.select().from(model).where(eq(model.modelCode, input.code)).for('update')
      : [];
    if (input.code && !before) throw new HttpError(404, `ไม่พบรุ่นสินค้า ${input.code}`);
    if (before && input.expect) {
      const [was] = await tx
        .select({ brand: manufacturer.manufacturerName })
        .from(manufacturer)
        .where(eq(manufacturer.manufacturerId, before.manufacturerId ?? -1));
      assertLoaded(
        {
          name: before.modelName,
          brand: was?.brand,
          price: String(num(before.marketPrice)), // as the list shows it (num), which the dialog sends back
          status: status(before.recordStatus),
        },
        input.expect,
      );
    }
    // one name per brand, ignoring case + spaces (checked here so a duplicate is a 409, not ix_unique_model's 500);
    // a model keeping its own name and brand is not checked
    if (!before || before.manufacturerId !== brandId || masterNameKey(before.modelName) !== masterNameKey(name)) {
      const [dup] = await tx
        .select({ code: model.modelCode, name: model.modelName, rs: model.recordStatus })
        .from(model)
        .where(
          and(
            eq(model.manufacturerId, brandId),
            sql`${nameKeyOf(model.modelName)} = ${masterNameKey(name)}`,
            ne(model.recordStatus, RS.DELETED),
            input.code ? sql`${model.modelCode} is distinct from ${input.code}` : undefined,
          ),
        )
        .limit(1);
      if (dup) throw duplicate({ name: dup.name, ref: dup.code ?? '', rs: dup.rs });
    }
    if (input.code) {
      const set = { ...values, ...saveStamp(input.status, before, byUserId) };
      await tx.update(model).set(set).where(eq(model.modelCode, input.code));
      const changes = diff(before as Record<string, unknown>, set as Record<string, unknown>);
      if (changes)
        await audit(tx, byUserId, {
          ...editAudit(changes, 'รุ่นสินค้า', input.code, name, `แก้ไขรุ่นสินค้า ${name}`),
          module: 'Admin',
          entity: 'model',
          key: input.code,
          changes,
        });
      return input.code;
    }
    const c = await nextRunningNo(tx, 'Model');
    await tx
      .insert(model)
      .values({ ...values, ...saveStamp(input.status, undefined, byUserId), modelCode: c, tierId: 0 });
    await audit(tx, byUserId, {
      action: 'CREATE',
      module: 'Admin',
      entity: 'model',
      key: c,
      summary: `เพิ่มรุ่นสินค้า ${name} (${clean(input.brand)})`,
    });
    return c;
  });
  invalidate('master:models:');
  return (await listModels('exclude')).find((r) => r.code === code)!;
}

export async function setModelStatus(code: string, rs: RecordStatus, byUserId: number) {
  await db.transaction(async (tx) => {
    const [old] = await tx
      .select({ rs: model.recordStatus })
      .from(model)
      .where(eq(model.modelCode, code))
      .for('update');
    if (old?.rs === rs) return; // already so: no stamp, no audit line (as records.ts)
    await tx
      .update(model)
      .set({ ...statusStamp(rs, byUserId), lastUpdate: nowThai() })
      .where(eq(model.modelCode, code));
    await audit(tx, byUserId, {
      action: rs === 'DELETED' ? 'DELETE' : 'STATUS',
      module: 'Admin',
      entity: 'model',
      key: code,
      summary: statusSummary({ noun: 'รุ่นสินค้า', key: code, old: old?.rs, rs }),
      changes: { recordStatus: [old?.rs ?? null, rs] },
    });
  });
  invalidate('master:models:');
}

/* ------------------------------------------------------------------ *
 * Paged models (รุ่นสินค้า — 1.1k rows)
 * ------------------------------------------------------------------ */
const MODEL_SORT = {
  code: model.modelCode,
  name: model.modelName,
  brand: manufacturer.manufacturerName,
  price: model.marketPrice,
  updated: model.lastUpdate,
  status: model.recordStatus,
};

/** filter bar of the รุ่นสินค้า page — every field AND-ed; brand = manufacturer name, status = Active | Inactive */
export type ModelFilters = { brand?: string; code?: string; name?: string; status?: string };

export async function pageModels(
  p: PageQuery,
  mode: StatusMode = 'exclude',
  f: ModelFilters = {},
): Promise<Page<Model>> {
  const term = p.q.trim();
  const w = and(
    statusFilter(model.recordStatus, mode),
    term
      ? or(
          ilike(model.modelCode, likeTerm(term)),
          ilike(model.modelName, likeTerm(term)),
          ilike(manufacturer.manufacturerName, likeTerm(term)),
        )
      : undefined,
    f.brand ? eq(manufacturer.manufacturerName, f.brand) : undefined,
    f.code ? ilike(model.modelCode, likeTerm(f.code.trim())) : undefined,
    f.name ? ilike(model.modelName, likeTerm(f.name.trim())) : undefined,
    f.status === 'Active'
      ? eq(model.recordStatus, 'ACTIVE')
      : f.status === 'Inactive'
        ? eq(model.recordStatus, 'INACTIVE')
        : undefined,
  );
  // count + page in parallel: the response takes max(count, rows) instead of their sum
  const [counted, rows] = await Promise.all([
    db
      .select({ total: count() })
      .from(model)
      .leftJoin(manufacturer, eq(manufacturer.manufacturerId, model.manufacturerId))
      .where(w),
    db
      .select({
        code: model.modelCode,
        name: model.modelName,
        brand: manufacturer.manufacturerName,
        price: model.marketPrice,
        updated: model.lastUpdate,
        active: model.recordStatus,
        id: model.modelId,
      })
      .from(model)
      .leftJoin(manufacturer, eq(manufacturer.manufacturerId, model.manufacturerId))
      .where(w)
      .orderBy(...orderByCols(p.sort, MODEL_SORT, [desc(model.modelId)]))
      .limit(p.pageSize)
      .offset(offsetOf(p)),
  ]);
  return {
    rows: rows.map((r) => ({
      code: r.code ?? String(r.id),
      name: r.name ?? '',
      brand: r.brand ?? '',
      price: num(r.price),
      updated: fmtDateTime(r.updated),
      status: status(r.active),
    })),
    total: totalOf(counted),
    page: p.page,
    pageSize: p.pageSize,
  };
}
