-- 0028_round2_status_name_cs_repair — two data fixes from the 2026-10-15 persona QA (owner decisions).
--
-- a. job_status 16 was named "…พันกำหนดเสนอราคา" (typo of พ้น). Matched on the id AND the old text,
--    so a name an admin already changed is left alone. The app's status lists (src/data/mock.ts
--    JOB_STATUS_OPTIONS / REPAIR_STATUS_OPTIONS) carry the new spelling — they must ship together,
--    the repair screen looks a status up by its name (jobs.ts statusIdByName).
-- b. Customer Service may no longer save the engineer's repair screen: app_config row
--    ('Customer Service', 'Job Repair') → no insert / edit / delete; can_view stays as it is.
--    Only that row (a role or module renamed by an admin is not touched).
--
-- Also documents track_doc_ticket.ua_hash: since round 2 a document link is bound to the tracking
-- session / link that asked for it, not to the browser (src/server/services/tracking.ts issueDocLink).
-- Idempotent: running it again changes nothing.

UPDATE job_status
   SET job_status_name = replace(job_status_name, 'พันกำหนดเสนอราคา', 'พ้นกำหนดเสนอราคา')
 WHERE job_status_id = 16
   AND job_status_name LIKE '%พันกำหนดเสนอราคา%';
--> statement-breakpoint
UPDATE app_config
   SET can_insert = false, can_edit = false, can_delete = false
 WHERE user_type = 'Customer Service'
   AND module_name = 'Job Repair'
   AND (can_insert IS DISTINCT FROM false OR can_edit IS DISTINCT FROM false OR can_delete IS DISTINCT FROM false);
--> statement-breakpoint
COMMENT ON COLUMN track_doc_ticket.ua_hash IS
  'sha256 of the track session token or /track link token the document link is bound to (round 2; was sha256(User-Agent))';
