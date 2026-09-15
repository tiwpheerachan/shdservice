import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { customer, job, jobLog, product, quotationHd, saleOutHd } from "@/db/schema";
import type { Module } from "@/lib/modules";
import { HttpError } from "@/server/auth";
import { nowThai, SENTINEL_TS } from "@/server/mappers/format";
import { isSimpleKind, setModelActive, setSimpleActive, setSymptomActive } from "./masters";

export type RecordTable =
  | "users"
  | "categories"
  | "manufacturers"
  | "colors"
  | "job_types"
  | "product_types"
  | "symptoms"
  | "models"
  | "products"
  | "customers"
  | "jobs"
  | "quotations"
  | "sale_orders";

/** Module whose `del` grant is required; null = System Admin only. */
export const RECORD_MODULES: Record<Exclude<RecordTable, "users">, Module | null> = {
  categories: null,
  manufacturers: null,
  colors: null,
  job_types: null,
  product_types: null,
  symptoms: null,
  models: null,
  products: "Product",
  customers: "Customer",
  jobs: "Job Management",
  quotations: "Quotation",
  sale_orders: "Sale Order",
};

const JOB_STATUS_CANCELLED = 0;
const JOB_STATUS_NEW = 1;

/**
 * "Delete" in the legacy schema is a per-table convention, never a row delete:
 *   masters/customers/products/quotations → is_active = false
 *   jobs → job_status 0 "ยกเลิกข้อมูล" (+ job_log); restore → back to 1 "งานใหม่"
 *   sale orders → document_status = false + cancel stamp
 */
export async function setRecordDeleted(
  table: Exclude<RecordTable, "users">,
  id: string | number,
  deleted: boolean,
  byUserId: number
): Promise<void> {
  const active = !deleted;
  if (isSimpleKind(table)) return setSimpleActive(table, Number(id), active);
  switch (table) {
    case "symptoms":
      return setSymptomActive(Number(id), active);
    case "models":
      return setModelActive(String(id), active);
    case "products":
      await db
        .update(product)
        .set(
          deleted
            ? { isActive: false, cancelDate: nowThai(), cancelBy: byUserId }
            : { isActive: true, cancelDate: SENTINEL_TS, cancelBy: -1, cancelRemark: "" }
        )
        .where(eq(product.productCode, String(id)));
      return;
    case "customers":
      await db.update(customer).set({ isActive: active }).where(eq(customer.customerCode, String(id)));
      return;
    case "quotations":
      await db.update(quotationHd).set({ isActive: active }).where(eq(quotationHd.quotationNo, String(id)));
      return;
    case "jobs": {
      const status = deleted ? JOB_STATUS_CANCELLED : JOB_STATUS_NEW;
      await db.transaction(async (tx) => {
        const r = await tx.update(job).set({ jobStatusId: status }).where(eq(job.jobNo, String(id))).returning({ no: job.jobNo });
        if (!r[0]) throw new HttpError(404, "job not found");
        await tx.insert(jobLog).values({ jobNo: String(id), jobStatusId: status, jobLogDate: nowThai(), jobActionBy: byUserId });
      });
      return;
    }
    case "sale_orders":
      await db
        .update(saleOutHd)
        .set(
          deleted
            ? { documentStatus: false, documentCancelDate: nowThai(), documentCancelBy: byUserId }
            : { documentStatus: true, documentCancelDate: SENTINEL_TS, documentCancelBy: -1, documentCancelRemark: "" }
        )
        .where(eq(saleOutHd.saleOutHdNo, String(id)));
      return;
  }
}
