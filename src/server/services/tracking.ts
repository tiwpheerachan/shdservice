import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { customer, job, jobLog, jobStatus, manufacturer, quotationHd } from "@/db/schema";
import { RS } from "@/server/record-status";
import { fmtDate, isSentinelDate, nowThai } from "@/server/mappers/format";
import { JS } from "./jobs";
import { getShippingProfile, trackUrlFor } from "./shipping-profiles";
import { TRACK_STEPS, type PublicJob, type TrackStepKey } from "@/lib/track-public";

/**
 * Public customer tracking — the ONLY code path that serves job data without a
 * login, so everything here is deliberately narrow. Flow (see app/api/track/*):
 *
 *   /track/<linkToken> or the /track form → Turnstile → /api/track/session
 *     → jobNoForLink / jobNoForNumber (this file) → one-time ticket
 *   /api/track/data { ticket } → atomic consume → publicJobByNo (this file)
 *
 * Nothing here is reachable before the captcha, and no function returns job
 * data for a client-chosen job number: the data path only takes the job number
 * the server bound to a consumed ticket.
 *
 *  - the token is 32 random bytes (base64url); job numbers are sequential and
 *    must never be a key on their own
 *  - every job is trackable from the moment it is opened (decided 2026-09-23);
 *    flip QUOTATION_REQUIRED to gate it behind a quotation again
 *  - a link dies 90 days after the job is closed, and staff can rotate it
 *  - the fallback form needs TWO facts (job/quotation number + last 4 digits of
 *    the customer's phone) and every failure returns the same message, so the
 *    endpoint cannot be used to tell which numbers exist
 *  - only the fields in `PublicJob` ever leave this module: no price, no phone,
 *    no address, no full IMEI/serial, no technician, no internal remarks
 */

/** true = only jobs that already have a quotation can be tracked (currently: every job) */
const QUOTATION_REQUIRED = false;
/** a link stops working this long after the job was closed */
const EXPIRE_DAYS_AFTER_CLOSE = 90;
/** a link nobody has opened yet lives this long from issue (drizzle/0016) */
export const LINK_UNOPENED_HOURS = 24;
/** after the first customer open, the link lives this much longer */
export const LINK_OPEN_MINUTES = 15;

/*
 * Link lifetime, evaluated in Postgres so the clocks never disagree:
 * job.track_token_at is Thai wall-clock (`timestamp`), track_opened_at a real instant.
 */
const linkIssuedAt = sql`(${job.trackTokenAt} AT TIME ZONE 'Asia/Bangkok')`;
const linkExpiresAt = sql<string>`CASE WHEN ${job.trackOpenedAt} IS NOT NULL
    THEN ${job.trackOpenedAt} + make_interval(mins => ${LINK_OPEN_MINUTES})
    ELSE ${linkIssuedAt} + make_interval(hours => ${LINK_UNOPENED_HOURS}) END`;
const linkLive = sql<boolean>`(${job.trackTokenAt} IS NOT NULL AND ${linkExpiresAt} > now())`;

export type { PublicJob, TrackStepKey } from "@/lib/track-public";
export { TRACK_STEPS } from "@/lib/track-public";

/** 25 internal statuses → 5 customer-facing steps (group first, then the few ids that read better elsewhere) */
function stepOf(statusId: number, group: string): TrackStepKey | null {
  if (statusId === JS.CANCELLED || statusId === JS.REPAIR_CANCELLED || group === "Cancel") return null;
  if (statusId === JS.NEW) return "received";
  if (statusId === JS.WAIT_PARTS || statusId === JS.WAIT_QUOTE || statusId === JS.QUOTED || statusId === JS.QUOTE_EXPIRED) return "waiting";
  if (group === "Repaired") return "repaired";
  if (group === "Finished") return "returned";
  return "diagnosing";
}

const maskName = (full: string) => {
  const name = full.trim().replace(/^[A-Z]\d+\s+/i, ""); // customer_detail = "C43600 ชื่อ เบอร์"
  const first = name.split(/\s+/)[0] ?? "";
  return first ? `คุณ ${first.slice(0, 3)}…` : "ลูกค้า";
};
const maskRef = (v: string) => {
  const s = (v ?? "").trim();
  return s.length > 4 ? `••••${s.slice(-4)}` : s ? "••••" : "";
};
const digits = (v: string) => (v ?? "").replace(/\D/g, "");

export function newToken() {
  return randomBytes(32).toString("base64url");
}

/* ------------------------------------------------------------------ *
 * Lookup
 * ------------------------------------------------------------------ */

function base(where: SQL | undefined) {
  return db
    .select({
      no: job.jobNo,
      token: job.trackToken,
      statusId: job.jobStatusId,
      group: jobStatus.jobStatusGroup,
      customerDetail: job.customerDetail,
      customerName: customer.customerName,
      phone: customer.phoneNumber,
      brand: manufacturer.manufacturerName,
      model: job.productModelName,
      serial: job.productSerial,
      imei: job.productImeiNo,
      receivedDate: job.jobReceptionDate,
      createDate: job.jobCreateDate,
      dueDate: job.customerDueDate,
      closedDate: job.jobClosedDate,
      shipper: job.returnCustomerType,
      trackingNo: job.returnCustomerTrackingNo,
      shipperId: job.returnShipperId,
      recordStatus: job.recordStatus,
    })
    .from(job)
    .leftJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
    .leftJoin(customer, eq(customer.customerId, job.customerId))
    .leftJoin(manufacturer, eq(manufacturer.manufacturerId, job.productBrandId))
    .where(where)
    .limit(1);
}

type Row = Awaited<ReturnType<typeof base>>[number];


/** does this job have a quotation the customer could be holding? */
async function hasQuotation(jobNo: string) {
  const [row] = await db
    .select({ n: sql<number>`1` })
    .from(quotationHd)
    .where(and(eq(quotationHd.referenceJobNo, jobNo), ne(quotationHd.recordStatus, RS.DELETED)))
    .limit(1);
  return !!row;
}

function expired(row: Row) {
  // the legacy DB writes 1900-01-01 (not NULL) for "not closed yet" — isSentinelDate
  // catches that, otherwise every open job would look closed long ago and expire
  if (isSentinelDate(row.closedDate)) return false;
  const closed = Date.parse(String(row.closedDate).replace(" ", "T"));
  if (!Number.isFinite(closed)) return false;
  return Date.now() - closed > EXPIRE_DAYS_AFTER_CLOSE * 86_400_000;
}

/** every rejection looks the same to the caller — never say which part failed */
async function visible(row: Row | undefined): Promise<Row | null> {
  if (!row) return null;
  if (row.recordStatus === RS.DELETED) return null;
  if (expired(row)) return null;
  if (QUOTATION_REQUIRED && !(await hasQuotation(row.no))) return null;
  return row;
}

async function toPublic(row: Row): Promise<PublicJob> {
  const logs = await db
    .select({ statusId: jobLog.jobStatusId, at: jobLog.jobLogDate, group: jobStatus.jobStatusGroup })
    .from(jobLog)
    .leftJoin(jobStatus, eq(jobStatus.jobStatusId, jobLog.jobStatusId))
    .where(eq(jobLog.jobNo, row.no))
    .orderBy(asc(jobLog.jobLogDate), asc(jobLog.jobLogId));

  // first time each step was reached
  const seen = new Map<TrackStepKey, string>();
  for (const l of logs) {
    const k = stepOf(l.statusId ?? -1, l.group?.trim() ?? "");
    if (k && !seen.has(k)) seen.set(k, fmtDate(l.at));
  }
  const step = stepOf(row.statusId ?? -1, row.group?.trim() ?? "");
  if (step && !seen.has(step)) seen.set(step, "");

  // courier of the return leg (jobs closed before drizzle/0013 have none → plain tracking number)
  const trackingNo = (row.trackingNo ?? "").trim();
  const profile = row.shipperId ? await getShippingProfile(row.shipperId) : null;
  const courier =
    profile && !profile.isDeleted
      ? { name: profile.nameTh, logoUrl: profile.logoUrl, trackUrl: trackUrlFor(profile, trackingNo) }
      : null;

  const order = TRACK_STEPS.map((s) => s.key);
  const history = [...seen.entries()]
    .map(([key, at]) => ({ key, at }))
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

  return {
    no: row.no,
    customerMasked: maskName(row.customerName ?? row.customerDetail ?? ""),
    brandModel: [row.brand, row.model].filter(Boolean).join(" ").trim(),
    deviceRef: maskRef(row.serial || row.imei || ""),
    receivedDate: fmtDate(row.receivedDate ?? row.createDate),
    dueDate: fmtDate(row.dueDate),
    step,
    stepLabel: step ? TRACK_STEPS.find((s) => s.key === step)!.label : "ยกเลิกรายการ",
    cancelled: step === null,
    history,
    shipper: (row.shipper ?? "").trim(),
    trackingNo: (row.trackingNo ?? "").trim(),
    closedDate: fmtDate(row.closedDate),
    courier,
  };
}

/**
 * Anything unexpected on a PUBLIC path (DB down, column missing before the
 * migration ran, bad data) must look exactly like "not found" — an anonymous
 * visitor never sees an error, and an attacker learns nothing from one.
 */
async function quiet<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[track]", e instanceof Error ? e.message : e);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Resolve → job number (called only AFTER Turnstile passed)
 * ------------------------------------------------------------------ */

/** /track/<linkToken> → job number, or null (bad shape / unknown / deleted / expired — never say which) */
export async function jobNoForLink(token: string): Promise<string | null> {
  return quiet(async () => {
    const t = (token ?? "").trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(t)) return null; // wrong shape → no query at all
    const [row] = await db
      .select({ no: job.jobNo, token: job.trackToken, recordStatus: job.recordStatus, live: linkLive })
      .from(job)
      .where(eq(job.trackToken, t))
      .limit(1);
    // the link's own lifetime replaces the 90-days-after-close rule: 1 day unopened, 15 min after opening
    if (!row || !row.token || row.recordStatus === RS.DELETED || !row.live) return null;
    if (QUOTATION_REQUIRED && !(await hasQuotation(row.no))) return null;
    // constant-time compare so a near-miss token cannot be distinguished by timing
    const a = Buffer.from(row.token);
    const b = Buffer.from(t);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return row.no;
  });
}

/** first customer open of the current link starts its 15-minute window (later opens change nothing) */
export async function markLinkOpened(jobNo: string): Promise<void> {
  await db.execute(sql`UPDATE job SET track_opened_at = now() WHERE job_no = ${jobNo} AND track_opened_at IS NULL`);
}

export type LinkStatus = {
  state: "unopened" | "opened" | "expired";
  issuedAt: string | null; // ISO
  openedAt: string | null; // ISO
  expiresAt: string | null; // ISO
};

/** back-office view of the current link (the hint next to it) */
export async function linkStatus(jobNo: string): Promise<LinkStatus> {
  const [r] = await db
    .select({
      issuedAt: sql<string | null>`to_char(${linkIssuedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      openedAt: sql<string | null>`to_char(${job.trackOpenedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      expiresAt: sql<string | null>`to_char((${linkExpiresAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
      live: linkLive,
    })
    .from(job)
    .where(eq(job.jobNo, jobNo))
    .limit(1);
  if (!r) return { state: "expired", issuedAt: null, openedAt: null, expiresAt: null };
  return {
    state: !r.live ? "expired" : r.openedAt ? "opened" : "unopened",
    issuedAt: r.issuedAt,
    openedAt: r.openedAt,
    expiresAt: r.expiresAt,
  };
}

/** /track form: job number OR quotation number + last 4 digits of the customer's phone → job number, or null */
export async function jobNoForNumber(input: string, phone4: string): Promise<string | null> {
  return quiet(async () => {
    const raw = (input ?? "").trim().toUpperCase();
    const last4 = digits(phone4);
    if (!raw || last4.length !== 4) return null;
    if (!/^[A-Z]{1,6}\d{5,}$/.test(raw)) return null;

    let jobNo = raw;
    // a quotation number resolves to its job
    const [q] = await db
      .select({ jobNo: quotationHd.referenceJobNo })
      .from(quotationHd)
      .where(and(eq(quotationHd.quotationNo, raw), ne(quotationHd.recordStatus, RS.DELETED)))
      .limit(1);
    if (q?.jobNo) jobNo = q.jobNo.trim().toUpperCase();

    const [row] = await base(eq(job.jobNo, jobNo));
    const ok = await visible(row);
    if (!ok) return null;

    // phone comes from the customer record; fall back to the digits inside customer_detail
    const phone = digits(ok.phone ?? "") || digits(ok.customerDetail ?? "");
    if (phone.length < 4 || phone.slice(-4) !== last4) return null;
    return ok.no;
  });
}

/* ------------------------------------------------------------------ *
 * Serialize (called only with the job number bound to a consumed ticket)
 * ------------------------------------------------------------------ */

/** the job may have been deleted / expired since the ticket was issued — checked again here */
export async function publicJobByNo(jobNo: string): Promise<PublicJob | null> {
  return quiet(async () => {
    const [row] = await base(eq(job.jobNo, jobNo));
    // the ticket was issued under the rules of its path (link lifetime / 90-day form rule);
    // here only a job deleted in the meantime is refused
    if (!row || row.recordStatus === RS.DELETED) return null;
    return toPublic(row);
  });
}

/** link shown in the back office (staff copy it into LINE) */
export async function trackLinkFor(jobNo: string, baseUrl: string): Promise<string> {
  const [row] = await db.select({ token: job.trackToken }).from(job).where(eq(job.jobNo, jobNo)).limit(1);
  if (!row?.token) return "";
  return `${baseUrl.replace(/\/+$/, "")}/track/${row.token}`;
}

/** issue a token for a job that has none (older rows, or a job created before 0012 ran) */
export async function ensureToken(jobNo: string): Promise<string> {
  const [row] = await db.select({ token: job.trackToken }).from(job).where(eq(job.jobNo, jobNo)).limit(1);
  if (row?.token) return row.token;
  const token = newToken();
  // a new link: fresh 1-day window, not opened yet
  await db.update(job).set({ trackToken: token, trackTokenAt: nowThai(), trackOpenedAt: null }).where(eq(job.jobNo, jobNo));
  return token;
}

/** staff action: old link stops working immediately; the new one gets a fresh 1-day window */
export async function rotateToken(jobNo: string): Promise<string> {
  const token = newToken();
  // a new link: fresh 1-day window, not opened yet
  await db.update(job).set({ trackToken: token, trackTokenAt: nowThai(), trackOpenedAt: null }).where(eq(job.jobNo, jobNo));
  return token;
}

/** is tracking available for this job yet? (drives the back-office UI) */
export async function trackingReady(jobNo: string): Promise<boolean> {
  if (!QUOTATION_REQUIRED) return true;
  return hasQuotation(jobNo);
}

export { EXPIRE_DAYS_AFTER_CLOSE };
