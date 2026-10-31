import { z } from 'zod';
import {
  IDEMPOTENCY,
  JSON_BODY,
  Ok,
  RATE_LIMITED,
  SIGNED_IN,
  choice,
  errorResponse,
  jsonResponse,
  notFound,
  redirect,
  uuid,
} from './common';
import { defineOperation, type Operation } from './registry';
import { clean, moneyField } from '@/lib/validation';

/** Lookups, files, uploads, health, sign-in (SSO) and this document itself. */

const s = z.string();
const n = z.number();
const b = z.boolean();
const PUBLIC = [] as const;
/** a uuid, read as left out when it is none (the lists answer no rows, as for a missing one) */
const anyUuid = uuid().optional().catch(undefined).meta({ type: 'string', format: 'uuid' });

export const address = defineOperation({
  method: 'get',
  path: '/address',
  tags: ['Customers'],
  summary: 'Cascading address lists: provinces → districts → sub-districts',
  description: 'Any approved user.',
  query: z.object({
    level: choice(['province', 'district', 'subdistrict']).meta({
      description: 'Default (and anything else): `province`.',
    }),
    city: anyUuid.meta({ description: "the province's uuid (level=district); left out or no uuid = no rows" }),
    district: anyUuid.meta({ description: "the district's uuid (level=subdistrict); left out or no uuid = no rows" }),
  }),
  responses: {
    200: jsonResponse(
      '`postal` only on sub-districts.',
      z.object({ rows: z.array(z.object({ id: z.uuid(), name: s, postal: s.optional() })) }),
    ),
    ...SIGNED_IN,
  },
});

export const addressCreate = defineOperation({
  method: 'post',
  path: '/address',
  tags: ['Customers'],
  summary: 'Add a sub-district the list lacks (customer form "+ เพิ่มชื่อ")',
  description:
    'Customer edit. The name is cleaned (≤ 50, the column) and must not already be in that district (409); postal = 5 digits; an unknown district → 404. Audited; everyone gets it from GET /address. Takes an Idempotency-Key.',
  headers: IDEMPOTENCY.headers,
  invalid: IDEMPOTENCY.invalid,
  body: z.object({
    district: uuid('เลือกเขต / อำเภอก่อน').meta({ description: "the district's uuid (GET /address)" }),
    name: s
      .refine((v) => clean(v) !== '', 'ต้องระบุชื่อแขวง / ตำบล')
      .refine((v) => clean(v).length <= 50, 'ชื่อแขวง / ตำบลยาวเกิน 50 ตัวอักษร'),
    postal: s.refine((v) => /^\d{5}$/.test(clean(v)), 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก'),
  }),
  responses: {
    201: jsonResponse('Added.', z.object({ ok: z.literal(true), row: z.object({ id: z.uuid(), name: s, postal: s }) })),
    ...SIGNED_IN,
    ...JSON_BODY,
    ...notFound('No district with that id.'),
    ...IDEMPOTENCY.responses,
  },
});

const PATH_REQUIRED = 'path required';
/** no session needed (the public logo folders), or the session cookie */
const SESSION_OR_NONE: Operation['security'] = [{}, { session: [] }];

export const files = defineOperation({
  method: 'get',
  path: '/files',
  tags: ['Files'],
  security: SESSION_OR_NONE,
  summary: 'Open a stored file by its storage path (a signed URL)',
  description:
    'Only the folders the app writes can be signed. `shippers/{id}/…` and `profiles/{id}/…` (logos on the public tracking page and customer documents) are public, 120 a minute per IP; jobs / sale-orders / products need a signed-in user who may view that screen (jobs: any job module; sale-orders: Sale Order or Product Pick Stock; products: any product / stock module) — else 403. A job attachment (and the `.jpg` thumbnail of a video) opens only while its attachment row is there — removed → 404; `download=1` saves it under its attached name. A picture (jpg / png / webp / svg, never a slip) gets one URL a day shared by everyone, cacheable; a video URL is valid 15 minutes (it plays from it), a slip / PDF 2. A video attached since the move to Cloudflare R2 (jobs/{no}/attachments/v{14 digits}{20 hex}.mp4|mov|webm) and its `.jpg` thumbnail redirect to an R2 presigned URL — or, when MEDIA_BASE_URL / MEDIA_SIGNING_KEY are set and it is not a download, to a link of the media CDN signed for the same time (workers/media; `direct=1` = R2 presigned anyway, a direct thumbnail that is not there → 404); everything else (legacy .mp4 attachments included) to Supabase Storage.',
  query: z.object({
    path: z
      .string({ error: PATH_REQUIRED })
      .transform((v) => v.replace(/^\/+/, ''))
      .pipe(
        z
          .string()
          .min(1, PATH_REQUIRED)
          .max(300, PATH_REQUIRED)
          // no traversal, no control characters, no backslashes
          .refine((v) => !v.includes('..') && !/[\x00-\x1f\\]/.test(v), PATH_REQUIRED),
      )
      .meta({ type: 'string', maxLength: 300, example: 'products/P00230/x.jpg', description: 'Leading `/` ignored.' }),
    download: choice(['1']).meta({ description: '`1` = sent as a download (Content-Disposition: attachment).' }),
    direct: choice(['1']).meta({
      description:
        "`1` = an R2 video / thumbnail from R2's own presigned URL even when the media CDN is set — the player's one fallback when a media link failed (60 a minute per user; logged as `media fallback`). Ignored for files not in R2.",
    }),
    reason: choice(['aborted', 'network', 'decode', 'src', 'image']).meta({
      description:
        'With `direct=1`: why the media link failed (MediaError code, or `image` for a thumbnail) — logged only.',
    }),
  }),
  invalid: { query: 400 },
  responses: {
    307: redirect('To the signed URL (cacheable while it is valid).'),
    400: errorResponse('No / bad path.'),
    ...SIGNED_IN,
    503: errorResponse(
      'The database did not answer, or file storage failed — `ระบบจัดเก็บไฟล์ขัดข้อง ลองใหม่ภายหลัง` (not a missing file).',
    ),
    ...notFound('Not a folder the app writes, no such file (or still on the old system), or a removed attachment.'),
    ...RATE_LIMITED,
  },
});

export const upload = defineOperation({
  method: 'post',
  path: '/upload',
  tags: ['Files'],
  summary: 'Upload a product image, a payment slip or a profile logo',
  description:
    "The permission follows `kind`: product-image → Product edit; sale-order-slip → Sale Order edit (a denied / cancelled order's slip is final, an approved one's too once it has a slip — an approved order without one takes it, with `paymentAmount`; a waiting one is its creator's); job-slip → Job Closing edit (a cancelled job's slip is refused; a closed job's needs Job Money After Close, and its previous slip is kept); profile-logo / shipper-logo → System Admin. Photos are resized server-side; replacing a file removes the previous one.",
  form: z.object({
    kind: choice(['product-image', 'sale-order-slip', 'job-slip', 'profile-logo', 'shipper-logo']).meta({
      description: 'Anything else → 400 "unknown kind" (after the file checks).',
    }),
    // in the order the route always checked them
    file: z
      .custom<File>((v) => v instanceof File, { error: 'file required' })
      .meta({ type: 'string', format: 'binary', description: 'images (JPEG / PNG / WebP); slips may be PDF; ≤ 10 MB' }),
    id: z
      .unknown()
      .optional()
      .transform((v) => {
        const id = String(v ?? '').trim();
        // a uuid (ADR 0008) is read lower-cased, a code / number upper-cased
        return z.uuid().safeParse(id).success ? id.toLowerCase() : id.toUpperCase();
      })
      .pipe(z.string().min(1, 'id required'))
      .meta({
        type: 'string',
        description: "product code / job no / the sale order's id / the profile's id (uuids; anything else → 404)",
      }),
    paymentAmount: moneyField('จำนวนเงินที่ชำระ', 10_000_000).meta({
      type: 'string',
      description:
        'sale-order-slip: the amount paid, recorded with the slip (≤ the order total). Other kinds ignore it.',
    }),
  }),
  invalid: { form: 400 },
  responses: {
    200: jsonResponse(
      'Stored.',
      z.object({ ok: z.literal(true), path: s.meta({ description: 'storage path (open with GET /files)' }), file: s }),
    ),
    ...SIGNED_IN,
    400: errorResponse(
      'Not multipart, no file / id, an unknown kind, or a paid amount that is not money / over the order total.',
    ),
    ...notFound('No such product / order / job / profile.'),
    409: errorResponse(
      'The sale order is denied or cancelled, or approved with a slip already, or the job is cancelled / closed (without Job Money After Close) — its slip cannot change.',
    ),
    413: errorResponse('File over 10 MB, or an image over 40 megapixels.'),
    415: errorResponse('Not an allowed file type (checked against the bytes).'),
    ...RATE_LIMITED,
  },
});

export const health = defineOperation({
  method: 'get',
  path: '/health',
  tags: ['Public'],
  security: [...PUBLIC],
  summary: 'Is the database reachable (always 200 — the verdict is in the body)',
  description:
    'For Render and uptime monitors: never a 5xx, so a database blip does not get the only instance restarted. Anonymous callers get `ok` only; System Admin also gets the configuration and counts below.',
  responses: {
    200: jsonResponse(
      '`ok` false = the database did not answer.',
      z.object({
        ok: b,
        maintenance: z
          .literal(true)
          .optional()
          .meta({ description: 'present while MAINTENANCE_MODE=1 (every other path answers 503)' }),
        hasDatabaseUrl: b.optional(),
        hasCentralApiKey: b.optional(),
        hasSsoClientSecret: b.optional(),
        ssoClientId: s.optional(),
        ownerEmailsConfigured: n.optional(),
        db: z.enum(['ok', 'error']).optional(),
        dbError: s.optional(),
        dbLatencyMs: n.optional(),
        appUsers: n.optional(),
        pendingUsers: n.optional(),
        appColumnsPresent: b.optional(),
        migrationsRecorded: n.optional(),
        timezone: z.object({ db: s.optional(), process: s, ok: b }).optional(),
        clockSkewMs: n.nullable().optional(),
      }),
    ),
  },
});

export const openapiJson = defineOperation({
  method: 'get',
  path: '/openapi.json',
  tags: ['Docs'],
  summary: 'This document (OpenAPI 3.0)',
  description: 'Any approved user. The same document /api-docs is built from.',
  responses: {
    200: jsonResponse('The document.', z.record(s, z.unknown())),
    ...SIGNED_IN,
  },
});

/* ------------------------------------------------------------------ sso -- */

const ssoTags = ['Sign-in'];

export const ssoLogin = defineOperation({
  method: 'get',
  path: '/sso/login',
  tags: ssoTags,
  security: [...PUBLIC],
  summary: 'Start signing in through the central SSO',
  description:
    'A top-level navigation (the /login button), not a fetch: a router prefetch is sent to /login instead. `prompt=login` asks the SSO to re-authenticate (sign in as someone else).',
  query: z.object({
    next: s.optional().meta({ description: 'Where to land afterwards (a same-site path).' }),
    prompt: choice(['login']).meta({ description: 'Anything else is ignored.' }),
  }),
  responses: {
    307: redirect(
      'To the SSO authorize page (sets the `__Host-os_state` cookie — `os_state` outside production), or to /login.',
    ),
  },
});

export const ssoCallback = defineOperation({
  method: 'get',
  path: '/sso/callback',
  tags: ssoTags,
  security: [...PUBLIC],
  summary: 'Where the SSO sends the browser back: verify, provision the user, set the session cookie',
  description:
    'Failures land on `/login?error=<reason>` (missing_code, state_mismatch, verify_…, no_email, user_conflict, db_unavailable).',
  query: z.object({ code: s.optional(), state: s.optional() }),
  responses: { 307: redirect('To `next` with the session cookie, or to /login?error=….') },
});

export const ssoLogout = defineOperation({
  method: 'get',
  path: '/sso/logout',
  tags: ssoTags,
  security: [...PUBLIC],
  summary: 'Sign out on every device',
  description:
    "Bumps the user's session_version (every cookie of theirs dies). Only from our own pages or a typed URL: a link on another site is sent to `/` without signing anyone out.",
  responses: {
    204: { description: 'A router prefetch — nothing happens.' },
    307: redirect('To /login?bye=1 (cookie cleared), or `/` from another site.'),
  },
});

const signedOut = jsonResponse(
  'Not signed in. `reason`: `elsewhere` = a cookie that verifies but is refused (signed out on another device, account changed); `expired` = idle timeout or the 12-hour cap.',
  z.object({
    user: z.null(),
    reason: z.enum(['expired', 'elsewhere']),
    signedOut: z.literal(true).optional().meta({ description: 'This browser signed out (ออกจากระบบ).' }),
  }),
);
const dbDown = errorResponse('The database did not answer — unknown, not signed out: keep the last answer and retry.');

export const meTour = defineOperation({
  method: 'post',
  path: '/me/tour',
  tags: ['Sign-in'],
  summary: 'Remember a step-by-step tutorial (บทสอน) answer for the signed-in user',
  description:
    '`seen` = the page path whose "ดูวิธีใช้หน้านี้ไหม?" was answered; `off` = never ask again on any page. Any approved user; only their own row.',
  body: z.object({
    seen: s.max(100).optional().meta({ example: '/jobs/new' }),
    off: b.optional(),
  }),
  responses: { 200: jsonResponse('Remembered.', Ok), ...SIGNED_IN, ...JSON_BODY },
});

export const ssoMe = defineOperation({
  method: 'get',
  path: '/sso/me',
  tags: ssoTags,
  security: [...PUBLIC],
  summary: 'Who is signed in (read-only: never renews the cookie)',
  description: 'Polled by AccessGuard for "still signed in / still approved".',
  responses: {
    200: jsonResponse(
      'Signed in.',
      z.object({
        user: z.object({ email: s, name: s, avatar: s }),
        exp: n.meta({ description: 'Session expiry, ms since epoch.' }),
        approved: b,
        disabled: b.meta({ description: 'Has a role but the account is INACTIVE / DELETED.' }),
      }),
    ),
    401: signedOut,
    503: dbDown,
  },
});

export const ssoRefresh = defineOperation({
  method: 'get',
  path: '/sso/refresh',
  tags: ssoTags,
  security: [...PUBLIC],
  summary: 'Renew the session: re-read role / status and re-issue the cookie (30-min idle, 12-h cap)',
  description: 'Called after a 401 by src/lib/api.ts, and by /pending to pick up an approval.',
  responses: {
    200: jsonResponse('Renewed.', z.object({ approved: b, role: s, email: s })),
    401: signedOut,
    503: dbDown,
  },
});
