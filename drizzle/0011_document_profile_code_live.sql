-- 0011_document_profile_code_live — a deleted profile (0009 soft delete) must not
-- block its code from being reused: uniqueness of `code` applies to live rows only.
-- Idempotent.
ALTER TABLE document_profile DROP CONSTRAINT IF EXISTS document_profile_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_document_profile_code_live
  ON document_profile (code) WHERE deleted_at IS NULL;
