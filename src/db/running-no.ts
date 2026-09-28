import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { runningNo } from "./schema";
import type { Tx } from "./client";
import { thaiYear } from "@/server/mappers/format";

/**
 * Document numbers come from the legacy `running_no` table:
 *   number = prefix + (yy if length_year = 2) + zero-padded running.
 * Yearly types (Job, Quotation, SaleOrder, Inventory-In, Inventory-Out) keep a
 * row per pyear; the others (Customer, Product, Model) use pyear = 0.
 * Must be called inside the same transaction as the insert that uses the number
 * (the row is locked with FOR UPDATE so concurrent callers never share a value).
 *
 * Job / Quotation / SaleOrder run one series per issuing profile ("ออกเอกสารในนาม",
 * drizzle/0007): `company_id` = document_profile.id and the prefix comes from the
 * profile (SHD = 1 keeps the legacy J / Q / SO). Everything else is one series.
 */
export type RunningType =
  | "Job"
  | "Quotation"
  | "SaleOrder"
  | "Inventory-In"
  | "Inventory-Out"
  | "Customer"
  | "Product"
  | "Model";

const DEFAULTS: Record<RunningType, { prefix: string; yearly: boolean; len: number }> = {
  Job: { prefix: "J", yearly: true, len: 5 },
  Quotation: { prefix: "Q", yearly: true, len: 5 },
  SaleOrder: { prefix: "SO", yearly: true, len: 5 },
  "Inventory-In": { prefix: "WHI", yearly: true, len: 5 },
  "Inventory-Out": { prefix: "WHO", yearly: true, len: 5 },
  Customer: { prefix: "C", yearly: false, len: 5 },
  Product: { prefix: "P", yearly: false, len: 5 },
  Model: { prefix: "MD", yearly: false, len: 5 },
};

/**
 * Job / Quotation / SaleOrder rows carry company_id = 1 in the legacy table
 * (normalised in 0007, re-asserted in 0010). Numbers are ONE series per document
 * type for the whole company — "ออกเอกสารในนาม" never changes the number.
 */
const COMPANY_ROWS: ReadonlySet<RunningType> = new Set(["Job", "Quotation", "SaleOrder"]);

export async function nextRunningNo(tx: Tx, type: RunningType): Promise<string> {
  const def = DEFAULTS[type];
  const year = def.yearly ? thaiYear() : 0;
  const companyId = COMPANY_ROWS.has(type) ? 1 : null;
  const prefixForNew = def.prefix;

  // lock the row for this type(+profile)+year (or the type's single row for non-yearly)
  const sameSeries = and(eq(runningNo.runningType, type), companyId === null ? undefined : eq(runningNo.companyId, companyId));
  const cols = {
    runningId: runningNo.runningId,
    prefix: runningNo.prefix,
    pyear: runningNo.pyear,
    number: runningNo.number,
    lengthYear: runningNo.lengthYear,
    lengthNumber: runningNo.lengthNumber,
  };
  let [row]: { runningId: number; prefix: string; pyear: number; number: number; lengthYear: number; lengthNumber: number }[] = await tx
    .select(cols)
    .from(runningNo)
    .where(and(sameSeries, eq(runningNo.pyear, year)))
    .orderBy(desc(runningNo.runningId))
    .limit(1)
    .for("update");

  if (!row && def.yearly) {
    // new year: the legacy app either updated the single row (Job/SaleOrder) or
    // inserted a new one (Quotation/Inventory). Inserting a fresh row is correct
    // for both — old-year rows are then just history.
    const [p] = await tx
      .select({
        prefix: runningNo.prefix,
        lengthYear: runningNo.lengthYear,
        lengthNumber: runningNo.lengthNumber,
        companyId: runningNo.companyId,
        branchId: runningNo.branchId,
      })
      .from(runningNo)
      .where(sameSeries)
      .orderBy(desc(runningNo.pyear), desc(runningNo.runningId))
      .limit(1);
    const [ins] = await tx
      .insert(runningNo)
      .values({
        runningType: type,
        companyId: companyId ?? p?.companyId ?? 0,
        branchId: p?.branchId ?? 0,
        prefix: p?.prefix ?? prefixForNew,
        pyear: year,
        pmonth: 0,
        pday: 0,
        number: 0,
        lengthYear: p?.lengthYear ?? 2,
        lengthMonth: 0,
        lengthNumber: p?.lengthNumber ?? def.len,
      })
      .returning(cols);
    row = ins;
  } else if (!row) {
    const [ins] = await tx
      .insert(runningNo)
      .values({
        runningType: type,
        companyId: companyId ?? 0,
        branchId: 0,
        prefix: prefixForNew,
        pyear: 0,
        pmonth: 0,
        pday: 0,
        number: 0,
        lengthYear: 0,
        lengthMonth: 0,
        lengthNumber: def.len,
      })
      .returning(cols);
    row = ins;
  }

  const next = Number(row.number) + 1;
  await tx
    .update(runningNo)
    .set({ number: next })
    .where(eq(runningNo.runningId, row.runningId));

  const yy = Number(row.lengthYear) === 2 ? String(row.pyear).slice(-2) : Number(row.lengthYear) === 4 ? String(row.pyear) : "";
  return `${row.prefix}${yy}${String(next).padStart(Number(row.lengthNumber), "0")}`;
}
