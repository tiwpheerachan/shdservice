import { customType, index, inet, integer, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { pkCol, pkRef, uuidId } from './id';

/**
 * Public tracking security tables (hand-written migrations, RLS on,
 * no policies: only the app role can touch them). Raw tokens / phones are never stored: sha256 or
 * HMAC only (server/track-guard.ts, server/track-otp.ts). Keys, counters and logs hold IPs as HMACs too.
 * The raw IP is kept in one place: issued_ip (inet) on the short-lived rows — track_ticket (3 min) and
 * track_session (≤ 60 min) are bound to it, track_otp (5 min) and track_doc_ticket (10 min) record it —
 * and it goes with the row: expired tickets / doc tickets on the next issue, sessions past their 60 min
 * on the next sign-in, OTPs a day after they expire (track-guard housekeeping).
 * Every table has `pk` (identity) + `id`; the natural keys are UNIQUE.
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** one-time ticket: /track/<token> → PublicJob (3 min, bound to IP + UA) */
export const trackTicket = pgTable(
  'track_ticket',
  {
    pk: pkCol(),
    id: uuidId(),
    tokenHash: bytea('token_hash').notNull(),
    jobPk: pkRef('job_pk').notNull(),
    issuedIp: inet('issued_ip').notNull(),
    uaHash: bytea('ua_hash').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
    expiresAt: at('expires_at').notNull(),
  },
  (t) => [uniqueIndex('ux_track_ticket_token_hash').on(t.tokenHash), index('ix_track_ticket_expires').on(t.expiresAt)],
);

/** fixed-window rate-limit counters */
export const trackRate = pgTable(
  'track_rate',
  {
    pk: pkCol(),
    id: uuidId(),
    bucket: varchar('bucket', { length: 40 }).notNull(),
    key: varchar('key', { length: 128 }).notNull(),
    windowStart: at('window_start').notNull(),
    hits: integer('hits').notNull().default(0),
  },
  (t) => [
    uniqueIndex('ux_track_rate_bucket_key_window_start').on(t.bucket, t.key, t.windowStart),
    index('ix_track_rate_window').on(t.windowStart),
  ],
);

export const trackBlock = pgTable(
  'track_block',
  {
    pk: pkCol(),
    id: uuidId(),
    key: varchar('key', { length: 160 }).notNull(),
    blockedUntil: at('blocked_until').notNull(),
  },
  (t) => [uniqueIndex('ux_track_block_key').on(t.key)],
);

/** security event log (30 days) */
export const trackEvent = pgTable(
  'track_event',
  {
    pk: pkCol(),
    id: uuidId(),
    at: at('at').notNull().defaultNow(),
    event: varchar('event', { length: 40 }).notNull(),
    result: varchar('result', { length: 20 }).notNull().default(''),
    ipHash: varchar('ip_hash', { length: 64 }),
    linkHash: varchar('link_hash', { length: 64 }),
    /** what the public typed — text on purpose, not a relation (ADR 0008 decision 11) */
    jobNo: varchar('job_no', { length: 20 }),
    requestId: varchar('request_id', { length: 40 }),
  },
  (t) => [index('ix_track_event_at').on(t.at)],
);

/** phone OTP (5 min, 5 tries) */
export const trackOtp = pgTable(
  'track_otp',
  {
    pk: pkCol(),
    id: uuidId(),
    requestHash: bytea('request_hash').notNull(),
    phoneHash: varchar('phone_hash', { length: 64 }).notNull(),
    customerPks: pkRef('customer_pks').array().notNull(),
    /** development `log` mode only — our own code, HMAC'd */
    codeHash: bytea('code_hash'),
    attempts: integer('attempts').notNull().default(0),
    issuedIp: inet('issued_ip').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
    expiresAt: at('expires_at').notNull(),
    consumedAt: at('consumed_at'),
    /** ThaiBulkSMS OTP service: its token for this request — checked together with the code */
    providerToken: varchar('provider_token', { length: 128 }),
  },
  (t) => [
    uniqueIndex('ux_track_otp_request_hash').on(t.requestHash),
    index('ix_track_otp_expires').on(t.expiresAt),
    index('ix_track_otp_phone').on(t.phoneHash),
  ],
);

/** customer session after the OTP (15 min, +5 while active, 60 min cap) */
export const trackSession = pgTable(
  'track_session',
  {
    pk: pkCol(),
    id: uuidId(),
    tokenHash: bytea('token_hash').notNull(),
    customerPks: pkRef('customer_pks').array().notNull(),
    phoneHash: varchar('phone_hash', { length: 64 }).notNull(),
    issuedIp: inet('issued_ip').notNull(),
    uaHash: bytea('ua_hash').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
    expiresAt: at('expires_at').notNull(),
    maxExpiresAt: at('max_expires_at').notNull(),
  },
  (t) => [
    uniqueIndex('ux_track_session_token_hash').on(t.tokenHash),
    index('ix_track_session_expires').on(t.maxExpiresAt) /* the purge: max_expires_at < now() */,
  ],
);

/** document link (10 min — DOC_LINK_MINUTES; bound to the session / link it was issued under, services/tracking.ts) */
export const trackDocTicket = pgTable(
  'track_doc_ticket',
  {
    pk: pkCol(),
    id: uuidId(),
    tokenHash: bytea('token_hash').notNull(),
    jobPk: pkRef('job_pk').notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    /** the document (ADR 0008 decision 11): kind 'quotation' → quotation_hd_pk; 'job' / 'return' = the job itself */
    quotationPk: pkRef('quotation_pk'),
    saleOrderPk: pkRef('sale_order_pk'),
    issuedIp: inet('issued_ip').notNull(),
    uaHash: bytea('ua_hash').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
    expiresAt: at('expires_at').notNull(),
  },
  (t) => [
    uniqueIndex('ux_track_doc_ticket_token_hash').on(t.tokenHash),
    index('ix_track_doc_ticket_expires').on(t.expiresAt),
  ],
);
