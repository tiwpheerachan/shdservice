import 'server-only';
import { and, count, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '@/db/client';
import { appUser, brand, customer, job, jobStatus, model, saleOrder } from '@/db/schema';
import { cached } from '@/server/cache';
import { RS } from '@/server/record-status';
import { fmtDate, fmtDateTime, num } from '@/server/mappers/format';
import { fullName, hasRight, type CurrentUser } from '@/server/auth';
import { daysOverdue, effectiveDue, effectiveDueText, jobModelName, overdueWhere } from './jobs';
import { AS } from './sale-orders';

/**
 * Notification bell: open jobs past their customer due date, with who is responsible. Who takes jobs (Job Take) sees
 * only their own unless also Overdue All. Same condition as the job list's `overdue=1` (jobs.ts overdueWhere), so
 * "ดูทั้งหมด" lands on exactly these jobs.
 */
export type OverdueItem = {
  /** job.id — the link; `no` is what is shown */
  id: string;
  no: string;
  product: string;
  customer: string;
  status: string;
  dueDate: string;
  daysOver: number;
  engineer: string | null;
  openedBy: string;
};
/** engineerId = app_user.id (null = the user row is gone) */
export type OverdueOwner = { engineerId: string | null; name: string; count: number };
export type OverdueAlerts = {
  scope: 'mine' | 'all';
  /** app_user.id of the engineer the list is limited to (scope "mine") — for the "ดูทั้งหมด" link */
  engineerId: string | null;
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
const assigned = isNotNull(job.engineerAppUserPk);

export async function overdueAlerts(u: CurrentUser): Promise<OverdueAlerts> {
  const mine = (await hasRight(u, 'Job Take')) && !(await hasRight(u, 'Overdue All'));
  // one minute is fresh enough for a bell; keyed by scope so engineers never share a list
  return cached(`alerts:overdue:${mine ? u.pk : 'all'}`, 60_000, () => load(mine ? u : null));
}

async function load(me: Pick<CurrentUser, 'pk' | 'id'> | null): Promise<OverdueAlerts> {
  const engineerId = me?.pk ?? null;
  const where = and(
    ne(job.recordStatus, RS.DELETED),
    overdueWhere,
    engineerId === null ? undefined : eq(job.engineerAppUserPk, engineerId),
  );

  const [[totals], owners, items] = await Promise.all([
    db
      .select({ total: count(), unassigned: sql<number>`count(*) filter (where not ${assigned})`.mapWith(Number) })
      .from(job)
      .where(where),
    engineerId !== null
      ? Promise.resolve([])
      : db
          .select({ engineerId: eng.id, name: nameOf(eng), count: count() })
          .from(job)
          .leftJoin(eng, eq(eng.pk, job.engineerAppUserPk))
          .where(and(where, assigned))
          .groupBy(job.engineerAppUserPk, eng.id, eng.firstName, eng.lastName)
          .orderBy(desc(count()))
          .limit(OWNER_LIMIT),
    // most recently overdue first: the ones someone can still act on today
    db
      .select({
        id: job.id,
        no: job.jobNo,
        brand: brand.brandName,
        model: jobModelName, // the model's name (product_model_name: a legacy job's snapshot)
        customer: customer.customerName,
        customerDetail: job.customerDetail,
        status: jobStatus.jobStatusName,
        dueDate: effectiveDueText, // the real due date (a user's, or opened + SLA)
        daysOver: daysOverdue,
        engineerId: job.engineerAppUserPk,
        engineer: nameOf(eng),
        openedBy: nameOf(opener),
      })
      .from(job)
      .innerJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
      // the brand is the model's (job has no brand column)
      .leftJoin(model, eq(model.pk, job.modelPk))
      .leftJoin(brand, eq(brand.pk, model.brandPk))
      .leftJoin(customer, eq(customer.pk, job.customerPk))
      .leftJoin(eng, eq(eng.pk, job.engineerAppUserPk))
      .leftJoin(opener, eq(opener.pk, job.createdByAppUserPk))
      .where(where)
      .orderBy(desc(effectiveDue), desc(job.jobNo))
      .limit(ITEM_LIMIT),
  ]);

  return {
    scope: engineerId === null ? 'all' : 'mine',
    engineerId: me?.id ?? null,
    total: Number(totals?.total ?? 0),
    unassigned: Number(totals?.unassigned ?? 0),
    owners: owners.map((o) => ({
      engineerId: o.engineerId,
      name: o.name || 'ไม่ทราบชื่อผู้ใช้',
      count: Number(o.count),
    })),
    items: items.map((r) => ({
      id: r.id,
      no: r.no,
      product: [r.brand, r.model].filter(Boolean).join(' ').trim(),
      // customer_detail = "C43600 ชื่อ เบอร์" when the customer row is missing
      customer: (r.customer ?? r.customerDetail ?? '').replace(/^[A-Z]\d+\s+/i, '').trim(),
      status: (r.status ?? '').trim(),
      dueDate: fmtDate(r.dueDate),
      daysOver: r.daysOver,
      engineer: r.engineerId != null ? r.engineer || 'ไม่ทราบชื่อผู้ใช้' : null,
      openedBy: r.openedBy,
    })),
  };
}

/**
 * Bell, approvers' section: sale orders waiting for approval (approve_status 2), newest first like the
 * sale order list. Leaves out the viewer's own orders (creator / salesperson) — approveSaleOrder refuses
 * those (System Admin may decide any). Reads through ix_sale_order_approve: a handful of rows, no cache.
 * ponytail: "waiting since" = document_create_date (no submit timestamp column); add one if a re-submitted
 * old order should count from its submit.
 */
export type PendingSaleOrder = {
  /** sale_order.id — the link; `no` is what is shown */
  id: string;
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

export async function pendingSaleOrders(u: Pick<CurrentUser, 'pk' | 'isAdmin'>): Promise<PendingSaleOrders> {
  const where = and(
    eq(saleOrder.approveStatusId, AS.WAIT),
    ne(saleOrder.recordStatus, RS.DELETED),
    u.isAdmin
      ? undefined
      : sql`${saleOrder.createdByAppUserPk} is distinct from ${u.pk} and ${saleOrder.saleOutByAppUserPk} is distinct from ${u.pk}`,
  );
  const [[totals], rows] = await Promise.all([
    db.select({ total: count() }).from(saleOrder).where(where),
    db
      .select({
        id: saleOrder.id,
        no: saleOrder.saleOrderNo,
        customer: saleOrder.customerName,
        amount: saleOrder.netAmount,
        first: soCreator.firstName,
        last: soCreator.lastName,
        date: saleOrder.documentCreateDate,
        days: sql<number>`((now() AT TIME ZONE 'Asia/Bangkok')::date - ${saleOrder.documentCreateDate}::date)`.mapWith(
          Number,
        ),
      })
      .from(saleOrder)
      .leftJoin(soCreator, eq(soCreator.pk, saleOrder.createdByAppUserPk))
      .where(where)
      .orderBy(desc(saleOrder.documentCreateDate), desc(saleOrder.pk))
      .limit(PENDING_LIMIT),
  ]);
  return {
    total: Number(totals?.total ?? 0),
    items: rows.map((r) => ({
      id: r.id,
      no: r.no ?? '',
      customer: (r.customer ?? '').trim(),
      amount: num(r.amount),
      createdBy: fullName(r.first, r.last),
      date: fmtDateTime(r.date),
      days: Math.max(0, r.days ?? 0),
    })),
  };
}
