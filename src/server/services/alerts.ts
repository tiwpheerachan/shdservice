import "server-only";
import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { appUser, customer, job, jobStatus, manufacturer } from "@/db/schema";
import { cached } from "@/server/cache";
import { RS } from "@/server/record-status";
import { fmtDate } from "@/server/mappers/format";
import type { CurrentUser } from "@/server/auth";
import { daysOverdue, overdueWhere } from "./jobs";

/**
 * Notification bell (topbar): jobs past their customer due date that are still open
 * (Pending + Repaired-not-returned), with who is responsible.
 *
 *  - an Engineer sees the jobs assigned to them; every other role sees all of them
 *  - responsible = the assigned engineer; none yet → "ยังไม่มอบหมายช่าง" + who opened the job
 *  - same condition as the job list's `overdue=1` filter (jobs.ts overdueWhere), so
 *    "ดูทั้งหมด" lands on exactly these jobs
 */
export type OverdueItem = {
  no: string;
  product: string;
  customer: string;
  status: string;
  dueDate: string;
  daysOver: number;
  engineer: string | null;
  openedBy: string;
};
export type OverdueOwner = { engineerId: number | null; name: string; count: number };
export type OverdueAlerts = {
  scope: "mine" | "all";
  /** the engineer the list is limited to (scope "mine") — for the "ดูทั้งหมด" link */
  engineerId: number | null;
  total: number;
  unassigned: number;
  owners: OverdueOwner[];
  items: OverdueItem[];
};

const ITEM_LIMIT = 30;
const OWNER_LIMIT = 8;
const eng = alias(appUser, "eng");
const opener = alias(appUser, "opener");
const nameOf = (u: { firstName: AnyPgColumn; lastName: AnyPgColumn }) =>
  sql<string>`trim(coalesce(${u.firstName}, '') || ' ' || coalesce(${u.lastName}, ''))`;
const assigned = sql`coalesce(${job.engineerId}, 0) > 0`;

export const isEngineer = (u: CurrentUser) => (u.userType ?? "").trim() === "Engineer";

export function overdueAlerts(u: CurrentUser): Promise<OverdueAlerts> {
  const mine = isEngineer(u);
  // one minute is fresh enough for a bell; keyed by scope so engineers never share a list
  return cached(`alerts:overdue:${mine ? u.userId : "all"}`, 60_000, () => load(mine ? u.userId : null));
}

async function load(engineerId: number | null): Promise<OverdueAlerts> {
  const where = and(ne(job.recordStatus, RS.DELETED), overdueWhere, engineerId === null ? undefined : eq(job.engineerId, engineerId));

  const [[totals], owners, items] = await Promise.all([
    db
      .select({ total: count(), unassigned: sql<number>`count(*) filter (where not ${assigned})`.mapWith(Number) })
      .from(job)
      .innerJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
      .where(where),
    engineerId !== null
      ? Promise.resolve([])
      : db
          .select({ engineerId: job.engineerId, name: nameOf(eng), count: count() })
          .from(job)
          .innerJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
          .leftJoin(eng, eq(eng.userId, job.engineerId))
          .where(and(where, assigned))
          .groupBy(job.engineerId, eng.firstName, eng.lastName)
          .orderBy(desc(count()))
          .limit(OWNER_LIMIT),
    // most recently overdue first: the ones someone can still act on today
    db
      .select({
        no: job.jobNo,
        brand: manufacturer.manufacturerName,
        model: job.productModelName,
        customer: customer.customerName,
        customerDetail: job.customerDetail,
        status: jobStatus.jobStatusName,
        dueDate: job.customerDueDate,
        daysOver: daysOverdue,
        engineerId: job.engineerId,
        engineer: nameOf(eng),
        openedBy: nameOf(opener),
      })
      .from(job)
      .innerJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
      .leftJoin(manufacturer, eq(manufacturer.manufacturerId, job.productBrandId))
      .leftJoin(customer, eq(customer.customerId, job.customerId))
      .leftJoin(eng, eq(eng.userId, job.engineerId))
      .leftJoin(opener, eq(opener.userId, job.jobCreateBy))
      .where(where)
      .orderBy(desc(job.customerDueDate), desc(job.jobNo))
      .limit(ITEM_LIMIT),
  ]);

  return {
    scope: engineerId === null ? "all" : "mine",
    engineerId,
    total: Number(totals?.total ?? 0),
    unassigned: Number(totals?.unassigned ?? 0),
    owners: owners.map((o) => ({ engineerId: o.engineerId, name: o.name || `ผู้ใช้ #${o.engineerId}`, count: Number(o.count) })),
    items: items.map((r) => ({
      no: r.no,
      product: [r.brand, r.model].filter(Boolean).join(" ").trim(),
      // customer_detail = "C43600 ชื่อ เบอร์" when the customer row is missing
      customer: (r.customer ?? r.customerDetail ?? "").replace(/^[A-Z]\d+\s+/i, "").trim(),
      status: (r.status ?? "").trim(),
      dueDate: fmtDate(r.dueDate),
      daysOver: r.daysOver,
      engineer: (r.engineerId ?? 0) > 0 ? r.engineer || `ผู้ใช้ #${r.engineerId}` : null,
      openedBy: r.openedBy,
    })),
  };
}
