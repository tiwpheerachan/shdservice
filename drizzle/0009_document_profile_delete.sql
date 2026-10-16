-- 0009_document_profile_delete — soft delete for โปรไฟล์ผู้ออกเอกสาร.
-- A deleted profile disappears from the admin page and every "ออกเอกสารในนาม"
-- dropdown, but the row stays: documents issued under it keep printing with its
-- logo / address / tax id, and its prefixes stay reserved (numbers already exist).
-- Restore = SQL (UPDATE document_profile SET deleted_at = NULL WHERE id = …). Idempotent.
ALTER TABLE document_profile ADD COLUMN IF NOT EXISTS deleted_at timestamp;
ALTER TABLE document_profile ADD COLUMN IF NOT EXISTS deleted_by integer;
