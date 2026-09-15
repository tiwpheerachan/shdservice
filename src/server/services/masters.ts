import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
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

export type DeletedMode = "exclude" | "only" | "all";

const activeFilter = (col: PgColumn, deleted: DeletedMode) =>
  deleted === "exclude" ? ne(col, false) : deleted === "only" ? eq(col, false) : undefined;

const status = (active: boolean | null) => (active === false ? "Inactive" : "Active") as MasterRow["status"];

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
    active: category.isActive,
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
    active: manufacturer.isActive,
    keys: { name: "manufacturerName", detail: "logoName", extra: null, active: "isActive" },
    nameLen: 50,
  },
  colors: {
    table: color,
    id: color.id,
    name: color.colorName,
    detail: color.description,
    extra: null,
    active: color.isActive,
    keys: { name: "colorName", detail: "description", extra: null, active: "isActive" },
    nameLen: 50,
  },
  job_types: {
    table: jobType,
    id: jobType.jobTypeId,
    name: jobType.jobTypeName,
    detail: jobType.jobTypeDescription,
    extra: null,
    active: jobType.isActive,
    keys: { name: "jobTypeName", detail: "jobTypeDescription", extra: null, active: "isActive" },
    nameLen: 50,
  },
  product_types: {
    table: productType,
    id: productType.productTypeId,
    name: productType.productTypeName,
    detail: null,
    extra: null,
    active: productType.isActive,
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
    .where(activeFilter(d.active, deleted))
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
  input: { id?: string; name: string; detail?: string; extra?: string; status?: string }
): Promise<MasterRow> {
  const d = SIMPLE[kind];
  const name = str(input.name).slice(0, d.nameLen);
  if (!name) throw new HttpError(400, "ต้องระบุชื่อ");
  const values: Record<string, unknown> = { [d.keys.name]: name, [d.keys.active]: (input.status ?? "Active") !== "Inactive" };
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
    const rows = await listSimple(kind, "all");
    return rows.find((r) => r.id === input.id)!;
  }
  const [row] = await db.insert(d.table).values(values).returning({ id: d.id });
  const rows = await listSimple(kind, "all");
  return rows.find((r) => r.id === String(row.id))!;
}

export async function setSimpleActive(kind: SimpleKind, id: number, active: boolean) {
  const d = SIMPLE[kind];
  await db.update(d.table).set({ [d.keys.active]: active }).where(eq(d.id, id));
}

/* ------------------------------------------------------------------ *
 * Symptoms (+ group)
 * ------------------------------------------------------------------ */
export async function listSymptoms(deleted: DeletedMode = "exclude"): Promise<Symptom[]> {
  const rows = await db
    .select()
    .from(symptom)
    .where(activeFilter(symptom.isActive, deleted))
    .orderBy(asc(symptom.symptomId));
  return rows.map((r) => ({
    id: String(r.symptomId),
    name: r.symptomName ?? "",
    detail: r.symptomDescription ?? "",
    group: r.symptomGroupName ?? "",
    status: status(r.isActive),
    extra: "",
  }));
}

export async function saveSymptom(input: {
  id?: string;
  name: string;
  detail?: string;
  group?: string;
  status?: string;
}): Promise<Symptom> {
  const name = str(input.name).slice(0, 50);
  if (!name) throw new HttpError(400, "ต้องระบุชื่ออาการเสีย");
  const values = {
    symptomName: name,
    symptomDescription: str(input.detail).slice(0, 100),
    symptomGroupName: str(input.group).slice(0, 50),
    isActive: (input.status ?? "Active") !== "Inactive",
  };
  let id: number;
  if (input.id) {
    id = Number(input.id);
    await db.update(symptom).set(values).where(eq(symptom.symptomId, id));
  } else {
    const [row] = await db.insert(symptom).values(values).returning({ id: symptom.symptomId });
    id = row.id;
  }
  return (await listSymptoms("all")).find((r) => r.id === String(id))!;
}

export async function setSymptomActive(id: number, active: boolean) {
  await db.update(symptom).set({ isActive: active }).where(eq(symptom.symptomId, id));
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
      active: model.isActive,
      id: model.modelId,
    })
    .from(model)
    .leftJoin(manufacturer, eq(manufacturer.manufacturerId, model.manufacturerId))
    .where(activeFilter(model.isActive, deleted))
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

export async function saveModel(input: {
  code?: string;
  name: string;
  brand: string;
  price?: number | string;
  status?: string;
}): Promise<Model> {
  const name = str(input.name).slice(0, 50);
  if (!name) throw new HttpError(400, "ต้องระบุ Model Name");
  const brand = await db
    .select({ id: manufacturer.manufacturerId })
    .from(manufacturer)
    .where(eq(manufacturer.manufacturerName, str(input.brand)))
    .limit(1);
  if (!brand[0]) throw new HttpError(400, "ไม่พบยี่ห้อ " + str(input.brand));
  const active = (input.status ?? "Active") !== "Inactive";

  const values = {
    modelName: name,
    manufacturerId: brand[0].id,
    marketPrice: money(num(input.price)),
    isActive: active,
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
  return (await listModels("all")).find((r) => r.code === code)!;
}

export async function setModelActive(code: string, active: boolean) {
  await db.update(model).set({ isActive: active, lastUpdate: nowThai() }).where(eq(model.modelCode, code));
}

export { runningNo };
