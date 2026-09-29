import "server-only";
import { invalidate } from "@/server/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appUser, customer, job, jobLog, product, quotationHd, saleOutHd } from "@/db/schema";
import type { Module } from "@/lib/modules";
import { HttpError, invalidateUserCache } from "@/server/auth";
import { audit } from "@/server/audit";
import { nowThai, SENTINEL_TS } from "@/server/mappers/format";
import { RS, statusStamp, type RecordStatus } from "@/server/record-status";
import { isSimpleKind, setModelStatus, setSimpleStatus, setSymptomStatus } from "./masters";

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

/**
 * Set record_status (ACTIVE / INACTIVE / DELETED) on any entity. Nothing is ever
 * hard-deleted. The legacy flag each table used before is mirrored so the old
 * reports still agree:
 *   masters / customers / products / quotations → is_active
 *   users → is_active + deleted
 *   jobs → DELETED also sets job_status 0 "ยกเลิกข้อมูล" (+ job_log), as the old app did
 *   sale orders → document_status + cancel stamp
 * Restoring a DELETED row is done in SQL only (by decision) — the API still
 * accepts ACTIVE so the existing users-page restore button keeps working.
 */
export async function setRecordStatus(
  table: RecordTable,
  id: string | number,
  rs: RecordStatus,
  byUserId: number
): Promise<void> {
  const stamp = statusStamp(rs, byUserId);
  const ENTITY: Record<string, [string, string]> = {
    users: ["app_user", "Admin"], products: ["product", "Product"], customers: ["customer", "Customer"],
    jobs: ["job", "Job Management"], quotations: ["quotation_hd", "Quotation"], sale_orders: ["sale_out_hd", "Sale Order"],
  };
  const log = async (w: Parameters<typeof audit>[0] = db) => {
    const e = ENTITY[table];
    if (!e) return;
    await audit(w, byUserId, {
      action: rs === RS.DELETED ? "DELETE" : "STATUS",
      module: e[1],
      entity: e[0],
      key: id,
      summary: rs === RS.DELETED ? `ลบ (soft delete) ${e[0]} ${id}` : `${e[0]} ${id} → ${rs}`,
      changes: { recordStatus: [null, rs] },
    });
  };
  if (isSimpleKind(table)) return setSimpleStatus(table, Number(id), rs, byUserId);
  switch (table) {
    case "symptoms":
      return setSymptomStatus(Number(id), rs, byUserId);
    case "models":
      return setModelStatus(String(id), rs, byUserId);
    case "users":
      await db
        .update(appUser)
        .set({ ...stamp, deleted: rs === RS.DELETED })
        .where(eq(appUser.userId, Number(id)));
      invalidateUserCache();
      invalidate("staff");
      await log();
      return;
    case "products":
      await db
        .update(product)
        .set(
          rs === RS.DELETED
            ? { ...stamp, cancelDate: nowThai(), cancelBy: byUserId }
            : { ...stamp, cancelDate: SENTINEL_TS, cancelBy: -1, cancelRemark: "" }
        )
        .where(eq(product.productCode, String(id)));
      await log();
      return;
    case "customers":
      await db.update(customer).set(stamp).where(eq(customer.customerCode, String(id)));
      await log();
      return;
    case "quotations":
      await db.update(quotationHd).set(stamp).where(eq(quotationHd.quotationNo, String(id)));
      await log();
      return;
    case "jobs": {
      await db.transaction(async (tx) => {
        const [cur] = await tx.select({ st: job.jobStatusId }).from(job).where(eq(job.jobNo, String(id)));
        if (!cur) throw new HttpError(404, "job not found");
        await tx
          .update(job)
          .set({ ...statusStamp(rs, byUserId, false), ...(rs === RS.DELETED ? { jobStatusId: JOB_STATUS_CANCELLED } : {}) })
          .where(eq(job.jobNo, String(id)));
        if (rs === RS.DELETED && cur.st !== JOB_STATUS_CANCELLED) {
          await tx.insert(jobLog).values({ jobNo: String(id), jobStatusId: JOB_STATUS_CANCELLED, jobLogDate: nowThai(), jobActionBy: byUserId });
        }
        await log(tx);
      });
      return;
    }
    case "sale_orders":
      await db
        .update(saleOutHd)
        .set(
          rs === RS.DELETED
            ? { ...statusStamp(rs, byUserId, false), documentStatus: false, documentCancelDate: nowThai(), documentCancelBy: byUserId }
            : { ...statusStamp(rs, byUserId, false), documentStatus: true, documentCancelDate: SENTINEL_TS, documentCancelBy: -1, documentCancelRemark: "" }
        )
        .where(eq(saleOutHd.saleOutHdNo, String(id)));
      await log();
      return;
  }
}
