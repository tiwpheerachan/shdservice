import "server-only";
import { and, eq, sql } from "drizzle-orm";
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

const PER_PROFILE: ReadonlySet<RunningType> = new Set(["Job", "Quotation", "SaleOrder"]);

export async function nextRunningNo(
  tx: Tx,
  type: RunningType,
  profile?: { id: number; prefix: string }
): Promise<string> {
  const def = DEFAULTS[type];
  const year = def.yearly ? thaiYear() : 0;
  const companyId = PER_PROFILE.has(type) ? (profile?.id ?? 1) : null;
  const prefixForNew = (companyId !== null && profile?.prefix) || def.prefix;

  // lock the row for this type(+profile)+year (or the type's single row for non-yearly)
  const locked = await tx.execute(sql`
    SELECT running_id, prefix, pyear, number, length_year, length_number
      FROM running_no
     WHERE running_type = ${type} AND pyear = ${year}
       AND (${companyId}::int IS NULL OR company_id = ${companyId})
     ORDER BY running_id DESC
     LIMIT 1
     FOR UPDATE`);
  let row = locked.rows[0] as
    | { running_id: number; prefix: string; pyear: number; number: number; length_year: number; length_number: number }
    | undefined;

  if (!row && def.yearly) {
    // new year: the legacy app either updated the single row (Job/SaleOrder) or
    // inserted a new one (Quotation/Inventory). Inserting a fresh row is correct
    // for both — old-year rows are then just history.
    const prev = await tx.execute(sql`
      SELECT prefix, length_year, length_number, company_id, branch_id
        FROM running_no WHERE running_type = ${type}
         AND (${companyId}::int IS NULL OR company_id = ${companyId})
       ORDER BY pyear DESC, running_id DESC LIMIT 1`);
    const p = prev.rows[0] as
      | { prefix: string; length_year: number; length_number: number; company_id: number; branch_id: number }
      | undefined;
    const [ins] = await tx
      .insert(runningNo)
      .values({
        runningType: type,
        companyId: companyId ?? p?.company_id ?? 0,
        branchId: p?.branch_id ?? 0,
        prefix: p?.prefix ?? prefixForNew,
        pyear: year,
        pmonth: 0,
        pday: 0,
        number: 0,
        lengthYear: p?.length_year ?? 2,
        lengthMonth: 0,
        lengthNumber: p?.length_number ?? def.len,
      })
      .returning({ id: runningNo.runningId });
    row = {
      running_id: ins.id,
      prefix: p?.prefix ?? prefixForNew,
      pyear: year,
      number: 0,
      length_year: p?.length_year ?? 2,
      length_number: p?.length_number ?? def.len,
    };
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
      .returning({ id: runningNo.runningId });
    row = { running_id: ins.id, prefix: prefixForNew, pyear: 0, number: 0, length_year: 0, length_number: def.len };
  }

  const next = Number(row.number) + 1;
  await tx
    .update(runningNo)
    .set({ number: next })
    .where(and(eq(runningNo.runningId, row.running_id)));

  const yy = Number(row.length_year) === 2 ? String(row.pyear).slice(-2) : Number(row.length_year) === 4 ? String(row.pyear) : "";
  return `${row.prefix}${yy}${String(next).padStart(Number(row.length_number), "0")}`;
}
