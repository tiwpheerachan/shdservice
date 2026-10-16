import { z } from 'zod';
import { jsonResponse } from './common';
import { defineOperation } from './registry';
import { PublicJob, PublicJobSummary } from './shapes';

/**
 * Public customer tracking (/track) — no session cookie. Two ways in: the staff-sent link
 * (/track/<token> → Turnstile → a one-time ticket) and phone + SMS OTP (→ a session token sent
 * back as `x-track-session`). Fail-closed (adr/0004): every failure reads the same, and the
 * answers are never cached. Bodies over 8 KB or not a JSON object read as `{}`, and a field that is
 * not a string reads as none — never a 400: a wrong input gets the same answer as a wrong value.
 */

const s = z.string();
const n = z.number();
const tags = ['Public tracking'];
const PUBLIC: [] = [];

const TrackError = z
  .object({
    ok: z.literal(false),
    error: s.meta({ description: 'Thai, for the customer.' }),
    reason: z
      .enum(['link', 'session', 'captcha'])
      .optional()
      .meta({ description: '`link` = ask for a new link; `session` = verify the phone again.' }),
    retry: z.literal(true).optional(),
  })
  .meta({ id: 'TrackError' });
const fail = (description: string) => jsonResponse(description, TrackError);
const limited = fail('Rate limited (per IP / link / number) — `Retry-After` on most.');
const broken = fail('Unexpected error — the same message as the ordinary failure.');
/** a text field as the routes read it: a string, cut at `max`; anything else as "" */
const text = (max: number) =>
  z
    .unknown()
    .optional()
    .transform((v) => (typeof v === 'string' ? v.slice(0, max) : ''))
    .meta({ type: 'string', description: `Read up to ${max} characters (the rest is ignored).` });
/** a field handed on as sent — the service checks it, and anything but its own shape is a plain failure */
const opaque = (description?: string) => z.unknown().optional().meta({ type: 'string', description });

const session = z.object({
  'x-track-session': s.optional().meta({ description: 'The token from POST /track/otp/verify.' }),
});

export const trackSession = defineOperation({
  method: 'post',
  path: '/track/session',
  tags,
  security: PUBLIC,
  summary: 'Staff-sent link: Turnstile, then a one-time ticket for the job',
  description:
    "Rate limits first, then Siteverify, and only then the database. The customer's first open starts the link's 15-minute window (a signed-in staff member viewing it does not).",
  body: z.object({ linkToken: text(128), turnstileToken: text(4096) }),
  responses: {
    200: jsonResponse(
      'A ticket for POST /track/data (3 minutes, this IP and browser) and when the link expires.',
      z.object({ ok: z.literal(true), ticket: s, expiresAt: s.nullable() }),
    ),
    403: fail('Captcha failed, or no link token.'),
    410: fail('The link expired, was replaced, or never existed (`reason: "link"`).'),
    429: limited,
    503: fail('Turnstile could not be reached.'),
  },
});

export const trackData = defineOperation({
  method: 'post',
  path: '/track/data',
  tags,
  security: PUBLIC,
  summary: 'Trade a ticket for the job (once)',
  description:
    'The ticket is the only input — any job number in the body is ignored. 5 bad tickets in 10 minutes block the IP for 15.',
  body: z.object({ ticket: opaque('From POST /track/session.') }),
  responses: {
    200: jsonResponse('The job, masked.', z.object({ ok: z.literal(true), job: PublicJob })),
    401: fail('Ticket unknown, used, expired, or from another IP / browser (`retry: true`).'),
    429: limited,
  },
});

export const trackDoc = defineOperation({
  method: 'post',
  path: '/track/doc',
  tags,
  security: PUBLIC,
  summary: 'A 10-minute link to one document of the job (ใบรับงาน / ใบเสนอราคา / ใบส่งคืน)',
  description:
    "Authorised by `x-track-session` (the job must be that customer's) or by `linkToken` (the job of that live link). The URL carries no job number or token.",
  headers: session,
  body: z.object({
    kind: z
      .unknown()
      .optional()
      .meta({ type: 'string', enum: ['job', 'quotation', 'return'] }),
    ref: opaque('job no, or the quotation no'),
    jobNo: text(50).meta({ description: 'With x-track-session. Read up to 50 characters.' }),
    linkToken: text(128).meta({ description: 'Without a session. Read up to 128 characters.' }),
  }),
  responses: {
    200: jsonResponse('Open this URL.', z.object({ ok: z.literal(true), url: s.meta({ example: '/track/doc/…' }) })),
    401: fail('The session expired (`reason: "session"`).'),
    404: fail('Not yours, does not exist, or not issued to customers — all the same.'),
    410: fail('The link expired (`reason: "link"`).'),
    429: limited,
    500: broken,
  },
});

export const trackLinkKeepalive = defineOperation({
  method: 'post',
  path: '/track/link/keepalive',
  tags,
  security: PUBLIC,
  summary: 'Keep an opened link alive while the customer uses it',
  description: '≥ 5 minutes on the clock, never past 60 minutes from the first open; never reopens an expired link.',
  body: z.object({ linkToken: text(128) }),
  responses: {
    200: jsonResponse('New expiry.', z.object({ ok: z.literal(true), expiresAt: s })),
    410: fail('The link is no longer live.'),
    429: limited,
    500: broken,
  },
});

const sessionExpiry = { expiresAt: s, maxExpiresAt: s };

export const trackMe = defineOperation({
  method: 'get',
  path: '/track/me',
  tags,
  security: PUBLIC,
  summary: "The signed-in customer's jobs (counts as activity: +5 minutes)",
  headers: session,
  responses: {
    200: jsonResponse(
      'Open and past jobs.',
      z.object({
        ok: z.literal(true),
        active: z.array(PublicJobSummary),
        history: z.array(PublicJobSummary),
        ...sessionExpiry,
      }),
    ),
    401: fail('No / expired session (`reason: "session"`).'),
    429: limited,
    500: broken,
  },
});

export const trackSignOut = defineOperation({
  method: 'delete',
  path: '/track/me',
  tags,
  security: PUBLIC,
  summary: 'Sign the customer out (the token dies now)',
  headers: session,
  responses: { 200: jsonResponse('Always.', z.object({ ok: z.literal(true) })) },
});

export const trackMeKeepalive = defineOperation({
  method: 'post',
  path: '/track/me/keepalive',
  tags,
  security: PUBLIC,
  summary: "Keep the customer's session alive while they use the page",
  description: '≥ 5 minutes on the clock, never past 60 minutes from sign-in.',
  headers: session,
  responses: {
    200: jsonResponse('New expiry.', z.object({ ok: z.literal(true), ...sessionExpiry })),
    401: fail('No / expired session.'),
    429: limited,
  },
});

export const trackMeJob = defineOperation({
  method: 'get',
  path: '/track/me/jobs/{no}',
  tags,
  security: PUBLIC,
  summary: "One of the signed-in customer's jobs",
  headers: session,
  params: z.object({ no: s.meta({ description: 'หมายเลขงาน' }) }),
  responses: {
    200: jsonResponse('The job, masked.', z.object({ ok: z.literal(true), job: PublicJob, expiresAt: s })),
    401: fail('No / expired session.'),
    404: fail("Not this customer's job, or no such job — the same answer."),
    429: limited,
    500: broken,
  },
});

export const trackOtpRequest = defineOperation({
  method: 'post',
  path: '/track/otp/request',
  tags,
  security: PUBLIC,
  summary: 'Send an SMS code to a phone number (after Turnstile)',
  description:
    "The same answer for every well-formed number, a customer's or not — SMS go out only to customer numbers. Per IP 5/min, 20/hour; per number 1/min, 3/hour.",
  body: z.object({ phone: text(32), turnstileToken: text(4096) }),
  responses: {
    200: jsonResponse(
      'Sent (or would have been).',
      z.object({
        ok: z.literal(true),
        requestId: s,
        masked: s.meta({ example: '081-xxx-5678' }),
        expiresIn: n.meta({ description: 'seconds' }),
        resendIn: n.meta({ description: 'seconds' }),
      }),
    ),
    400: fail('Not a 10-digit mobile number.'),
    403: fail('Captcha failed (`reason: "captcha"`).'),
    429: limited,
    500: broken,
    503: fail('The OTP service is not configured, or Turnstile could not be reached.'),
  },
});

export const trackOtpVerify = defineOperation({
  method: 'post',
  path: '/track/otp/verify',
  tags,
  security: PUBLIC,
  summary: 'Check the SMS code → a customer session token',
  description: 'Wrong, expired, used, or too many tries all read the same. Keep the token in page memory only.',
  body: z.object({
    requestId: opaque('From POST /track/otp/request.'),
    code: z
      .unknown()
      .optional()
      .transform((v) => (typeof v === 'string' ? v.trim() : v))
      .meta({ type: 'string', description: 'The SMS code.' }),
  }),
  responses: {
    200: jsonResponse('Signed in.', z.object({ ok: z.literal(true), session: s, expiresAt: s })),
    401: fail('Wrong / expired code.'),
    429: limited,
    500: broken,
  },
});
