-- 0034_customer_name_clean_index — name search ignores double spaces / invisible characters, at index speed.
--
-- customerWhere (src/server/services/customers.ts, `nameText`) now matches the typed name against the name as
-- clean() would write it, so ~1,050 legacy names with double spaces or zero-width marks are found (menu
-- coverage audit 2026-10-19). Without this index that is a seq scan of 43k rows (~50–90 ms per search,
-- measured on the dev copy).
-- The expression MUST stay character-for-character identical to `nameText` — including the regex escapes
-- written as backslash-u text (not the characters themselves) — or Postgres will not use the index.
-- Idempotent.

CREATE INDEX IF NOT EXISTS gin_customer_name_clean ON customer USING gin (
  (regexp_replace(regexp_replace(customer_name, '[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]', '', 'g'), '[\s\u00A0]+', ' ', 'g')) gin_trgm_ops
);
