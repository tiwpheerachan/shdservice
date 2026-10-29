import { z } from 'zod';
import {
  closeSchema,
  jobSchema,
  outsourceActionSchema,
  repairActionSchema,
  swapRefundSchema,
} from '@/lib/validation/job';
import { assignSchema, callLogSchema } from '@/lib/validation/stock';
import {
  CONFLICT,
  IDEMPOTENCY,
  JSON_BODY,
  Ok,
  RATE_LIMITED,
  SIGNED_IN,
  byNo,
  choice,
  errorResponse,
  flag,
  jsonResponse,
  notFound,
  redirect,
  version,
} from './common';
import { defineOperation } from './registry';
import { JobDetail, LinkStatus } from './shapes';

/** Jobs (งานซ่อม) and what hangs off one: calls, attachments, the workflow screens, the tracking link. */

const s = z.string();
const n = z.number();
const tags = ['Jobs'];
const jobNo = byNo('หมายเลขงาน (J…)');
const answer = (what: string) => jsonResponse(what, z.object({ ok: z.literal(true), job: JobDetail }));

/** a field the pages always send as text / a number (never null) */
const optText = s.optional();
const optNum = n.optional();

/**
 * The job form's fields (jobSchema in src/lib/validation/job.ts) without a stored job: SO / Serial / IMEI /
 * reception parcel no are checked against the stored values ("never worse"), so here they are only text;
 * what is required is decided by the service (`jobSchema(keep, check)`), which runs the whole set.
 */
const JobBody = z
  .looseObject({
    ...jobSchema().shape,
    so: optText,
    serial: optText,
    imei: optText,
    receptionTrackingNo: optText,
    version,
    takeOver: flag.meta({ description: 'Take a job assigned to someone else (else 409).' }),
  })
  .meta({ id: 'JobInput' });

/** a workflow page's shared job sections, sent with its action (one request: they save — or not — with it) */
const pageJob = JobBody.optional();
const PAGE_JOB =
  " `job` = the page's shared job sections: PATCH /jobs/{no}'s body and rules (its `version` / `status` unused — the action's count), saved in the action's transaction, so a refused action saves none of them; needs Job Management edit (else 403).";

/** ปิดงาน's fields without a stored job: the receipt no, the return parcel no and the new serial are only text here */
const close = closeSchema().shape;
const CloseBody = z.looseObject({
  ...close,
  newSerial: optText.meta({
    description:
      'Serial เครื่องใหม่ of a swap job, optional: a changed one is written as the swap saves it (a "New S/N" line of the part list and the swap detail).',
  }),
  payment: close.payment
    .unwrap()
    .extend({ no: optText })
    .optional()
    .meta({ description: 'Left out when nobody paid (an in-warranty job).' }),
  refund: close.refund.meta({ description: 'The deposit given back.' }),
  return: close.return.extend({ tracking: optText, shipperId: optNum }),
  job: pageJob,
  version,
});

/** Swap / Refund's fields without a stored job: New S/N, doc no and refund ref are only text here */
const SwapBody = z.looseObject({
  ...swapRefundSchema().shape,
  newSerial: optText,
  docNo: optText,
  refundRef: optText,
  newModel: optText,
  detail: optText,
  job: pageJob,
  version,
});

const SeenJob = z.object({
  no: s,
  date: s.meta({ description: 'Opened on, YYYY-MM-DD.' }),
  sameCustomer: z.boolean(),
  bounce: z.boolean().meta({ description: 'Ticked งานเด้ง.' }),
  model: s,
});

export const jobChecksGet = defineOperation({
  method: 'get',
  path: '/jobs/checks',
  tags,
  summary: 'Warnings while a job is typed in (never a refusal)',
  description:
    "The Serial No. on other jobs (newest 5), the Sale Order No. on other customers' jobs (needs `customer`), a Serial that looks like another brand family's or like none of the chosen brand's, a shop that mostly sells another brand. Needs view on any job screen.",
  query: z.object({
    serial: s.optional(),
    so: s.optional(),
    brand: s.optional().meta({ description: 'The chosen brand (ยี่ห้อ) name.' }),
    shop: s.optional(),
    customer: s.optional().meta({ description: 'The chosen customer code.' }),
    job: s.optional().meta({ description: 'The job being edited — left out of the matches.' }),
  }),
  responses: {
    200: jsonResponse(
      'What to warn about.',
      z.object({
        serial: z.object({
          jobs: z.array(SeenJob),
          looksLike: s.nullable().meta({ description: 'The brand whose serials look like this one (another family).' }),
          unusual: z.boolean().meta({ description: "None of the chosen brand family's jobs has a serial like it." }),
        }),
        so: z.object({ jobs: z.array(SeenJob) }),
        shop: z.object({
          brand: s.nullable().meta({ description: 'The brand this shop mostly sells (another family).' }),
        }),
      }),
    ),
    ...SIGNED_IN,
  },
});

export const jobSuggestionsGet = defineOperation({
  method: 'get',
  path: '/jobs/suggestions',
  tags,
  summary: 'Values typed before into a free-text job field, most used first',
  description:
    'Shop Name (`shop`), อุปกรณ์ (ที่นำส่ง) (`accessories`), จุดตำหนิ (`defects`): the 10 most used values (spaces trimmed and collapsed, case kept) that contain `q` in any case; no `q` = the 10 most used. Another `field` answers none. Needs view on any job screen.',
  query: z.object({ field: choice(['shop', 'accessories', 'defects']), q: s.optional() }),
  responses: {
    200: jsonResponse('Most used first.', z.object({ values: z.array(s) })),
    ...SIGNED_IN,
  },
});

export const jobGet = defineOperation({
  method: 'get',
  path: '/jobs/{no}',
  tags,
  summary: 'A job with everything every job screen shows',
  description: 'Needs view on any job screen or Quotation.',
  params: jobNo,
  responses: {
    200: jsonResponse('The job.', z.object({ job: JobDetail })),
    ...SIGNED_IN,
    ...notFound('No such job.'),
  },
});

export const jobUpdate = defineOperation({
  method: 'patch',
  path: '/jobs/{no}',
  tags,
  summary: 'Edit a job (แก้ไขข้อมูลงาน)',
  description:
    'Job Management edit. Rules: `jobSchema(keep, check)` in src/lib/validation/job.ts, run by the service against the stored job — a required field that had a value must keep one, and an unchanged legacy value passes ("never worse").',
  params: jobNo,
  body: JobBody,
  responses: {
    200: answer('Saved; the job as stored now.'),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such job.'),
    ...CONFLICT,
  },
});

export const jobCreate = defineOperation({
  method: 'post',
  path: '/jobs',
  tags,
  summary: 'Open a job (เปิดงานใหม่)',
  description:
    'Job Management add. Rules: `jobSchema()` in src/lib/validation/job.ts, run by the service (every required field). Takes an Idempotency-Key.',
  headers: IDEMPOTENCY.headers,
  invalid: IDEMPOTENCY.invalid,
  body: JobBody,
  responses: {
    201: answer('Created.'),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('A referenced customer / model / status does not exist.'),
    ...IDEMPOTENCY.responses,
  },
});

export const jobAssign = defineOperation({
  method: 'post',
  path: '/jobs/assign',
  tags,
  summary: 'Assign an engineer to jobs (จนท.รับมอบหมายงาน)',
  description:
    'Job Assign edit. Rules: `assignSchema` (src/lib/validation/stock.ts). The engineer must hold the special right Job Take; a job someone else has → 409 unless `takeOver: true`.',
  body: assignSchema.extend({ takeOver: flag.meta({ description: 'Take jobs someone else has (else 409).' }) }),
  responses: {
    200: jsonResponse('How many jobs were assigned.', z.object({ ok: z.literal(true), assigned: n })),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('A job or the engineer does not exist.'),
    ...CONFLICT,
  },
});

export const CallLog = z.object({ id: n, detail: s, date: s, by: s });

export const jobCalls = defineOperation({
  method: 'get',
  path: '/jobs/{no}/calls',
  tags,
  summary: "A job's call log (บันทึกการโทร)",
  params: jobNo,
  responses: { 200: jsonResponse('Newest first.', z.object({ rows: z.array(CallLog) })), ...SIGNED_IN },
});

export const jobCallAdd = defineOperation({
  method: 'post',
  path: '/jobs/{no}/calls',
  tags,
  summary: 'Add a call log line',
  description: 'Job Management edit. Rules: `callLogSchema` (src/lib/validation/stock.ts). Takes an Idempotency-Key.',
  params: jobNo,
  headers: IDEMPOTENCY.headers,
  invalid: IDEMPOTENCY.invalid,
  body: callLogSchema,
  responses: {
    200: jsonResponse('The call log after the add.', z.object({ ok: z.literal(true), rows: z.array(CallLog) })),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such job.'),
    ...IDEMPOTENCY.responses,
  },
});

export const jobClose = defineOperation({
  method: 'post',
  path: '/jobs/{no}/close',
  tags,
  summary: 'Close a job and return the device (ปิดงาน-ส่งคืนสินค้า)',
  description:
    'Job Closing edit. Rules: `closeSchema(prev)` in src/lib/validation/job.ts, run by the service against the stored receipt / parcel number / new serial and the deposit still to refund.' +
    PAGE_JOB,
  params: jobNo,
  body: CloseBody,
  responses: {
    200: answer('Closed; the job as stored now.'),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such job.'),
    ...CONFLICT,
  },
});

export const jobOutsource = defineOperation({
  method: 'post',
  path: '/jobs/{no}/outsource',
  tags,
  summary: 'Send to / receive back from an outside repairer (ส่งซ่อม Out-Source)',
  description: 'Job Repair edit. Rules: `outsourceActionSchema` (src/lib/validation/job.ts).' + PAGE_JOB,
  params: jobNo,
  body: outsourceActionSchema.safeExtend({
    engineerSymptom: optText.meta({ description: 'อาการเสียที่ตรวจพบ (a symptom name)' }),
    receive: outsourceActionSchema.shape.receive.unwrap().extend({ from: optText }).optional(),
    job: pageJob,
    version,
  }),
  responses: {
    200: answer('Saved; the job as stored now.'),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such job.'),
    ...CONFLICT,
  },
});

const repairPart = repairActionSchema.shape.parts.unwrap().element;
/** เบิก / เสนอ of one option (A or B) */
const partPick = { pick: z.boolean().optional(), quote: z.boolean().optional() };

export const jobRepair = defineOperation({
  method: 'post',
  path: '/jobs/{no}/repair',
  tags,
  summary: 'Save the repair (บันทึกงานซ่อม): details, costs, part requests, status',
  description:
    'Job Repair edit. Rules: `repairActionSchema` (src/lib/validation/job.ts). Each part line is quoted as option A and B; `pick` = take from stock, `quote` = charge it.' +
    PAGE_JOB,
  params: jobNo,
  body: repairActionSchema.extend({
    engineerSymptom: optText.meta({ description: 'อาการเสียที่ตรวจพบ (a symptom name)' }),
    parts: z
      .array(
        repairPart.extend({
          logId: optNum,
          code: optText,
          // both always sent (the page's A and B columns); saveRepair reads each
          a: repairPart.shape.a.unwrap().extend(partPick),
          b: repairPart.shape.b.unwrap().extend(partPick),
        }),
      )
      .optional(),
    job: pageJob,
    version,
  }),
  responses: {
    200: answer('Saved; the job as stored now.'),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such job or part.'),
    ...CONFLICT,
  },
});

export const jobSwapRefund = defineOperation({
  method: 'post',
  path: '/jobs/{no}/swap-refund',
  tags,
  summary: 'Record a swap or a refund (Swap / Refund)',
  description:
    "Job Management edit. Rules: `swapRefundSchema(job)` (src/lib/validation/job.ts), run by the service against the stored job — refund fields make it a refund (`newSerial` is never required). `status`: job_status 17 / 18 (swap) or 17 / 19 (refund), or the job's current one." +
    PAGE_JOB,
  params: jobNo,
  body: SwapBody,
  responses: {
    200: answer('Saved; the job as stored now.'),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such job.'),
    ...CONFLICT,
  },
});

export const trackLinkGet = defineOperation({
  method: 'get',
  path: '/jobs/{no}/track-link',
  tags,
  summary: "The customer's tracking link: its state (read-only)",
  description:
    'Job Management view. Never issues a link: only a hash of a link is stored, so an existing link is never shown again — POST issues one (the first one too).',
  params: jobNo,
  responses: {
    200: jsonResponse(
      'State of the link.',
      z.object({
        url: s.meta({ description: 'Always "" (kept for older clients) — POST returns a link.' }),
        ready: z.boolean().meta({ description: 'Always true (kept for older clients; every job can be tracked).' }),
        status: LinkStatus,
      }),
    ),
    ...SIGNED_IN,
    ...notFound('No such job.'),
  },
});

export const trackLinkNew = defineOperation({
  method: 'post',
  path: '/jobs/{no}/track-link',
  tags,
  summary: 'Issue a new tracking link (the previous one stops working)',
  description: 'Job Management edit. The URL is returned once, to the person who generated it.',
  params: jobNo,
  responses: {
    200: jsonResponse('The new link.', z.object({ url: s, status: LinkStatus })),
    ...SIGNED_IN,
    ...notFound('No such job.'),
  },
});

/** หมายเลขงาน a file is stored for — upper-cased; must exist (404) */
const attachJobNo = z
  .unknown()
  .optional()
  .transform((v) =>
    String(v ?? '')
      .trim()
      .toUpperCase(),
  )
  .meta({ type: 'string', description: 'หมายเลขงาน — must exist (404).' });
const attachRemark = z
  .unknown()
  .optional()
  .transform((v) => String(v ?? '').slice(0, 200))
  .meta({ type: 'string', description: 'Read up to 200 characters (the rest is dropped).' });
const AttachmentRow = z.object({
  ok: z.literal(true),
  row: z.object({ id: n, name: s, file: s.meta({ description: 'the stored file name' }), remark: s }),
});

export const attachmentAdd = defineOperation({
  method: 'post',
  path: '/attachments',
  tags,
  summary: 'Attach a file to a job',
  description:
    'Job Management edit. Stored under jobs/{jobNo}/ in Supabase Storage; images / PDF up to 10 MB (checked against the bytes).',
  form: z.object({
    // in the order the route always checked them
    file: z
      .custom<File>((v) => v instanceof File, { error: 'ไม่พบไฟล์' })
      .meta({ type: 'string', format: 'binary', description: 'image / PDF, ≤ 10 MB' }),
    jobNo: attachJobNo,
    remark: attachRemark,
  }),
  headers: IDEMPOTENCY.headers,
  invalid: { form: 400, ...IDEMPOTENCY.invalid },
  responses: {
    ...IDEMPOTENCY.responses,
    200: jsonResponse('Stored.', AttachmentRow),
    ...SIGNED_IN,
    400: errorResponse('Not multipart/form-data, or no file.'),
    ...notFound('No such job.'),
    409: errorResponse(
      'The job is deleted (cancelled) — nothing is stored; or the same Idempotency-Key is still running.',
    ),
    413: errorResponse('File over 10 MB.'),
    415: errorResponse('Not an allowed file type.'),
    ...RATE_LIMITED,
  },
});

const VIDEO_TYPE = 'รองรับเฉพาะวิดีโอ MP4, MOV, WebM';
const VIDEO_STORE_DOWN =
  'The database did not answer, or video storage (Cloudflare R2: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET) is not configured — `ยังไม่ได้ตั้งค่าที่เก็บวิดีโอ — ติดต่อผู้ดูแลระบบ`.';

export const attachmentVideoUrl = defineOperation({
  method: 'post',
  path: '/attachments/video',
  tags,
  summary: 'Get a one-time URL to upload a video attachment straight to storage',
  description:
    "Job Management edit, the job's checks of POST /attachments. The browser converts the clip first (MP4 H.264 + AAC, ≤ 3 minutes — src/lib/video.ts), PUTs it to `url` (a Cloudflare R2 presigned URL, valid 2 h; `Content-Type` and `If-None-Match: *` are signed — send both; an existing object is never overwritten, 412) — never through this server — then calls POST /attachments/video/confirm. The path is chosen here: jobs/{jobNo}/attachments/{file}, `file` = `v` + 14 digits + 20 hex + the extension (the `v` keeps it in R2).",
  body: z.object({
    jobNo: attachJobNo,
    type: z
      .enum(['video/mp4', 'video/quicktime', 'video/webm'], { error: VIDEO_TYPE })
      .meta({ description: 'the type of the file to be PUT (a converted clip: video/mp4) — sets its extension' }),
  }),
  invalid: { body: 400 },
  responses: {
    200: jsonResponse(
      'Where to PUT the file (`Content-Type` = `type`, `If-None-Match: *`).',
      z.object({
        file: s.meta({ description: 'the stored file name — sent back to confirm' }),
        url: s.meta({ description: 'R2 presigned upload URL' }),
      }),
    ),
    ...SIGNED_IN,
    503: errorResponse(VIDEO_STORE_DOWN),
    ...JSON_BODY,
    400: errorResponse('Not JSON (`invalid_json`), or a type other than MP4 / MOV / WebM.'),
    ...notFound('No such job.'),
    409: errorResponse('The job is deleted (cancelled).'),
    ...RATE_LIMITED,
  },
});

export const attachmentVideoConfirm = defineOperation({
  method: 'post',
  path: '/attachments/video/confirm',
  tags,
  summary: 'Attach a video uploaded with POST /attachments/video',
  description:
    'Job Management edit. Checks what arrived in R2 — there, ≤ 200 MB, stored as a video and its first bytes an MP4 / MOV `ftyp` box or a WebM EBML header (a ranged read, not the whole file) — then inserts the attachment row as POST /attachments does. Refused → the object is removed. `thumb` (a JPEG of the frame ~1 s in) is stored next to it as {file}.jpg. Staff only, like every job attachment.',
  form: z.object({
    // in the order the route checks them
    jobNo: attachJobNo,
    file: z
      .string({ error: 'ไม่พบไฟล์วิดีโอที่อัปโหลด' })
      .regex(/^v\d{14}[0-9a-f]{20}\.(?:mp4|mov|webm)$/, 'ไม่พบไฟล์วิดีโอที่อัปโหลด')
      .meta({ description: 'the `file` POST /attachments/video answered' }),
    name: z
      .unknown()
      .optional()
      .transform((v) => String(v ?? '').slice(0, 200))
      .meta({ type: 'string', description: 'the file name to show' }),
    remark: attachRemark,
    thumb: z
      .custom<File>((v) => v instanceof File, { error: 'ภาพตัวอย่างต้องเป็นไฟล์ JPEG' })
      .optional()
      .meta({
        type: 'string',
        format: 'binary',
        description: 'JPEG, optional (a browser that cannot decode the clip sends none)',
      }),
  }),
  invalid: { form: 400 },
  responses: {
    200: jsonResponse('Attached.', AttachmentRow),
    ...SIGNED_IN,
    503: errorResponse(VIDEO_STORE_DOWN),
    400: errorResponse('Not multipart/form-data, or no / not an issued file name.'),
    ...notFound('No such job, or nothing was uploaded under that name.'),
    409: errorResponse('The job is deleted (cancelled), or this video is already attached.'),
    413: errorResponse('Video over 200 MB, or a thumbnail over 1 MB.'),
    415: errorResponse('Not a real MP4 / MOV / WebM video, or the thumbnail is not a JPEG.'),
    ...RATE_LIMITED,
  },
});

const attachmentId = z.object({ id: s.regex(/^\d{1,9}$/, 'not found').meta({ description: 'document_attach id' }) });

export const attachmentGet = defineOperation({
  method: 'get',
  path: '/attachments/{id}',
  tags,
  summary: 'Open an attachment',
  params: attachmentId,
  invalid: { params: 404 },
  responses: {
    307: redirect('To a short-lived signed URL of the file.'),
    ...SIGNED_IN,
    ...notFound('No such attachment (or it was removed), or the file is still on the old system.'),
  },
});

export const attachmentDelete = defineOperation({
  method: 'delete',
  path: '/attachments/{id}',
  tags,
  summary: 'Remove an attachment',
  description:
    'Job Management del. Soft delete: the row is marked DELETED (audited) and no longer listed or opened; the stored file is kept.',
  params: attachmentId,
  invalid: { params: 404 },
  responses: {
    200: jsonResponse('Removed.', Ok),
    ...SIGNED_IN,
    ...notFound('No such attachment, or already removed.'),
  },
});
