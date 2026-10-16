import 'server-only';
import { and, count, desc, eq, ne, sql } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '@/db/client';
import { appUser, customer, job, jobStatus, manufacturer, saleOutHd } from '@/db/schema';
import { cached } from '@/server/cache';
import { RS } from '@/server/record-status';
import { fmtDate, fmtDateTime, num } from '@/server/mappers/format';
import { fullName, hasRight, type CurrentUser } from '@/server/auth';
import { daysOverdue, effectiveDue, effectiveDueText, overdueWhere } from './jobs';
import { AS } from './sale-orders';

/**
 * Notification bell (topbar): jobs past their customer due date that are still open
 * (Pending + Repaired-not-returned), with who is responsible.
 *
 *  - who takes jobs (Job Take) sees the jobs assigned to them, unless also Overdue All (a head engineer);
 *    every other role sees all of them
 *  - responsible = the assigned engineer; none yet → "ยังไม่มอบหมายช่าง" + who opened the job
 *  - same condition as the job list's `overdue=1` filter (jobs.ts overdueWhere), so
 *    "ดูทั้งหมด" lands on exactly these jobs; it reads only open jobs through ix_job_status
 *    (~6 ms per query), so the cost does not grow with the job history
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
  scope: 'mine' | 'all';
  /** the engineer the list is limited to (scope "mine") — for the "ดูทั้งหมด" link */
  engineerId: number | null;
  total: number;
  unassigned: number;
  owners: OverdueOwner[];
  items: OverdueItem[];
};

const ITEM_LIMIT = 30;
const OWNER_LIMIT = 8;
const eng = alias(appUser, 'eng');
const opener = alias(appUser, 'opener');
const nameOf = (u: { firstName: AnyPgColumn; lastName: AnyPgColumn }) =>
  sql<string>`trim(coalesce(${u.firstName}, '') || ' ' || coalesce(${u.lastName}, ''))`;
const assigned = sql`coalesce(${job.engineerId}, 0) > 0`;

export async function overdueAlerts(u: CurrentUser): Promise<OverdueAlerts> {
  const mine = (await hasRight(u, 'Job Take')) && !(await hasRight(u, 'Overdue All'));
  // one minute is fresh enough for a bell; keyed by scope so engineers never share a list
  return cached(`alerts:overdue:${mine ? u.userId : 'all'}`, 60_000, () => load(mine ? u.userId : null));
}

async function load(engineerId: number | null): Promise<OverdueAlerts> {
  const where = and(
    ne(job.recordStatus, RS.DELETED),
    overdueWhere,
    engineerId === null ? undefined : eq(job.engineerId, engineerId),
  );

  const [[totals], owners, items] = await Promise.all([
    db
      .select({ total: count(), unassigned: sql<number>`count(*) filter (where not ${assigned})`.mapWith(Number) })
      .from(job)
      .where(where),
    engineerId !== null
      ? Promise.resolve([])
      : db
          .select({ engineerId: job.engineerId, name: nameOf(eng), count: count() })
          .from(job)
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
        dueDate: effectiveDueText, // the real due date (a user's, or opened + SLA)
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
      .orderBy(desc(effectiveDue), desc(job.jobNo))
      .limit(ITEM_LIMIT),
  ]);

  return {
    scope: engineerId === null ? 'all' : 'mine',
    engineerId,
    total: Number(totals?.total ?? 0),
    unassigned: Number(totals?.unassigned ?? 0),
    owners: owners.map((o) => ({
      engineerId: o.engineerId,
      name: o.name || `ผู้ใช้ #${o.engineerId}`,
      count: Number(o.count),
    })),
    items: items.map((r) => ({
      no: r.no,
      product: [r.brand, r.model].filter(Boolean).join(' ').trim(),
      // customer_detail = "C43600 ชื่อ เบอร์" when the customer row is missing
      customer: (r.customer ?? r.customerDetail ?? '').replace(/^[A-Z]\d+\s+/i, '').trim(),
      status: (r.status ?? '').trim(),
      dueDate: fmtDate(r.dueDate),
      daysOver: r.daysOver,
      engineer: (r.engineerId ?? 0) > 0 ? r.engineer || `ผู้ใช้ #${r.engineerId}` : null,
      openedBy: r.openedBy,
    })),
  };
}

/**
 * Bell, approvers' section: sale orders waiting for approval (approve_status 2), newest first like the
 * sale order list. Leaves out the viewer's own orders (creator / salesperson) — approveSaleOrder refuses
 * those (System Admin may decide any). Reads through ix_sale_out_hd_approve: a handful of rows, no cache.
 * ponytail: "waiting since" = document_create_date (no submit timestamp column); add one if a re-submitted
 * old order should count from its submit.
 */
export type PendingSaleOrder = {
  no: string;
  customer: string;
  amount: number;
  createdBy: string;
  date: string;
  days: number;
};
export type PendingSaleOrders = { total: number; items: PendingSaleOrder[] };

const PENDING_LIMIT = 20;
const soCreator = alias(appUser, 'so_creator');

export async function pendingSaleOrders(u: Pick<CurrentUser, 'userId' | 'isAdmin'>): Promise<PendingSaleOrders> {
  const where = and(
    eq(saleOutHd.approveStatusId, AS.WAIT),
    ne(saleOutHd.recordStatus, RS.DELETED),
    u.isAdmin
      ? undefined
      : sql`coalesce(${saleOutHd.documentCreateBy}, 0) <> ${u.userId} and coalesce(${saleOutHd.saleOutBy}, 0) <> ${u.userId}`,
  );
  const [[totals], rows] = await Promise.all([
    db.select({ total: count() }).from(saleOutHd).where(where),
    db
      .select({
        no: saleOutHd.saleOutHdNo,
        customer: saleOutHd.customerName,
        amount: saleOutHd.netAmount,
        first: soCreator.firstName,
        last: soCreator.lastName,
        date: saleOutHd.documentCreateDate,
        days: sql<number>`((now() AT TIME ZONE 'Asia/Bangkok')::date - ${saleOutHd.documentCreateDate}::date)`.mapWith(
          Number,
        ),
      })
      .from(saleOutHd)
      .leftJoin(soCreator, eq(soCreator.userId, saleOutHd.documentCreateBy))
      .where(where)
      .orderBy(desc(saleOutHd.documentCreateDate), desc(saleOutHd.saleOutHdId))
      .limit(PENDING_LIMIT),
  ]);
  return {
    total: Number(totals?.total ?? 0),
    items: rows.map((r) => ({
      no: r.no ?? '',
      customer: (r.customer ?? '').trim(),
      amount: num(r.amount),
      createdBy: fullName(r.first, r.last),
      date: fmtDateTime(r.date),
      days: Math.max(0, r.days ?? 0),
    })),
  };
}
