-- 0038_document_profile_one_default — at most one live default document profile, enforced by the database.
--
-- saveDocumentProfile / deleteDocumentProfile (src/server/services/document-profiles.ts) now run one at a time
-- under pg_advisory_xact_lock(hashtext('document_profile')) — two profiles saved as default at once had left two
-- defaults (race audit G5, 2026-10-21). This index is the backstop. The save clears the old default in the
-- statement before it sets the new one, so the immediate (non-deferred) check never sees two.
-- Guarded: data that already has two live defaults (checked: the dev copy has one) skips the index with a
-- NOTICE instead of failing the deploy — fix the data, then re-run. Idempotent.

DO $$ BEGIN
  IF (SELECT count(*) FROM document_profile WHERE is_default AND deleted_at IS NULL) <= 1 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS ux_document_profile_one_default ON document_profile ((true))
      WHERE is_default AND deleted_at IS NULL;
  ELSE
    RAISE NOTICE 'document_profile has more than one live default — ux_document_profile_one_default not created';
  END IF;
END $$;
