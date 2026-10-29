import 'server-only';
import { count, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { withStatementTimeout, type Tx } from '@/db/client';
import { appUser, job, jobStatus, jobType, quotationHd, saleOutHd, symptom } from '@/db/schema';
import { AS, JS, QS } from '@/lib/status-ids';
import { num } from '@/server/mappers/format';
import { jobWhere, kpiGroup, type JobFilters } from './jobs';
import { quotationWhere, withQuotationJoins, type QuotationFilters } from './quotations';
import { saleOrderWhere, withSaleOrderJoins, type SaleOrderFilters } from './sale-orders';

/**
 * KPI tiles for the report screens — computed in one query over the SAME
 * filters the paged table uses, so the numbers cover the whole range even
 * though the table only shows a page.
 */
const eng = alias(appUser, 'eng');
/** a closed job's TAT as the dashboard / Excel / the report's TAT column count it (jobs.ts tatDays): opening → the
 *  return, else the close — calendar days */
const tatDays = sql`((case when ${job.jobReturnDate} > '1901-01-01' then ${job.jobReturnDate} else ${job.jobClosedDate} end)::date - ${job.jobCreateDate}::date)`;

async function jobBase(tx: Tx, f: JobFilters, q = '') {
  return tx
    .select({
      total: count(),
      fresh: sql<string>`count(*) filter (where ${job.jobStatusId} = ${JS.NEW})`,
      // ลูกค้าไม่ซ่อม (JS.REPAIR_CANCELLED) is not a successful repair — kpiGroup counts it as Cancel
      done: sql<string>`count(*) filter (where ${kpiGroup} in ('Repaired','Finished'))`,
      amount: sql<string>`coalesce(sum(${job.jobTotalCost}),0)`,
      // net, as the table's ยอดรับชำระ column adds up: a refund (คืนมัดจำ, a negative payment) counts too
      paid: sql<string>`coalesce(sum(${job.jobPaymentAmount}),0)`,
      tatSum: sql<string>`coalesce(sum(greatest(0, ${tatDays})) filter (where ${job.jobClosedDate} > '1901-01-01'),0)`,
      tatN: sql<string>`count(*) filter (where ${job.jobClosedDate} > '1901-01-01')`,
      over30: sql<string>`count(*) filter (where ${job.jobClosedDate} > '1901-01-01' and ${tatDays} > 30)`,
      minDate: sql<string>`min(${job.jobCreateDate})`,
      maxDate: sql<string>`max(${job.jobCreateDate})`,
    })
    .from(job)
    .leftJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
    .leftJoin(jobType, eq(jobType.jobTypeId, job.jobTypeId))
    .leftJoin(eng, eq(eng.userId, job.engineerId))
    .leftJoin(symptom, eq(symptom.symptomId, job.productSymptomId))
    .where(jobWhere(q, f));
}

export async function jobReportSummary(f: JobFilters, q = '') {
  const { r, top } = await withStatementTimeout(async (tx) => {
    const [r] = await jobBase(tx, f, q);
    const [top] = await tx
      .select({ channel: job.productSaleOutChannel, n: count() })
      .from(job)
      .leftJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
      .leftJoin(jobType, eq(jobType.jobTypeId, job.jobTypeId))
      .leftJoin(eng, eq(eng.userId, job.engineerId))
      .leftJoin(symptom, eq(symptom.symptomId, job.productSymptomId))
      .where(jobWhere(q, f))
      .groupBy(job.productSaleOutChannel)
      .orderBy(sql`count(*) desc`)
      .limit(1);
    return { r, top };
  });
  if (!r) throw new Error('aggregate returned no row'); // no GROUP BY → always exactly one row
  const total = Number(r.total);
  const tatN = num(r.tatN);
  return {
    total,
    fresh: num(r.fresh),
    done: num(r.done),
    amount: num(r.amount),
    paid: num(r.paid),
    avgTat: tatN ? Math.round((num(r.tatSum) / tatN) * 10) / 10 : 0,
    over30: num(r.over30),
    topChannel: top?.channel?.trim() || '—',
  };
}

export async function quotationReportSummary(f: QuotationFilters, q = '') {
  const agreed = inArray(quotationHd.quotationStatusId, [QS.AGREED, QS.AGREED_WAIT_PAY, QS.AGREED_WAIT_PARTS]);
  const [r] = await withStatementTimeout((tx) =>
    withQuotationJoins(
      tx
        .select({
          total: count(),
          agreed: sql<string>`count(*) filter (where ${agreed})`,
          // มูลค่ารวม leaves out cancelled quotations (QS.CANCELLED ยกเลิกใบเสนอราคา); the card shows that amount apart
          amount: sql<string>`coalesce(sum(${quotationHd.netAmount}) filter (where ${quotationHd.quotationStatusId} is distinct from ${QS.CANCELLED}),0)`,
          cancelledAmount: sql<string>`coalesce(sum(${quotationHd.netAmount}) filter (where ${quotationHd.quotationStatusId} = ${QS.CANCELLED}),0)`,
          agreedAmount: sql<string>`coalesce(sum(${quotationHd.netAmount}) filter (where ${agreed}),0)`,
        })
        .from(quotationHd)
        .$dynamic(),
    ).where(quotationWhere(q, f)),
  );
  if (!r) throw new Error('aggregate returned no row');
  return {
    total: Number(r.total),
    agreed: num(r.agreed),
    amount: num(r.amount),
    cancelledAmount: num(r.cancelledAmount),
    agreedAmount: num(r.agreedAmount),
  };
}

export async function saleOrderReportSummary(f: SaleOrderFilters, q = '') {
  const [r] = await withStatementTimeout((tx) =>
    withSaleOrderJoins(
      tx
        .select({
          total: count(),
          approved: sql<string>`count(*) filter (where ${saleOutHd.approveStatusId} = ${AS.APPROVED})`,
          // ยอดขายรวม = approved orders only (AS.APPROVED อนุมัติแล้ว); waiting / rejected / denied are shown apart
          amount: sql<string>`coalesce(sum(${saleOutHd.netAmount}) filter (where ${saleOutHd.approveStatusId} = ${AS.APPROVED}),0)`,
          notApprovedAmount: sql<string>`coalesce(sum(${saleOutHd.netAmount}) filter (where ${saleOutHd.approveStatusId} is distinct from ${AS.APPROVED}),0)`,
        })
        .from(saleOutHd)
        .$dynamic(),
    ).where(saleOrderWhere(q, f)),
  );
  if (!r) throw new Error('aggregate returned no row');
  const approved = num(r.approved);
  const amount = num(r.amount);
  return {
    total: Number(r.total),
    approved,
    amount,
    notApprovedAmount: num(r.notApprovedAmount),
    avg: approved ? amount / approved : 0, // per approved order, like ยอดขายรวม
  };
}
