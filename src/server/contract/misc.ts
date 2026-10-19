import { z } from 'zod';
import { RATE_LIMITED, SIGNED_IN, choice, errorResponse, jsonResponse, notFound, redirect } from './common';
import { defineOperation, type Operation } from './registry';

/** Lookups, files, uploads, health, sign-in (SSO) and this document itself. */

const s = z.string();
const n = z.number();
const b = z.boolean();
const PUBLIC = [] as const;

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
    city: s.optional().meta({ description: 'province id (level=district)' }),
    district: s.optional().meta({ description: 'district id (level=subdistrict)' }),
  }),
  responses: {
    200: jsonResponse(
      '`postal` only on sub-districts.',
      z.object({ rows: z.array(z.object({ id: n, name: s, postal: s.optional() })) }),
    ),
    ...SIGNED_IN,
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
  summary: 'Open a stored file by its storage path (a short-lived signed URL)',
  description:
    'Only the folders the app writes can be signed. `shippers/{id}/…` and `profiles/{id}/…` (logos on the public tracking page and customer documents) are public, 120 a minute per IP; jobs / sale-orders / products need a signed-in user who may view that screen (jobs: any job module; sale-orders: Sale Order or Product Pick Stock; products: any product / stock module) — else 403.',
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
  }),
  invalid: { query: 400 },
  responses: {
    307: redirect('To the signed URL (cacheable while it is valid).'),
    400: errorResponse('No / bad path.'),
    ...SIGNED_IN,
    ...notFound('Not a folder the app writes, or no such file (or still on the old system).'),
    ...RATE_LIMITED,
  },
});

export const upload = defineOperation({
  method: 'post',
  path: '/upload',
  tags: ['Files'],
  summary: 'Upload a product image, a payment slip or a profile logo',
  description:
    "The permission follows `kind`: product-image → Product edit; sale-order-slip → Sale Order edit (an approved / denied / cancelled order's slip is final; a waiting one is its creator's); job-slip → Job Closing edit (a cancelled job's slip is refused; a closed job's needs Job Money After Close, and its previous slip is kept); profile-logo / shipper-logo → System Admin. Photos are resized server-side; replacing a file removes the previous one.",
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
      .transform((v) =>
        String(v ?? '')
          .trim()
          .toUpperCase(),
      )
      .pipe(z.string().min(1, 'id required'))
      .meta({ type: 'string', description: 'product code / sale order no / job no / profile id' }),
  }),
  invalid: { form: 400 },
  responses: {
    200: jsonResponse(
      'Stored.',
      z.object({ ok: z.literal(true), path: s.meta({ description: 'storage path (open with GET /files)' }), file: s }),
    ),
    ...SIGNED_IN,
    400: errorResponse('Not multipart, no file / id, or an unknown kind.'),
    ...notFound('No such product / order / job / profile.'),
    409: errorResponse(
      'The sale order is approved, denied or cancelled, or the job is cancelled / closed (without Job Money After Close) — its slip cannot change.',
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
