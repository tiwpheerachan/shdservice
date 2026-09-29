import "server-only";
import { count, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { appUser, approveStatus, customer, job, jobStatus, jobType, quotationHd, quotationStatus, saleOutHd, symptom } from "@/db/schema";
import { num } from "@/server/mappers/format";
import { jobWhere, type JobFilters } from "./jobs";
import { quotationWhere, type QuotationFilters } from "./quotations";
import { saleOrderWhere, type SaleOrderFilters } from "./sale-orders";

/**
 * KPI tiles for the report screens — computed in one query over the SAME
 * filters the paged table uses, so the numbers cover the whole range even
 * though the table only shows a page.
 */
const eng = alias(appUser, "eng");

async function jobBase(f: JobFilters, q = "") {
  return db
    .select({
      total: count(),
      fresh: sql<string>`count(*) filter (where ${job.jobStatusId} = 1)`,
      done: sql<string>`count(*) filter (where ${jobStatus.jobStatusGroup} in ('Repaired','Finished'))`,
      amount: sql<string>`coalesce(sum(${job.jobTotalCost}),0)`,
      paid: sql<string>`coalesce(sum(${job.jobPaymentAmount}) filter (where ${job.jobPaymentAmount} > 0),0)`,
      tatSum: sql<string>`coalesce(sum(greatest(0, (${job.jobClosedDate}::date - ${job.jobCreateDate}::date))) filter (where ${job.jobClosedDate} > '1901-01-01'),0)`,
      tatN: sql<string>`count(*) filter (where ${job.jobClosedDate} > '1901-01-01')`,
      over30: sql<string>`count(*) filter (where ${job.jobClosedDate} > '1901-01-01' and (${job.jobClosedDate}::date - ${job.jobCreateDate}::date) > 30)`,
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

export async function jobReportSummary(f: JobFilters, q = "") {
  const [r] = await jobBase(f, q);
  const [top] = await db
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
    topChannel: top?.channel?.trim() || "—",
  };
}

export async function quotationReportSummary(f: QuotationFilters, q = "") {
  const [r] = await db
    .select({
      total: count(),
      agreed: sql<string>`count(*) filter (where ${quotationHd.quotationStatusId} in (3,6,9))`,
      amount: sql<string>`coalesce(sum(${quotationHd.netAmount}),0)`,
      agreedAmount: sql<string>`coalesce(sum(${quotationHd.netAmount}) filter (where ${quotationHd.quotationStatusId} in (3,6,9)),0)`,
    })
    .from(quotationHd)
    .leftJoin(customer, eq(customer.customerCode, quotationHd.customerCode))
    .leftJoin(job, eq(job.jobNo, quotationHd.referenceJobNo))
    .leftJoin(quotationStatus, eq(quotationStatus.quotationStatusId, quotationHd.quotationStatusId))
    .where(quotationWhere(q, f));
  return { total: Number(r.total), agreed: num(r.agreed), amount: num(r.amount), agreedAmount: num(r.agreedAmount) };
}

export async function saleOrderReportSummary(f: SaleOrderFilters, q = "") {
  const creator = alias(appUser, "creator");
  const [r] = await db
    .select({
      total: count(),
      approved: sql<string>`count(*) filter (where ${saleOutHd.approveStatusId} = 4)`,
      amount: sql<string>`coalesce(sum(${saleOutHd.netAmount}),0)`,
    })
    .from(saleOutHd)
    .leftJoin(creator, eq(creator.userId, saleOutHd.documentCreateBy))
    .leftJoin(approveStatus, eq(approveStatus.approveStatusId, saleOutHd.approveStatusId))
    .where(saleOrderWhere(q, f));
  const total = Number(r.total);
  const amount = num(r.amount);
  return { total, approved: num(r.approved), amount, avg: total ? amount / total : 0 };
}
