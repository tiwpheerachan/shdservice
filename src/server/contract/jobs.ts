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

/** ปิดงาน's fields without a stored job: the receipt no and the return parcel no are only text here */
const close = closeSchema().shape;
const CloseBody = z.looseObject({
  ...close,
  payment: close.payment
    .unwrap()
    .extend({ no: optText })
    .optional()
    .meta({ description: 'Left out when nobody paid (an in-warranty job).' }),
  refund: close.refund.meta({ description: 'The deposit given back.' }),
  return: close.return.extend({ tracking: optText, shipperId: optNum }),
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
  description: 'Job Management edit. Rules: `callLogSchema` (src/lib/validation/stock.ts).',
  params: jobNo,
  body: callLogSchema,
  responses: {
    200: jsonResponse('The call log after the add.', z.object({ ok: z.literal(true), rows: z.array(CallLog) })),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No such job.'),
    ...CONFLICT,
  },
});

export const jobClose = defineOperation({
  method: 'post',
  path: '/jobs/{no}/close',
  tags,
  summary: 'Close a job and return the device (ปิดงาน-ส่งคืนสินค้า)',
  description:
    'Job Closing edit. Rules: `closeSchema(prev)` in src/lib/validation/job.ts, run by the service against the stored receipt / parcel number and the deposit still to refund.',
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
  description: 'Job Repair edit. Rules: `outsourceActionSchema` (src/lib/validation/job.ts).',
  params: jobNo,
  body: outsourceActionSchema.safeExtend({
    engineerSymptom: optText.meta({ description: 'อาการเสียที่ตรวจพบ (a symptom name)' }),
    receive: outsourceActionSchema.shape.receive.unwrap().extend({ from: optText }).optional(),
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
    'Job Repair edit. Rules: `repairActionSchema` (src/lib/validation/job.ts). Each part line is quoted as option A and B; `pick` = take from stock, `quote` = charge it.',
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
    'Job Management edit. Rules: `swapRefundSchema(job)` (src/lib/validation/job.ts), run by the service against the stored job — refund fields make it a refund, otherwise `newSerial` is required.',
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
  summary: "The customer's tracking link: its state, and the URL only when this call issued the first one",
  description:
    'Job Management view reads the state. The first link is issued (and audited) only for a caller who also has Job Management edit. Only a hash of a link is stored, so an existing link is never shown again — POST makes a new one.',
  params: jobNo,
  responses: {
    200: jsonResponse(
      'State of the link.',
      z.object({
        url: s.meta({ description: '"" unless this call issued the job\'s first link.' }),
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
    jobNo: z
      .unknown()
      .optional()
      .transform((v) =>
        String(v ?? '')
          .trim()
          .toUpperCase(),
      )
      .meta({ type: 'string', description: 'หมายเลขงาน — must exist (404).' }),
    remark: z
      .unknown()
      .optional()
      .transform((v) => String(v ?? '').slice(0, 200))
      .meta({ type: 'string', description: 'Read up to 200 characters (the rest is dropped).' }),
  }),
  headers: IDEMPOTENCY.headers,
  invalid: { form: 400, ...IDEMPOTENCY.invalid },
  responses: {
    ...IDEMPOTENCY.responses,
    200: jsonResponse(
      'Stored.',
      z.object({
        ok: z.literal(true),
        row: z.object({ id: n, name: s, file: s.meta({ description: 'the stored file name' }), remark: s }),
      }),
    ),
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
