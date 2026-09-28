import { bigserial, customType, index, inet, integer, pgTable, primaryKey, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Public tracking security tables (drizzle/0014, 0017, 0019 — hand-written migrations, RLS on,
 * no policies: only the app role can touch them). Raw tokens / phones / IPs are never stored:
 * sha256 or HMAC only (server/track-guard.ts, server/track-otp.ts).
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** one-time ticket: /track/<token> → PublicJob (3 min, bound to IP + UA) */
export const trackTicket = pgTable(
  "track_ticket",
  {
    tokenHash: bytea("token_hash").primaryKey(),
    jobNo: varchar("job_no", { length: 20 }).notNull(),
    issuedIp: inet("issued_ip").notNull(),
    uaHash: bytea("ua_hash").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
    expiresAt: at("expires_at").notNull(),
  },
  (t) => [index("ix_track_ticket_expires").on(t.expiresAt)]
);

/** fixed-window rate-limit counters */
export const trackRate = pgTable(
  "track_rate",
  {
    bucket: varchar("bucket", { length: 40 }).notNull(),
    key: varchar("key", { length: 128 }).notNull(),
    windowStart: at("window_start").notNull(),
    hits: integer("hits").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.key, t.windowStart] }), index("ix_track_rate_window").on(t.windowStart)]
);

export const trackBlock = pgTable("track_block", {
  key: varchar("key", { length: 160 }).primaryKey(),
  blockedUntil: at("blocked_until").notNull(),
});

/** security event log (30 days) */
export const trackEvent = pgTable(
  "track_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: at("at").notNull().defaultNow(),
    event: varchar("event", { length: 40 }).notNull(),
    result: varchar("result", { length: 20 }).notNull().default(""),
    ipHash: varchar("ip_hash", { length: 64 }),
    linkHash: varchar("link_hash", { length: 64 }),
    jobNo: varchar("job_no", { length: 20 }),
    requestId: varchar("request_id", { length: 40 }),
  },
  (t) => [index("ix_track_event_at").on(t.at)]
);

/** phone OTP (5 min, 5 tries) */
export const trackOtp = pgTable(
  "track_otp",
  {
    requestHash: bytea("request_hash").primaryKey(),
    phoneHash: varchar("phone_hash", { length: 64 }).notNull(),
    customerIds: integer("customer_ids").array().notNull(),
    codeHash: bytea("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    issuedIp: inet("issued_ip").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
    expiresAt: at("expires_at").notNull(),
    consumedAt: at("consumed_at"),
  },
  (t) => [index("ix_track_otp_expires").on(t.expiresAt), index("ix_track_otp_phone").on(t.phoneHash)]
);

/** customer session after the OTP (15 min, +5 while active, 60 min cap) */
export const trackSession = pgTable(
  "track_session",
  {
    tokenHash: bytea("token_hash").primaryKey(),
    customerIds: integer("customer_ids").array().notNull(),
    phoneHash: varchar("phone_hash", { length: 64 }).notNull(),
    issuedIp: inet("issued_ip").notNull(),
    uaHash: bytea("ua_hash").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
    expiresAt: at("expires_at").notNull(),
    maxExpiresAt: at("max_expires_at").notNull(),
  },
  (t) => [index("ix_track_session_expires").on(t.expiresAt)]
);

/** one-time document ticket (60 s, bound to IP + UA) */
export const trackDocTicket = pgTable(
  "track_doc_ticket",
  {
    tokenHash: bytea("token_hash").primaryKey(),
    jobNo: varchar("job_no", { length: 50 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    ref: varchar("ref", { length: 50 }).notNull(),
    issuedIp: inet("issued_ip").notNull(),
    uaHash: bytea("ua_hash").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
    expiresAt: at("expires_at").notNull(),
  },
  (t) => [index("ix_track_doc_ticket_expires").on(t.expiresAt)]
);
