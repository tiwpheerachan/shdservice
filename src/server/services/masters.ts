import 'server-only';
import { cached, invalidate, TTL_MASTER } from '@/server/cache';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { category, color, jobType, manufacturer, model, productType, symptom, runningNo } from '@/db/schema';
import type { MasterRow, Symptom, Model } from '@/data/mock';
import { HttpError } from '@/server/auth';
import { fmtDateTime, money, nowThai, num } from '@/server/mappers/format';
import { nextRunningNo } from '@/db/running-no';
import { audit, diff } from '@/server/audit';
import { count, desc, ilike, or } from 'drizzle-orm';
import { orderBy as orderByCols, likeTerm, offsetOf, totalOf, type Page, type PageQuery } from '@/server/paging';
import {
  RS,
  statusFilter,
  uiStatus,
  fromUiStatus,
  statusStamp,
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

/** the column as masterNameKey() sees a name (no spaces, lower case) */
const nameKeyOf = (col: Parameters<typeof eq>[0]) =>
  sql`lower(regexp_replace(coalesce(${col}, ''), '[[:space:]]', '', 'g'))`;
/** 409 under the name field: the same name ignoring case and spaces exists (the unique index used to answer 500).
 *  The message names the row that has it — it may be Inactive or deleted, i.e. not in the list — and the
 *  field error IS that message: the toast fades, the line under the name stays (it used to say only "มีชื่อนี้อยู่แล้ว"). */
function duplicate(dup: { name: string | null; ref: string | number; rs?: string | null }) {
  const msg = `${DUPLICATE_NAME}: "${clean(dup.name)}" (รหัส ${dup.ref}${dup.rs === RS.DELETED ? ' · อยู่ในรายการที่ลบ' : dup.rs === RS.INACTIVE ? ' · Inactive' : ''})`;
  return new HttpError(409, msg, { fields: { name: msg } });
}

/* ------------------------------------------------------------------ *
 * Simple id/name/detail/is_active masters
 * ------------------------------------------------------------------ */
type SimpleKind = 'categories' | 'manufacturers' | 'colors' | 'job_types' | 'product_types';

const SIMPLE = {
  categories: {
    table: category,
    id: category.categoryId,
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
    id: color.id,
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
      id: d.id,
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
    id: String(r.id),
    name: r.name ?? '',
    detail: r.detail ?? '',
    status: status(r.active),
    extra: r.extra ?? '',
    ...(r.days != null ? { days: Number(r.days) } : {}),
  }));
}

export async function saveSimple(
  kind: SimpleKind,
  input: { id?: string; name: string; detail?: string; extra?: string; days?: string; status?: string },
  byUserId = 0,
): Promise<MasterRow> {
  const d = SIMPLE[kind];
  assertValid(
    masterSchema(MASTER_NAME_LABEL[kind], { days: !!d.keys.days, detailMax: MASTER_DETAIL_MAX[kind] }),
    input,
  );
  const name = clean(input.name);
  const rs = fromUiStatus(input.status);
  const values: Record<string, unknown> = {
    [d.keys.name]: name,
    [d.keys.active]: rs === 'ACTIVE',
    recordStatus: rs,
    statusChangedAt: nowThai(),
    statusChangedBy: byUserId,
  };
  if (d.keys.detail) values[d.keys.detail] = clean(input.detail);
  // the page has no field for it (categories.shot_code): not sent = keep it (every edit used to blank it)
  if (d.keys.extra && input.extra !== undefined) values[d.keys.extra] = clean(input.extra).slice(0, 50);
  if (d.keys.days) values[d.keys.days] = Number(input.days);

  const [before] = input.id
    ? await db
        .select()
        .from(d.table)
        .where(eq(d.id, Number(input.id)))
    : [];
  if (input.id && !before) throw new HttpError(404, `ไม่พบรายการ ${kind} #${input.id}`); // was: silent update of nothing + undefined answer
  // unique name ignoring case + spaces (legacy has unique indexes on most names); a row keeping its own
  // name is not checked — 5 legacy symptom pairs already clash and must stay editable
  const oldName = before ? (before as Record<string, unknown>)[d.keys.name] : undefined;
  if (!before || masterNameKey(oldName) !== masterNameKey(name)) {
    const dup = await db
      .select({ id: d.id, name: d.name, rs: d.active })
      .from(d.table)
      .where(and(sql`${nameKeyOf(d.name)} = ${masterNameKey(name)}`, input.id ? ne(d.id, Number(input.id)) : undefined))
      .limit(1);
    if (dup[0]) throw duplicate({ name: dup[0].name, ref: dup[0].id, rs: dup[0].rs });
  }

  if (input.id && before) {
    await db
      .update(d.table)
      .set(values)
      .where(eq(d.id, Number(input.id)));
    await audit(db, byUserId, {
      action: 'UPDATE',
      module: 'Admin',
      entity: kind,
      key: input.id,
      summary: `แก้ไข ${kind}: ${name}`,
      changes: diff(before as Record<string, unknown>, values),
    });
    invalidate(`master:${kind}:`);
    // "all": an edit may just have set the row INACTIVE
    const saved = (await listSimple(kind, 'all')).find((r) => r.id === input.id);
    if (!saved) throw new Error(`${kind} #${input.id} not found after update`);
    return saved;
  }
  const [row] = await db.insert(d.table).values(values).returning({ id: d.id });
  if (!row) throw new Error(`${kind} insert returned no row`);
  await audit(db, byUserId, {
    action: 'CREATE',
    module: 'Admin',
    entity: kind,
    key: row.id,
    summary: `เพิ่ม ${kind}: ${name}`,
  });
  invalidate(`master:${kind}:`);
  const created = (await listSimple(kind, 'all')).find((r) => r.id === String(row.id));
  if (!created) throw new Error(`${kind} #${row.id} not found after insert`);
  return created;
}

/** ACTIVE ↔ INACTIVE toggle or DELETED (soft delete). */
export async function setSimpleStatus(kind: SimpleKind, id: number, rs: RecordStatus, byUserId: number) {
  const d = SIMPLE[kind];
  const [old] = await db.select({ rs: d.active }).from(d.table).where(eq(d.id, id));
  await db
    .update(d.table)
    .set({ [d.keys.active]: rs === 'ACTIVE', ...statusStamp(rs, byUserId, false) })
    .where(eq(d.id, id));
  await audit(db, byUserId, {
    action: rs === 'DELETED' ? 'DELETE' : 'STATUS',
    module: 'Admin',
    entity: kind,
    key: id,
    summary: `${kind} #${id} → ${rs}`,
    changes: { recordStatus: [old?.rs ?? null, rs] },
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
    id: String(r.symptomId),
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
  },
  byUserId = 0,
): Promise<Symptom> {
  assertValid(masterSchema(MASTER_NAME_LABEL.symptoms, { detailMax: MASTER_DETAIL_MAX.symptoms }), input);
  const name = clean(input.name);
  const values = {
    symptomName: name,
    symptomDescription: clean(input.detail),
    symptomGroupName: clean(input.group),
    ...statusStamp(fromUiStatus(input.status), byUserId),
  };
  const [before] = input.id
    ? await db
        .select()
        .from(symptom)
        .where(eq(symptom.symptomId, Number(input.id)))
    : [];
  if (!before || masterNameKey(before.symptomName) !== masterNameKey(name)) {
    const [dup] = await db
      .select({ id: symptom.symptomId, name: symptom.symptomName, rs: symptom.recordStatus })
      .from(symptom)
      .where(
        and(
          sql`${nameKeyOf(symptom.symptomName)} = ${masterNameKey(name)}`,
          input.id ? ne(symptom.symptomId, Number(input.id)) : undefined,
        ),
      )
      .limit(1);
    if (dup) throw duplicate({ name: dup.name, ref: dup.id, rs: dup.rs });
  }
  let id: number;
  if (input.id) {
    id = Number(input.id);
    await db.update(symptom).set(values).where(eq(symptom.symptomId, id));
    await audit(db, byUserId, {
      action: 'UPDATE',
      module: 'Admin',
      entity: 'symptom',
      key: id,
      summary: `แก้ไขอาการเสีย: ${name}`,
      changes: diff(before as Record<string, unknown>, values as Record<string, unknown>),
    });
  } else {
    const [row] = await db.insert(symptom).values(values).returning({ id: symptom.symptomId });
    if (!row) throw new Error('symptom insert returned no row');
    id = row.id;
    await audit(db, byUserId, {
      action: 'CREATE',
      module: 'Admin',
      entity: 'symptom',
      key: id,
      summary: `เพิ่มอาการเสีย: ${name}`,
    });
  }
  invalidate('master:symptoms:');
  return (await listSymptoms('exclude')).find((r) => r.id === String(id))!;
}

export async function setSymptomStatus(id: number, rs: RecordStatus, byUserId: number) {
  const [old] = await db.select({ rs: symptom.recordStatus }).from(symptom).where(eq(symptom.symptomId, id));
  await db.update(symptom).set(statusStamp(rs, byUserId)).where(eq(symptom.symptomId, id));
  await audit(db, byUserId, {
    action: rs === 'DELETED' ? 'DELETE' : 'STATUS',
    module: 'Admin',
    entity: 'symptom',
    key: id,
    summary: `อาการเสีย #${id} → ${rs}`,
    changes: { recordStatus: [old?.rs ?? null, rs] },
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
  // one name per brand, ignoring case + spaces (ix_unique_model used to answer a duplicate with a 500);
  // a model keeping its own name and brand is not checked
  const [before] = input.code
    ? await db
        .select({ name: model.modelName, mfg: model.manufacturerId })
        .from(model)
        .where(eq(model.modelCode, input.code))
    : [];
  if (!before || before.mfg !== brand[0].id || masterNameKey(before.name) !== masterNameKey(name)) {
    const [dup] = await db
      .select({ code: model.modelCode, name: model.modelName, rs: model.recordStatus })
      .from(model)
      .where(
        and(
          eq(model.manufacturerId, brand[0].id),
          sql`${nameKeyOf(model.modelName)} = ${masterNameKey(name)}`,
          ne(model.recordStatus, RS.DELETED),
          input.code ? sql`${model.modelCode} is distinct from ${input.code}` : undefined,
        ),
      )
      .limit(1);
    if (dup) throw duplicate({ name: dup.name, ref: dup.code ?? '', rs: dup.rs });
  }
  const values = {
    modelName: name,
    manufacturerId: brand[0].id,
    marketPrice: money(num(input.price)),
    ...statusStamp(fromUiStatus(input.status), byUserId),
    lastUpdate: nowThai(),
  };

  const code = await db.transaction(async (tx) => {
    if (input.code) {
      const [before] = await tx.select().from(model).where(eq(model.modelCode, input.code));
      await tx.update(model).set(values).where(eq(model.modelCode, input.code));
      await audit(tx, byUserId, {
        action: 'UPDATE',
        module: 'Admin',
        entity: 'model',
        key: input.code,
        summary: `แก้ไขรุ่นสินค้า ${name}`,
        changes: diff(before as Record<string, unknown>, values as Record<string, unknown>),
      });
      return input.code;
    }
    const c = await nextRunningNo(tx, 'Model');
    await tx.insert(model).values({ ...values, modelCode: c, tierId: 0 });
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
  const [old] = await db.select({ rs: model.recordStatus }).from(model).where(eq(model.modelCode, code));
  await db
    .update(model)
    .set({ ...statusStamp(rs, byUserId), lastUpdate: nowThai() })
    .where(eq(model.modelCode, code));
  await audit(db, byUserId, {
    action: rs === 'DELETED' ? 'DELETE' : 'STATUS',
    module: 'Admin',
    entity: 'model',
    key: code,
    summary: `รุ่นสินค้า ${code} → ${rs}`,
    changes: { recordStatus: [old?.rs ?? null, rs] },
  });
  invalidate('master:models:');
}

export { runningNo };

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
