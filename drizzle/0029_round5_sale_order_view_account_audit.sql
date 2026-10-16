-- 0029_round5_sale_order_view_account_audit — owner decision (2026-10-15 persona QA, round 5):
-- Account and Audit may OPEN sale orders (the list + the edit page, read-only) but not change them.
--
-- app_config ('Account', 'Sale Order') / ('Audit', 'Sale Order') → can_view = true. A missing row is
-- inserted view-only (insert / edit / delete false); an existing row only gets can_view turned on — a
-- grant an admin already gave (insert / edit / delete) is never taken away. The pages lock themselves
-- read-only for a role without edit (the DOM lock); every write API still checks its own grant.
-- Idempotent: running it again changes nothing.

INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view)
VALUES ('Account', 'Sale Order', false, false, false, true),
       ('Audit', 'Sale Order', false, false, false, true)
ON CONFLICT (user_type, module_name) DO UPDATE
   SET can_view = true
 WHERE app_config.can_view IS DISTINCT FROM true;
