import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  category,
  color,
  jobType,
  manufacturer,
  model,
  productType,
  symptom,
  runningNo,
} from "@/db/schema";
import type { MasterRow, Symptom, Model } from "@/data/mock";
import { HttpError } from "@/server/auth";
import { fmtDateTime, money, nowThai, num, str } from "@/server/mappers/format";
import { nextRunningNo } from "@/db/running-no";
import { count, desc, ilike, or } from "drizzle-orm";
import { orderBy as orderByCols, offsetOf, type Page, type PageQuery } from "@/server/paging";
import { statusFilter, uiStatus, fromUiStatus, statusStamp, type StatusMode, type RecordStatus } from "@/server/record-status";

export type DeletedMode = StatusMode;

const status = (rs: string | null) => uiStatus(rs) as MasterRow["status"];

/* ------------------------------------------------------------------ *
 * Simple id/name/detail/is_active masters
 * ------------------------------------------------------------------ */
type SimpleKind = "categories" | "manufacturers" | "colors" | "job_types" | "product_types";

const SIMPLE = {
  categories: {
    table: category,
    id: category.categoryId,
    name: category.categoryName,
    detail: category.categoryDescription,
    extra: category.shotCode,
    active: category.recordStatus,
    // drizzle insert/update keys (TS property names, not DB column names)
    keys: { name: "categoryName", detail: "categoryDescription", extra: "shotCode", active: "isActive" },
    nameLen: 50,
  },
  manufacturers: {
    table: manufacturer,
    id: manufacturer.manufacturerId,
    name: manufacturer.manufacturerName,
    detail: manufacturer.logoName,
    extra: null,
    active: manufacturer.recordStatus,
    keys: { name: "manufacturerName", detail: "logoName", extra: null, active: "isActive" },
    nameLen: 50,
  },
  colors: {
    table: color,
    id: color.id,
    name: color.colorName,
    detail: color.description,
    extra: null,
    active: color.recordStatus,
    keys: { name: "colorName", detail: "description", extra: null, active: "isActive" },
    nameLen: 50,
  },
  job_types: {
    table: jobType,
    id: jobType.jobTypeId,
    name: jobType.jobTypeName,
    detail: jobType.jobTypeDescription,
    extra: null,
    active: jobType.recordStatus,
    keys: { name: "jobTypeName", detail: "jobTypeDescription", extra: null, active: "isActive" },
    nameLen: 50,
  },
  product_types: {
    table: productType,
    id: productType.productTypeId,
    name: productType.productTypeName,
    detail: null,
    extra: null,
    active: productType.recordStatus,
    keys: { name: "productTypeName", detail: null, extra: null, active: "isActive" },
    nameLen: 50,
  },
} as const;

export function isSimpleKind(k: string): k is SimpleKind {
  return k in SIMPLE;
}

export async function listSimple(kind: SimpleKind, deleted: DeletedMode = "exclude"): Promise<MasterRow[]> {
  const d = SIMPLE[kind];
  const rows = await db
    .select({
      id: d.id,
      name: d.name,
      detail: d.detail ?? sql<string>`''`,
      extra: d.extra ?? sql<string>`''`,
      active: d.active,
    })
    .from(d.table)
    .where(statusFilter(d.active, deleted))
    .orderBy(asc(d.id));
  return rows.map((r) => ({
    id: String(r.id),
    name: r.name ?? "",
    detail: r.detail ?? "",
    status: status(r.active),
    extra: r.extra ?? "",
  }));
}

export async function saveSimple(
  kind: SimpleKind,
  input: { id?: string; name: string; detail?: string; extra?: string; status?: string },
  byUserId = 0
): Promise<MasterRow> {
  const d = SIMPLE[kind];
  const name = str(input.name).slice(0, d.nameLen);
  if (!name) throw new HttpError(400, "ต้องระบุชื่อ");
  const rs = fromUiStatus(input.status);
  const values: Record<string, unknown> = { [d.keys.name]: name, [d.keys.active]: rs === "ACTIVE", recordStatus: rs, statusChangedAt: nowThai(), statusChangedBy: byUserId };
  if (d.keys.detail) values[d.keys.detail] = str(input.detail).slice(0, 100);
  if (d.keys.extra) values[d.keys.extra] = str(input.extra).slice(0, 50);

  // unique-name guard (legacy has unique indexes on most names)
  const dup = await db
    .select({ id: d.id })
    .from(d.table)
    .where(and(eq(d.name, name), input.id ? ne(d.id, Number(input.id)) : undefined))
    .limit(1);
  if (dup[0]) throw new HttpError(409, `มีชื่อ "${name}" อยู่แล้ว`);

  if (input.id) {
    await db.update(d.table).set(values).where(eq(d.id, Number(input.id)));
    const rows = await listSimple(kind, "exclude");
    return rows.find((r) => r.id === input.id)!;
  }
  const [row] = await db.insert(d.table).values(values).returning({ id: d.id });
  const rows = await listSimple(kind, "exclude");
  return rows.find((r) => r.id === String(row.id))!;
}

/** ACTIVE ↔ INACTIVE toggle or DELETED (soft delete). */
export async function setSimpleStatus(kind: SimpleKind, id: number, rs: RecordStatus, byUserId: number) {
  const d = SIMPLE[kind];
  await db.update(d.table).set({ [d.keys.active]: rs === "ACTIVE", ...statusStamp(rs, byUserId, false) }).where(eq(d.id, id));
}

/* ------------------------------------------------------------------ *
 * Symptoms (+ group)
 * ------------------------------------------------------------------ */
export async function listSymptoms(deleted: DeletedMode = "exclude"): Promise<Symptom[]> {
  const rows = await db
    .select()
    .from(symptom)
    .where(statusFilter(symptom.recordStatus, deleted))
    .orderBy(asc(symptom.symptomId));
  return rows.map((r) => ({
    id: String(r.symptomId),
    name: r.symptomName ?? "",
    detail: r.symptomDescription ?? "",
    group: r.symptomGroupName ?? "",
    status: status(r.recordStatus),
    extra: "",
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
  byUserId = 0
): Promise<Symptom> {
  const name = str(input.name).slice(0, 50);
  if (!name) throw new HttpError(400, "ต้องระบุชื่ออาการเสีย");
  const values = {
    symptomName: name,
    symptomDescription: str(input.detail).slice(0, 100),
    symptomGroupName: str(input.group).slice(0, 50),
    ...statusStamp(fromUiStatus(input.status), byUserId),
  };
  let id: number;
  if (input.id) {
    id = Number(input.id);
    await db.update(symptom).set(values).where(eq(symptom.symptomId, id));
  } else {
    const [row] = await db.insert(symptom).values(values).returning({ id: symptom.symptomId });
    id = row.id;
  }
  return (await listSymptoms("exclude")).find((r) => r.id === String(id))!;
}

export async function setSymptomStatus(id: number, rs: RecordStatus, byUserId: number) {
  await db.update(symptom).set(statusStamp(rs, byUserId)).where(eq(symptom.symptomId, id));
}

/* ------------------------------------------------------------------ *
 * Models (code from running "Model" = MD00001)
 * ------------------------------------------------------------------ */
export async function listModels(deleted: DeletedMode = "exclude"): Promise<Model[]> {
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
    name: r.name ?? "",
    brand: r.brand ?? "",
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
  byUserId = 0
): Promise<Model> {
  const name = str(input.name).slice(0, 50);
  if (!name) throw new HttpError(400, "ต้องระบุ Model Name");
  const brand = await db
    .select({ id: manufacturer.manufacturerId })
    .from(manufacturer)
    .where(eq(manufacturer.manufacturerName, str(input.brand)))
    .limit(1);
  if (!brand[0]) throw new HttpError(400, "ไม่พบยี่ห้อ " + str(input.brand));
  const values = {
    modelName: name,
    manufacturerId: brand[0].id,
    marketPrice: money(num(input.price)),
    ...statusStamp(fromUiStatus(input.status), byUserId),
    lastUpdate: nowThai(),
  };

  const code = await db.transaction(async (tx) => {
    if (input.code) {
      await tx.update(model).set(values).where(eq(model.modelCode, input.code));
      return input.code;
    }
    const c = await nextRunningNo(tx, "Model");
    await tx.insert(model).values({ ...values, modelCode: c, tierId: 0 });
    return c;
  });
  return (await listModels("exclude")).find((r) => r.code === code)!;
}

export async function setModelStatus(code: string, rs: RecordStatus, byUserId: number) {
  await db.update(model).set({ ...statusStamp(rs, byUserId), lastUpdate: nowThai() }).where(eq(model.modelCode, code));
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

export async function pageModels(p: PageQuery, mode: StatusMode = "exclude"): Promise<Page<Model>> {
  const term = p.q.trim();
  const w = and(
    statusFilter(model.recordStatus, mode),
    term ? or(ilike(model.modelCode, `%${term}%`), ilike(model.modelName, `%${term}%`), ilike(manufacturer.manufacturerName, `%${term}%`)) : undefined
  );
  const [{ total }] = await db
    .select({ total: count() })
    .from(model)
    .leftJoin(manufacturer, eq(manufacturer.manufacturerId, model.manufacturerId))
    .where(w);
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
    .where(w)
    .orderBy(...orderByCols(p.sort, MODEL_SORT, [desc(model.modelId)]))
    .limit(p.pageSize)
    .offset(offsetOf(p));
  return {
    rows: rows.map((r) => ({
      code: r.code ?? String(r.id),
      name: r.name ?? "",
      brand: r.brand ?? "",
      price: num(r.price),
      updated: fmtDateTime(r.updated),
      status: status(r.active),
    })),
    total: Number(total),
    page: p.page,
    pageSize: p.pageSize,
  };
}
