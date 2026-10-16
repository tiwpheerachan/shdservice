import { z } from 'zod';

/** Pieces every declaration shares: the error body, the responses of the session gate, paging. */

/** Every error of a handle() route (src/server/auth.ts) — HttpError, a Postgres error, or the opaque 500. */
export const ErrorBody = z
  .object({
    error: z.string().meta({
      example: 'กรอกข้อมูลไม่ครบ 2 ช่อง',
      description: 'Thai, for the user (the pages show it as is). Its wording is not a contract.',
    }),
    details: z
      .object({
        fields: z
          .record(z.string(), z.string())
          .optional()
          .meta({
            example: { phone: 'ต้องระบุเบอร์โทรศัพท์' },
            description: 'A 400 from a form rule (src/lib/validation): the message per field, keyed as sent.',
          }),
        stale: z
          .literal(true)
          .optional()
          .meta({ description: '409: the `version` sent is not the stored row_version — reload, then save again.' }),
        retryAfter: z.number().int().optional().meta({ description: '429: seconds until the window turns over.' }),
        conflicts: z
          .array(
            z.object({
              field: z.enum(['phone', 'email', 'taxId']),
              value: z.string(),
              code: z.string(),
              name: z.string(),
              phone: z.string(),
              email: z.string(),
              taxId: z.string(),
            }),
          )
          .optional()
          .meta({ description: '409 on a customer save: the existing customers holding that phone / email / tax id.' }),
      })
      .optional(),
    ref: z.string().optional().meta({
      description: 'Only on an unexpected 500 / 503: the reference to quote — the details are in the server log.',
    }),
  })
  .meta({ id: 'Error' });

export const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorBody } },
});

export const jsonResponse = (description: string, schema: z.ZodType) => ({
  description,
  content: { 'application/json': { schema } },
});

/** `{ ok: true }` — what most writes answer with nothing else to say. */
export const Ok = z.object({ ok: z.literal(true) });

/** A redirect, no body. */
export const redirect = (description: string) => ({
  description,
  headers: { Location: { schema: { type: 'string' as const }, description: 'Where to go.' } },
});

/**
 * The gate of every staff operation (requireUser / requireCan / requireView / requireAdmin):
 * no session, a session the user row no longer backs, not allowed, or a database that did not answer.
 */
export const SIGNED_IN = {
  401: errorResponse('No session cookie, or one that expired / was signed out elsewhere — `{"error":"unauthorized"}`.'),
  403: errorResponse(
    'Signed in but not approved (รอการอนุมัติสิทธิ์การใช้งาน), disabled, or the role lacks this module / action / special right.',
  ),
  503: errorResponse(
    'The database did not answer, or the query ran too long (`57014`) — retry; narrow the range for a report.',
  ),
};

/** What reading a JSON body can refuse (readJson): not JSON, too big, broken. */
export const JSON_BODY = {
  400: errorResponse(
    'Invalid input: `invalid_json`, or a form rule failed — `error` = "กรอกข้อมูลไม่ครบ N ช่อง" and `details.fields` = { field: message }.',
  ),
  413: errorResponse('Body over 1 MB.'),
  415: errorResponse('`Content-Type` is not `application/json` (the CSRF rule: no form posts).'),
};

/** A write that can race: a stale `version`, a duplicate, or a deadlock with another save. */
export const CONFLICT = {
  409: errorResponse(
    'Conflict: `details.stale` = someone saved this record after you loaded it (row_version); otherwise a duplicate value, a state that no longer allows this, or a concurrent save — reload and retry.',
  ),
};

/** Operations behind src/server/rate-limit.ts. */
export const RATE_LIMITED = {
  429: errorResponse('Too many calls from this user in the window — `details.retryAfter` seconds to wait.'),
};

export const notFound = (what: string) => ({ 404: errorResponse(what) });

/** Create POSTs that take an Idempotency-Key (src/server/idempotency.ts reads it with `headers` below). */
export const IDEMPOTENCY = {
  headers: z.object({
    'Idempotency-Key': z.string().trim().max(100, 'Idempotency-Key ยาวเกินไป').optional().meta({
      description:
        'One key per logical submit (src/lib/api.ts postJson sends one), at most 100 characters. A repeat gets the stored answer with `Idempotent-Replayed: true` instead of a second document; a repeat while the first still runs → 409. Empty = none.',
    }),
  }),
  invalid: { headers: 400 } as const,
  responses: {
    ...CONFLICT,
    422: errorResponse('The Idempotency-Key was already used for a different route.'),
  },
};

/** `?paged=1` answers: one page of rows plus the count (src/server/paging.ts Page). */
export const page = <T extends z.ZodType>(row: T) =>
  z.object({
    rows: z.array(row),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });

/** Path parameter `{no}`: a document number, as typed (the route upper-cases / decodes it). */
export const byNo = (description: string) => z.object({ no: z.string().meta({ description }) });

export const UiStatus = z.enum(['Active', 'Inactive', 'Cancel']);

/*
 * Input the routes have always read leniently: a value outside the choices is read as left out
 * (the route's default applies), never refused. Documented as the choices.
 */

/** one of `values`; anything else → `fallback` (default: as if left out) */
export const choice = <const T extends readonly [string, ...string[]]>(values: T, fallback?: T[number]) =>
  z
    .enum(values)
    .optional()
    .catch(fallback)
    .meta({ type: 'string', enum: [...values] });

/** `true` / `false`; anything else → as if left out */
export const flag = z.boolean().optional().catch(undefined).meta({ type: 'boolean' });

/** row_version the edit form loaded (a number; a numeric string is read as one) — 409 `stale` if it moved */
export const version = z
  .union([z.number(), z.string()])
  .nullish()
  .meta({ description: 'row_version the form loaded (an edit) — 409 `stale` if it moved since; left out = no check.' });
