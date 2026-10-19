import 'server-only';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, ne, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { customer, job, jobLog, jobStatus, manufacturer, quotationHd, trackDocTicket, trackSession } from '@/db/schema';
import { RS } from '@/server/record-status';
import { fmtDate, isSentinelDate, nowThai } from '@/server/mappers/format';
import { today } from '@/lib/dates';
import { quoteExpired } from '@/lib/quote-expiry';
import type { Customer } from '@/data/types';
import { JOB_GROUP, QS } from '@/lib/status-ids';
import { JS, effectiveDueText, type JobDetail } from './jobs';
import type { QuotationDetail } from './quotations';
import { getShippingProfile, trackUrlFor } from './shipping-profiles';
import {
  TRACK_STEPS,
  type PublicDoc,
  type PublicJob,
  type PublicJobSummary,
  type TrackDocKind,
  type TrackStepKey,
} from '@/lib/track-public';
import { logError } from '@/lib/log';
import { newToken, sha256, TOKEN_SHAPE } from '@/server/track-guard';

/**
 * Public customer tracking — the ONLY code path that serves job data without a
 * login, so everything here is deliberately narrow. Two ways in (see app/api/track/*):
 *
 *   /track/<linkToken> (staff-sent link) → Turnstile → /api/track/session
 *     → jobNoForLink (this file) → one-time ticket → /api/track/data → publicJobByNo
 *   /track (the customer's own lookup) → Turnstile → mobile number → SMS OTP
 *     (server/track-otp.ts) → customer session → listJobsForCustomers / publicJobForCustomers
 *
 * Nothing here is reachable before the captcha, and no function returns job data for a
 * client-chosen job number without an authorisation the server issued: a consumed ticket
 * (bound to one job) or a customer session (bound to that customer's ids).
 *
 *  - link tokens are 32 random bytes (base64url); job numbers are sequential and never a key
 *  - only sha256(token) is stored (drizzle/0025): a DB leak yields no working link, and a
 *    link can be shown only once — to the staff member who just generated it
 *  - a link lives 1 day unopened, 15 minutes after the first customer open (drizzle/0016)
 *  - only the fields in `PublicJob` ever leave this module: no price, no phone, no
 *    address, no full IMEI/serial, no technician, no internal remarks
 */

/** a link nobody has opened yet lives this long from issue (drizzle/0016) */
const LINK_UNOPENED_HOURS = 24;
/** after the first customer open, the link lives this much longer */
const LINK_OPEN_MINUTES = 15;
/** while the customer is using the page, the keepalive keeps at least this much on the clock … */
const LINK_EXTEND_MINUTES = 5;
/** … but never past this long from the first open (same rule as the phone + OTP session) */
const LINK_MAX_MINUTES = 60;

/*
 * Link lifetime, evaluated in Postgres so the clocks never disagree:
 * job.track_token_at is Thai wall-clock (`timestamp`), track_opened_at a real instant.
 */
const linkIssuedAt = sql`(${job.trackTokenAt} AT TIME ZONE 'Asia/Bangkok')`;
const linkExpiresAt = sql<string>`CASE WHEN ${job.trackOpenedAt} IS NOT NULL
    THEN coalesce(${job.trackLinkExpiresAt}, ${job.trackOpenedAt} + make_interval(mins => ${LINK_OPEN_MINUTES}))
    ELSE ${linkIssuedAt} + make_interval(hours => ${LINK_UNOPENED_HOURS}) END`;
const linkLive = sql<boolean>`(${job.trackTokenAt} IS NOT NULL AND ${linkExpiresAt} > now())`;

/**
 * 25 internal statuses → 5 customer-facing steps (group first, then the few ids that read better elsewhere).
 * ลูกค้าไม่ตกลงซ่อม (6) is not a cancelled job: the device still goes back (group Repaired → "ซ่อมเสร็จ" step, own label).
 */
export function stepOf(statusId: number, group: string): TrackStepKey | null {
  if (statusId === JS.CANCELLED || group === JOB_GROUP.CANCEL) return null;
  if (statusId === JS.NEW) return 'received';
  if (
    statusId === JS.WAIT_PARTS ||
    statusId === JS.WAIT_QUOTE ||
    statusId === JS.QUOTED ||
    statusId === JS.QUOTE_EXPIRED
  )
    return 'waiting';
  if (group === JOB_GROUP.REPAIRED) return 'repaired';
  if (group === JOB_GROUP.FINISHED) return 'returned';
  return 'diagnosing';
}

/**
 * The current status in words the customer can act on — the 5 steps merge some of them.
 * `lastQuote` = the job's latest sent quotation: past its validity, "รอคำตอบจากคุณ" would ask for an answer it can no longer take.
 */
export function statusLabel(statusId: number, step: TrackStepKey | null, lastQuote?: LastQuote): string {
  if (!step) return 'ยกเลิกรายการ';
  // the "ซ่อมเสร็จ" step also holds outcomes that are not a repair
  if (statusId === JS.REPAIR_CANCELLED) return 'ไม่ซ่อม — รอส่งคืน/รับคืนเครื่อง';
  if (statusId === JS.REPAIRED_NO_FAULT) return 'ตรวจแล้วไม่พบอาการเสีย — เตรียมส่งคืน';
  if (statusId === JS.SWAP_ISSUED) return 'เปลี่ยนเครื่องใหม่ — เตรียมส่งคืน';
  if (statusId === JS.REFUND_PAID) return 'คืนเงินแล้ว';
  if (statusId === JS.CLOSED_REFUND) return 'คืนเงินแล้ว — ปิดงาน';
  // รับคืนเข้าสต๊อกแล้ว: the device was taken in for a swap / refund (next: 18 or 19)
  if (statusId === JS.RETURNED_TO_STOCK) return 'รับเครื่องเข้าคลังแล้ว — รอเปลี่ยนเครื่องหรือคืนเงิน';
  if (statusId === JS.QUOTED && lastQuote && quoteExpired(lastQuote.st, lastQuote.at, statusId))
    return `ใบเสนอราคา${QUOTE_EXPIRED_TEXT}`;
  if (statusId === JS.QUOTED) return 'รอคำตอบจากคุณ (ใบเสนอราคา)';
  if (statusId === JS.WAIT_QUOTE) return 'ศูนย์กำลังจัดทำใบเสนอราคา';
  if (statusId === JS.QUOTE_EXPIRED) return `ใบเสนอราคา${QUOTE_EXPIRED_TEXT}`;
  if (statusId === JS.WAIT_PARTS) return 'รออะไหล่';
  if (statusId === JS.CLOSED_WAIT_PICKUP) return 'พร้อมให้มารับที่ศูนย์';
  if (statusId === JS.CLOSED_WAIT_TRACKING) return 'กำลังจัดส่งคืนทางพัสดุ';
  if (statusId === JS.CLOSED_TRACKED) return 'ส่งคืนแล้ว (พัสดุ)';
  if (step === 'returned') return 'ส่งคืนแล้ว';
  return TRACK_STEPS.find((s) => s.key === step)!.label;
}
const QUOTE_EXPIRED_TEXT = 'หมดอายุแล้ว — ติดต่อศูนย์เพื่อขอใบเสนอราคาใหม่';
const DUE_PASSED_TEXT = 'เลยกำหนดเดิม — ศูนย์จะแจ้งวันใหม่';

/**
 * What the quotation's "ตกลงซ่อมโดย" box shows (staff and customer copies): the sign-and-return request only
 * while the customer can still answer — sent (2; a draft 1 is what staff hand over) and not expired.
 */
export function quoteSignState(st: number | null | undefined, at: string | null, jobStatusId: number | null) {
  if (quoteExpired(st, at, jobStatusId)) return 'expired' as const;
  if (st === QS.AGREED || st === QS.AGREED_WAIT_PAY || st === QS.AGREED_WAIT_PARTS) return 'agreed' as const;
  if (st === QS.DECLINED) return 'declined' as const;
  if (st === QS.CANCELLED) return 'cancelled' as const;
  return 'sign' as const;
}

/** quotations the customer has been sent: sent / accepted / declined / lapsed — never a draft (1) or a cancelled one (5) */
const CUSTOMER_QUOTATION_STATUSES: number[] = [
  QS.SENT,
  QS.AGREED,
  QS.DECLINED,
  QS.AGREED_WAIT_PAY,
  QS.EXPIRED,
  QS.AGREED_WAIT_PARTS,
];

/** the job's latest quotation the customer was sent (CUSTOMER_QUOTATION_STATUSES) — status + date */
type LastQuote = { st: number; at: string } | null;
const lastQuote = sql<LastQuote>`(SELECT json_build_object('st', q.quotation_status_id, 'at', to_char(q.create_date, 'YYYY-MM-DD'))
    FROM quotation_hd q WHERE q.reference_job_no = ${job.jobNo} AND q.record_status <> ${RS.DELETED}
      AND q.quotation_status_id = ANY(${sql.param(CUSTOMER_QUOTATION_STATUSES)}) ORDER BY q.create_date DESC LIMIT 1)`;

/** วันที่รับเครื่อง — ONE source for the header, the timeline and the documents' date (a legacy 1900 → opened) */
const receivedOf = (r: { receivedDate: string | null; createDate: string | null }) =>
  fmtDate(isSentinelDate(r.receivedDate) ? r.createDate : r.receivedDate);
/** the same date for a job as the printed documents get it (ใบรับงานซ่อม / ใบส่งคืนสินค้า, staff and customer copies) */
export const receivedDateOf = (j: Pick<JobDetail, 'receptionDate' | 'createDate'>) =>
  receivedOf({ receivedDate: j.receptionDate, createDate: j.createDate });

/** customer list: a closed job the customer has not got back yet (to collect / parcel not sent) is still in progress */
export const inProgressForCustomer = (statusId: number | null, group: string | null) => {
  const g = group?.trim() ?? '';
  if (statusId === JS.CLOSED_WAIT_PICKUP || statusId === JS.CLOSED_WAIT_TRACKING) return true;
  return g !== JOB_GROUP.FINISHED && g !== JOB_GROUP.CANCEL;
};

/* masking — what /track and the documents opened from it show instead of the real value */
/** a company / shop, not a person: never "คุณ บริ…" */
const COMPANY =
  /บริษัท|บจก\.|หจก\.|ห้างหุ้นส่วน|มหาชน|^ร้าน|มูลนิธิ|สมาคม|สหกรณ์|\b(?:co|ltd|inc|corp|plc)\b\.?|\b(?:company|limited|corporation)\b/i;
const COMPANY_PREFIX = /^(?:บริษัท|บจก\.|หจก\.|ห้างหุ้นส่วน(?:จำกัด|สามัญ)?|ร้าน|มูลนิธิ|สมาคม|สหกรณ์)\s*/;
// "นาย.อัครพล" (a dot typed after the title) → the title and the dot go
const TITLE = /^(?:(?:คุณ|นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.)[.\s]*|(?:mrs|mr|ms|miss|dr)(?:\.\s*|\s+))/i;
/**
 * "C43600 คุณสมชาย ใจดี 081…" → "คุณ สมช…" (one title, never "คุณ คุณ…");
 * a company keeps its kind, no "คุณ": "บริษัท เอบีซี จำกัด" → "บริษัท เอบ…", "ABC Co., Ltd." → "ABC…"
 */
export const maskName = (full: string) => {
  let name = (full ?? '').trim().replace(/^[A-Z]\d+\s+/i, ''); // customer_detail = "C43600 ชื่อ เบอร์"
  if (COMPANY.test(name)) {
    const prefix = COMPANY_PREFIX.exec(name)?.[0] ?? '';
    const word = name.slice(prefix.length).split(/\s+/)[0] ?? '';
    return [prefix.trim(), word && `${word.slice(0, 3)}…`].filter(Boolean).join(' ') || 'ลูกค้า';
  }
  while (TITLE.test(name)) name = name.replace(TITLE, '');
  const first = name.split(/\s+/)[0] ?? '';
  return first ? `คุณ ${first.slice(0, 3)}…` : 'ลูกค้า';
};
/** serial / IMEI → "••••" + last 4; a note typed into the field ("SN เสียหาย", "รอ SN จากลูกค้า", "-") → "" */
export const maskRef = (v: string) => {
  const s = (v ?? '').replace(/[^A-Za-z0-9]/g, '');
  return s.length > 4 && /\d/.test(s) ? `••••${s.slice(-4)}` : '';
};
export const maskPhone = (v: string) => {
  const d = (v ?? '').replace(/\D/g, '');
  return d.length >= 4 ? `•••-•••-${d.slice(-4)}` : '';
};
/** a phone / id number: 6+ digits, maybe split by "-" or spaces */
const DIGIT_RUN = /\d(?:[\s-]?\d){5,}/g;
/** a 5-digit number on its own (not part of "99/12345" or a longer number) */
const POSTCODE = /(?<![\d/])\d{5}(?![\d/])/g;
/**
 * No house number / street: from the ตำบล (แขวง / อำเภอ / เขต / จังหวัด) up to the first postcode, else
 * the postcode alone. Whatever follows the postcode ("… จ.เชียงราย 57000 โทร 095-4104532 …") is cut,
 * and a digit run before it (a phone typed in the middle) is scrubbed.
 */
export const maskAddress = (v: string) => {
  const s = (v ?? '').trim();
  const i = s.search(/(?:^|\s)(?:ต\.|ตำบล|แขวง|อ\.|อำเภอ|เขต|จ\.|จังหวัด)/);
  if (i < 0) return [...s.matchAll(POSTCODE)].at(-1)?.[0] ?? '';
  const rest = s.slice(i);
  const zip = [...rest.matchAll(POSTCODE)][0];
  const head = (zip ? rest.slice(0, zip.index) : rest)
    .replace(DIGIT_RUN, ' ')
    .replace(/(?:โทร(?:ศัพท์)?|tel|มือถือ|เบอร์)\.?\s*:?\s*$/i, '');
  return `${head} ${zip?.[0] ?? ''}`.replace(/\s+/g, ' ').trim();
};
const maskCustomer = <C extends { name: string; address: string; phone: string }>(c: C) => ({
  name: maskName(c.name),
  address: maskAddress(c.address),
  phone: maskPhone(c.phone),
  code: '',
  taxId: '',
  email: '',
  line: '',
});

/**
 * A job as a document opened from /track (app/track/doc) shows it: no more than the tracking
 * page — masked name / phone / address / serial / IMEI, no staff names (technician / opener / closer), no contact details.
 * Prices stay (the customer decides on the quotation with them). Staff print views never call this.
 */
export function maskJobForCustomer(j: JobDetail): JobDetail {
  return {
    ...j,
    customer: j.customer && { ...maskCustomer(j.customer), id: 0 },
    customerDetail: maskName(j.customerDetail),
    imei: maskRef(j.imei),
    serial: maskRef(j.serial),
    so: maskRef(j.so), // marketplace order no. — like the serial
    // the words /track uses, not the internal status ("อยู่ระหว่างการซ่อม - ส่งซ่อม Out-Source แล้ว")
    status: statusLabel(j.statusId, stepOf(j.statusId, j.statusGroup?.trim() ?? '')),
    // free text typed by staff — internal notes / staff names ("คืนเงินนอกระบบ"); the return keeps its type + tracking no.
    remark: '',
    engineerRemark: '',
    return: { ...j.return, detail: '' },
    engineerId: 0,
    engineer: '',
    createBy: 0,
    createByName: '', // staff names stay on the staff copy (ผู้รับงาน / ผู้ส่งคืน)
    repairedBy: '',
    closedBy: '',
    sparePartReplace: '', // holds the new serial ("New S/N: …") — masked like `serial`
    outsource: [],
    logs: [],
    history: [],
    attachments: [],
  };
}

export function maskQuotationForCustomer(q: QuotationDetail): QuotationDetail {
  const c: Customer | null = q.customerDetail && { ...maskCustomer(q.customerDetail), status: q.customerDetail.status };
  return {
    ...q,
    customer: maskName(q.customer),
    customerCode: '',
    contactName: '',
    imei: maskRef(q.imei),
    customerDetail: c,
    job: q.job && maskJobForCustomer(q.job),
    createdBy: '', // เสนอราคาโดย — a staff name
    createdByPhone: '',
    createdByEmail: '',
  };
}

/** what the DB holds for a link (drizzle/0025) — same digest as the migration's backfill */
export const tokenHash = (token: string) => sha256(token).toString('hex');

/* ------------------------------------------------------------------ *
 * Lookup
 * ------------------------------------------------------------------ */

function base(where: SQL | undefined) {
  return db
    .select({
      no: job.jobNo,
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
      dueDate: effectiveDueText, // "วันที่คาดว่าจะเสร็จ": a user's date, or opened + SLA — never the legacy +1 day
      closedDate: job.jobClosedDate,
      shipper: job.returnCustomerType,
      trackingNo: job.returnCustomerTrackingNo,
      shipperId: job.returnShipperId,
      recordStatus: job.recordStatus,
      lastQuote,
    })
    .from(job)
    .leftJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
    .leftJoin(customer, eq(customer.customerId, job.customerId))
    .leftJoin(manufacturer, eq(manufacturer.manufacturerId, job.productBrandId))
    .where(where)
    .limit(1);
}

type Row = Awaited<ReturnType<typeof base>>[number];

/* ------------------------------------------------------------------ *
 * Documents (the sheet itself: app/track/doc/[ticket], one-time ticket from /api/track/doc)
 * ------------------------------------------------------------------ */

/**
 * The documents of one job, in timeline order:
 *   ใบรับงานซ่อม (every job) · ใบเสนอราคา (each sent quotation) · ใบส่งคืนสินค้า (once the job is closed)
 */
async function docsFor(row: {
  no: string;
  statusId: number | null;
  group: string | null;
  closedDate: string | null;
  receivedDate: string | null;
  createDate: string | null;
}): Promise<PublicDoc[]> {
  const docs: PublicDoc[] = [
    {
      kind: 'job',
      ref: row.no,
      label: 'ใบรับงานซ่อม',
      date: receivedOf(row),
      step: 'received',
    },
  ];
  const qs = await db
    .select({ no: quotationHd.quotationNo, at: quotationHd.createDate, st: quotationHd.quotationStatusId })
    .from(quotationHd)
    .where(
      and(
        eq(quotationHd.referenceJobNo, row.no),
        ne(quotationHd.recordStatus, RS.DELETED),
        inArray(quotationHd.quotationStatusId, CUSTOMER_QUOTATION_STATUSES),
      ),
    )
    .orderBy(asc(quotationHd.createDate))
    .limit(10);
  for (const q of qs) {
    const no = (q.no ?? '').trim();
    // never shown as current once expired
    const expired = quoteExpired(q.st, q.at, row.statusId);
    const label = `ใบเสนอราคา ${no}${expired ? ` · ${QUOTE_EXPIRED_TEXT}` : ''}`;
    if (no) docs.push({ kind: 'quotation', ref: no, label, date: fmtDate(q.at), step: 'waiting' });
  }
  if (row.group?.trim() === JOB_GROUP.FINISHED && !isSentinelDate(row.closedDate)) {
    docs.push({
      kind: 'return',
      ref: row.no,
      label: 'ใบส่งคืนสินค้า',
      date: fmtDate(row.closedDate),
      step: 'returned',
    });
  }
  return docs;
}

const DOC_KINDS: readonly TrackDocKind[] = ['job', 'quotation', 'return'];

/**
 * Is this document of this job still one the customer may open? Checked when the ticket is
 * issued AND again when it is used (a quotation cancelled / a job deleted in between → no).
 * The job number must come from an authorisation the server issued (session / link / ticket).
 */
export async function findDoc(jobNo: string, kind: unknown, ref: unknown): Promise<PublicDoc | null> {
  return quiet(async () => {
    if (typeof kind !== 'string' || !DOC_KINDS.includes(kind as TrackDocKind)) return null;
    if (typeof ref !== 'string' || !/^[A-Za-z0-9-]{1,50}$/.test(ref)) return null;
    const [row] = await base(eq(job.jobNo, jobNo));
    if (!row || row.recordStatus === RS.DELETED) return null;
    const docs = await docsFor(row);
    return docs.find((d) => d.kind === kind && d.ref === ref) ?? null;
  });
}

/**
 * Document links (drizzle/0019, relaxed in round 2 — see drizzle/0028): the URL /track/doc/<ticket>
 * works for DOC_LINK_MINUTES, any number of times and from any browser, but only while the
 * tracking session (phone + OTP) or the /track/<token> link that asked for it is still live.
 * LINE's in-app browser loads the page, then "open in Safari" loads it again from another
 * browser (and often another IP): the old 60-second, single-use, IP + User-Agent bound ticket
 * failed exactly there. 256 random bits, only sha256 stored — unguessable, never permanent.
 * track_doc_ticket.ua_hash holds sha256(session token | link token): the authorisation it is bound to.
 */
export const DOC_LINK_MINUTES = 10;

export async function issueDocLink(
  d: { jobNo: string; kind: string; ref: string },
  auth: string,
  ip: string,
): Promise<string> {
  await db.delete(trackDocTicket).where(lt(trackDocTicket.expiresAt, sql`now()`));
  const raw = newToken();
  await db.insert(trackDocTicket).values({
    tokenHash: sha256(raw),
    jobNo: d.jobNo,
    kind: d.kind,
    ref: d.ref,
    issuedIp: ip,
    uaHash: sha256(auth),
    expiresAt: sql`now() + make_interval(mins => ${DOC_LINK_MINUTES})`,
  });
  return raw;
}

/** the document a link names, or null: bad shape / unknown / expired / its session or link no longer live */
export async function docForLink(raw: unknown): Promise<{ jobNo: string; kind: string; ref: string } | null> {
  return quiet(async () => {
    if (typeof raw !== 'string' || !TOKEN_SHAPE.test(raw)) return null;
    const [t] = await db
      .select({
        jobNo: trackDocTicket.jobNo,
        kind: trackDocTicket.kind,
        ref: trackDocTicket.ref,
        auth: trackDocTicket.uaHash,
      })
      .from(trackDocTicket)
      .where(and(eq(trackDocTicket.tokenHash, sha256(raw)), gt(trackDocTicket.expiresAt, sql`now()`)))
      .limit(1);
    if (!t) return null;
    const [session] = await db
      .select({ n: sql<number>`1` })
      .from(trackSession)
      .where(and(eq(trackSession.tokenHash, t.auth), gt(trackSession.expiresAt, sql`now()`)))
      .limit(1);
    const [link] = session
      ? [session]
      : await db
          .select({ n: sql<number>`1` })
          .from(job)
          .where(and(eq(job.jobNo, t.jobNo), eq(job.trackTokenHash, t.auth.toString('hex')), linkLive))
          .limit(1);
    return link ? { jobNo: t.jobNo, kind: t.kind, ref: t.ref } : null;
  });
}

async function toPublic(row: Row): Promise<PublicJob> {
  const logs = await db
    .select({ statusId: jobLog.jobStatusId, at: jobLog.jobLogDate, group: jobStatus.jobStatusGroup })
    .from(jobLog)
    .leftJoin(jobStatus, eq(jobStatus.jobStatusId, jobLog.jobStatusId))
    .where(eq(jobLog.jobNo, row.no))
    .orderBy(asc(jobLog.jobLogDate), asc(jobLog.jobLogId));

  const docs = await docsFor(row);
  // a PASSED quotation step the customer has no quotation for (only cancelled / draft ones) is not shown:
  // its statuses alone do not make a ticked "รอยืนยัน" step, nor name it "ใบเสนอราคา" with no document
  const QUOTE_STATUSES: number[] = [JS.WAIT_QUOTE, JS.QUOTED, JS.QUOTE_EXPIRED];
  const quoted = docs.some((d) => d.kind === 'quotation') || QUOTE_STATUSES.includes(row.statusId ?? -1);
  const shown = quoted ? logs : logs.filter((l) => !QUOTE_STATUSES.includes(l.statusId ?? -1));

  // first time each step was reached; "received" = the header's วันที่รับเครื่อง, not the job's first log
  const seen = new Map<TrackStepKey, string>([['received', receivedOf(row)]]);
  for (const l of shown) {
    const k = stepOf(l.statusId ?? -1, l.group?.trim() ?? '');
    if (k && !seen.has(k)) seen.set(k, fmtDate(l.at));
  }
  const step = stepOf(row.statusId ?? -1, row.group?.trim() ?? '');
  if (step && !seen.has(step)) seen.set(step, '');

  // courier of the return leg (jobs closed before drizzle/0013 have none → plain tracking number)
  const trackingNo = (row.trackingNo ?? '').trim();
  // a profile deleted since (soft delete) still names the courier of a parcel already shipped with it
  const profile = row.shipperId ? await getShippingProfile(row.shipperId) : null;
  const courier = profile
    ? { name: profile.nameTh, logoUrl: profile.logoUrl, trackUrl: trackUrlFor(profile, trackingNo) }
    : null;
  // a past "expected" date while the job is still before ซ่อมเสร็จ: say so instead of a stale date
  const due = fmtDate(row.dueDate);
  const beforeRepaired = step === 'received' || step === 'diagnosing' || step === 'waiting';
  const dueDate = !due || due >= today() ? due : beforeRepaired ? DUE_PASSED_TEXT : '';

  // "รอยืนยัน / รออะไหล่" merges two things: once passed, the step says which one(s) it really was
  const was = (...ids: number[]) => shown.some((l) => ids.includes(l.statusId ?? -1));
  const waitedFor = [was(JS.WAIT_QUOTE, JS.QUOTED, JS.QUOTE_EXPIRED) && 'ใบเสนอราคา', was(JS.WAIT_PARTS) && 'รออะไหล่']
    .filter(Boolean)
    .join(' · ');
  // "ซ่อมเสร็จ" also holds ไม่ซ่อม / ไม่พบอาการเสีย / เปลี่ยนเครื่อง / คืนเงิน — once passed, say which
  const lastRepaired = logs.findLast((l) => stepOf(l.statusId ?? -1, l.group?.trim() ?? '') === 'repaired');
  const repairedAs = lastRepaired ? statusLabel(lastRepaired.statusId ?? -1, 'repaired') : '';
  const passedAs: Partial<Record<TrackStepKey, string>> = {
    waiting: waitedFor,
    repaired: repairedAs === TRACK_STEPS.find((s) => s.key === 'repaired')!.label ? '' : repairedAs,
  };

  const order = TRACK_STEPS.map((s) => s.key);
  const history = [...seen.entries()]
    .map(([key, at]) => ({ key, at, ...(passedAs[key] ? { label: passedAs[key] } : {}) }))
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

  return {
    no: row.no,
    customerMasked: maskName(row.customerName ?? row.customerDetail ?? ''),
    brandModel: [row.brand, row.model].filter(Boolean).join(' ').trim(),
    deviceRef: maskRef(row.serial ?? '') || maskRef(row.imei ?? ''),
    receivedDate: receivedOf(row),
    dueDate,
    step,
    stepLabel: statusLabel(row.statusId ?? -1, step, row.lastQuote),
    cancelled: step === null,
    history,
    shipper: (row.shipper ?? '').trim(),
    trackingNo: (row.trackingNo ?? '').trim(),
    closedDate: fmtDate(row.closedDate),
    courier,
    docs,
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
    logError(e, 'track');
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Resolve → job number (called only AFTER Turnstile passed)
 * ------------------------------------------------------------------ */

/** /track/<linkToken> → job number, or null (bad shape / unknown / deleted / expired — never say which) */
export async function jobNoForLink(token: string): Promise<string | null> {
  return quiet(async () => {
    const t = (token ?? '').trim();
    if (!TOKEN_SHAPE.test(t)) return null; // wrong shape → no query at all
    // looked up by its hash: a near-miss token has an unrelated hash, so timing reveals nothing about it
    const [row] = await db
      .select({ no: job.jobNo, recordStatus: job.recordStatus, live: linkLive })
      .from(job)
      .where(eq(job.trackTokenHash, tokenHash(t)))
      .limit(1);
    // the link's own lifetime replaces the 90-days-after-close rule: 1 day unopened, 15 min after opening
    if (!row || row.recordStatus === RS.DELETED || !row.live) return null;
    return row.no;
  });
}

/** first customer open of the current link starts its 15-minute window (later opens change nothing) */
export async function markLinkOpened(jobNo: string): Promise<void> {
  await db
    .update(job)
    .set({ trackOpenedAt: sql`now()`, trackLinkExpiresAt: sql`now() + make_interval(mins => ${LINK_OPEN_MINUTES})` })
    .where(and(eq(job.jobNo, jobNo), isNull(job.trackOpenedAt)));
}

const isoUtc = (col: SQL) => sql<string | null>`to_char((${col}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

/** when the current link of this job stops working (ISO) — shown as the page's countdown */
export async function linkExpiry(jobNo: string): Promise<string | null> {
  const [r] = await db
    .select({ at: isoUtc(linkExpiresAt) })
    .from(job)
    .where(eq(job.jobNo, jobNo))
    .limit(1);
  return r?.at ?? null;
}

/**
 * The customer is using the page: keep ≥ 5 minutes on an OPENED, still-live link, never past
 * 60 minutes from the first open. An unopened link (e.g. a staff preview) is left alone.
 * null = the link is not live (expired / rotated / unknown) — the page should close.
 */
export async function extendLink(token: string): Promise<string | null> {
  return quiet(async () => {
    const t = (token ?? '').trim();
    if (!TOKEN_SHAPE.test(t)) return null;
    const [r] = await db
      .update(job)
      .set({
        trackLinkExpiresAt: sql`LEAST(
          GREATEST(coalesce(${job.trackLinkExpiresAt}, now()), now() + make_interval(mins => ${LINK_EXTEND_MINUTES})),
          ${job.trackOpenedAt} + make_interval(mins => ${LINK_MAX_MINUTES}))`,
      })
      .where(
        and(
          eq(job.trackTokenHash, tokenHash(t)),
          ne(job.recordStatus, RS.DELETED),
          isNotNull(job.trackOpenedAt),
          gt(job.trackLinkExpiresAt, sql`now()`),
        ),
      )
      .returning({ at: isoUtc(sql`${job.trackLinkExpiresAt}`) });
    if (r?.at) return r.at;
    // not extendable but maybe still live (unopened staff preview): report its expiry as is
    const [row] = await db
      .select({ at: isoUtc(linkExpiresAt), live: linkLive, recordStatus: job.recordStatus })
      .from(job)
      .where(eq(job.trackTokenHash, tokenHash(t)))
      .limit(1);
    return row && row.live && row.recordStatus !== RS.DELETED ? row.at : null;
  });
}

export type LinkStatus = {
  state: 'unopened' | 'opened' | 'expired';
  issuedAt: string | null; // ISO
  openedAt: string | null; // ISO
  expiresAt: string | null; // ISO
};

/** back-office view of the current link (the hint next to it) */
export async function linkStatus(jobNo: string): Promise<LinkStatus> {
  const [r] = await db
    .select({
      issuedAt: isoUtc(linkIssuedAt),
      openedAt: isoUtc(sql`${job.trackOpenedAt}`),
      expiresAt: isoUtc(linkExpiresAt),
      live: linkLive,
    })
    .from(job)
    .where(eq(job.jobNo, jobNo))
    .limit(1);
  if (!r) return { state: 'expired', issuedAt: null, openedAt: null, expiresAt: null };
  return {
    state: !r.live ? 'expired' : r.openedAt ? 'opened' : 'unopened',
    issuedAt: r.issuedAt,
    openedAt: r.openedAt,
    expiresAt: r.expiresAt,
  };
}

/* ------------------------------------------------------------------ *
 * Serialize (called only with the job number bound to a consumed ticket)
 * ------------------------------------------------------------------ */

/** the job may have been deleted / expired since the ticket was issued — checked again here */
export async function publicJobByNo(jobNo: string): Promise<PublicJob | null> {
  return quiet(async () => {
    const [row] = await base(eq(job.jobNo, jobNo));
    // the ticket was issued under the link's lifetime rules (jobNoForLink);
    // here only a job deleted in the meantime is refused
    if (!row || row.recordStatus === RS.DELETED) return null;
    return toPublic(row);
  });
}

/* ------------------------------------------------------------------ *
 * Customer session (phone + OTP, see server/track-otp.ts)
 * ------------------------------------------------------------------ */

/** how far back "ประวัติ" goes (finished + cancelled jobs) */
const HISTORY_YEARS = 2;

/** customer ids from a session, as integers */
const cleanIds = (customerIds: number[]) => customerIds.map((n) => Math.trunc(Number(n))).filter(Number.isFinite);
/** a job number as the customer may type it ("j2612088 ") → "J2612088"; null when it cannot be one */
const jobNoOf = (v: unknown) => {
  const no = (typeof v === 'string' ? v : '').trim().toUpperCase();
  return /^[A-Z]{1,6}\d{5,}$/.test(no) ? no : null;
};

/**
 * Every job of these customers: still in progress, plus finished / cancelled ones from the
 * last 2 years. Summary fields only — the full (masked) job needs publicJobForCustomers.
 */
export async function listJobsForCustomers(
  customerIds: number[],
): Promise<{ active: PublicJobSummary[]; history: PublicJobSummary[] }> {
  const ids = cleanIds(customerIds);
  if (!ids.length) return { active: [], history: [] };
  const rows = await db
    .select({
      no: job.jobNo,
      statusId: job.jobStatusId,
      group: jobStatus.jobStatusGroup,
      brand: manufacturer.manufacturerName,
      model: job.productModelName,
      serial: job.productSerial,
      imei: job.productImeiNo,
      receivedDate: job.jobReceptionDate,
      createDate: job.jobCreateDate,
      closedDate: job.jobClosedDate,
      lastQuote,
    })
    .from(job)
    .leftJoin(jobStatus, eq(jobStatus.jobStatusId, job.jobStatusId))
    .leftJoin(manufacturer, eq(manufacturer.manufacturerId, job.productBrandId))
    .where(
      and(
        inArray(job.customerId, ids),
        ne(job.recordStatus, RS.DELETED),
        // in progress, or closed / cancelled within the history window (1900-01-01 = "not closed" in the legacy DB)
        sql`(coalesce(${jobStatus.jobStatusGroup}, '') NOT IN (${JOB_GROUP.FINISHED}, ${JOB_GROUP.CANCEL})
          OR CASE WHEN ${job.jobClosedDate} > '1901-01-01' THEN ${job.jobClosedDate} ELSE ${job.jobCreateDate} END
             >= (now() AT TIME ZONE 'Asia/Bangkok') - make_interval(years => ${HISTORY_YEARS}))`,
      ),
    )
    .orderBy(sql`${job.jobCreateDate} DESC`)
    .limit(200);

  const active: PublicJobSummary[] = [];
  const history: PublicJobSummary[] = [];
  for (const r of rows) {
    const step = stepOf(r.statusId ?? -1, r.group?.trim() ?? '');
    const item: PublicJobSummary = {
      no: r.no,
      brandModel: [r.brand, r.model].filter(Boolean).join(' ').trim(),
      deviceRef: maskRef(r.serial ?? '') || maskRef(r.imei ?? ''),
      receivedDate: receivedOf(r),
      closedDate: isSentinelDate(r.closedDate) ? '' : fmtDate(r.closedDate),
      step,
      stepLabel: statusLabel(r.statusId ?? -1, step, r.lastQuote),
      cancelled: step === null,
    };
    (inProgressForCustomer(r.statusId, r.group) ? active : history).push(item);
  }
  return { active, history };
}

/** one job's (masked) detail — only when it belongs to these customers and is not deleted */
export async function publicJobForCustomers(jobNo: string, customerIds: number[]): Promise<PublicJob | null> {
  return quiet(async () => {
    const no = jobNoOf(jobNo);
    const ids = cleanIds(customerIds);
    if (!no || !ids.length) return null;
    const [row] = await base(and(eq(job.jobNo, no), inArray(job.customerId, ids)));
    if (!row || row.recordStatus === RS.DELETED) return null;
    return toPublic(row);
  });
}

/** the job number, only when that job belongs to these customers and is not deleted */
export async function jobNoForCustomers(jobNo: unknown, customerIds: number[]): Promise<string | null> {
  return quiet(async () => {
    const no = jobNoOf(jobNo);
    const ids = cleanIds(customerIds);
    if (!no || !ids.length) return null;
    const [row] = await db
      .select({ no: job.jobNo })
      .from(job)
      .where(and(eq(job.jobNo, no), ne(job.recordStatus, RS.DELETED), inArray(job.customerId, ids)))
      .limit(1);
    return row?.no ?? null;
  });
}

/** the customer link for a token the caller just generated (staff copy it into LINE) */
export function trackLinkFor(token: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/track/${token}`;
}

/** a new link: only its hash is stored, fresh 1-day window, not opened yet */
const issue = (token: string) => ({
  trackTokenHash: tokenHash(token),
  trackToken: null, // legacy raw column (drizzle/0012): never written again; existing values emptied by drizzle/0033
  trackTokenAt: nowThai(),
  trackOpenedAt: null,
  trackLinkExpiresAt: null,
});

/**
 * Issue a link for a job that has none (jobs are created without one) and return its token.
 * "" when the job already has a link — its token is not stored, so it cannot be shown again.
 */
export async function ensureToken(jobNo: string): Promise<string> {
  const token = newToken();
  const r = await db
    .update(job)
    .set(issue(token))
    .where(and(eq(job.jobNo, jobNo), isNull(job.trackTokenHash)))
    .returning({ no: job.jobNo });
  return r.length ? token : '';
}

/** staff action: old link stops working immediately; the new one gets a fresh 1-day window */
export async function rotateToken(jobNo: string): Promise<string> {
  const token = newToken();
  await db.update(job).set(issue(token)).where(eq(job.jobNo, jobNo));
  return token;
}
