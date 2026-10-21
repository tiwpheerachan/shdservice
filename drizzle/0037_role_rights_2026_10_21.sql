-- 0037_role_rights_2026_10_21 — owner decisions after the multi-user QA round (2026-10-21):
--   ลบลูกค้า           Customer Service + Manager only — Head Engineer loses Customer delete
--   Manager            Quotation view / add / edit (no delete) — oversees prices, had no quotation right at all
--   Salesman           Sale Order view / add / edit (no delete; approval stays with SO Approve) + Customer view /
--                      add (pick or add the order's customer) — could be named พนักงานขาย but do nothing
-- The grants: a missing row is inserted, and a row that grants nothing (the legacy data has Salesman rows with
-- every box off) gets them; a row that already grants something was set by the business and is left alone. The
-- Head Engineer delete is switched off where it is on. Idempotent: running it again changes nothing more.

UPDATE app_config SET can_delete = false
 WHERE trim(user_type) = 'Head Engineer' AND module_name = 'Customer' AND can_delete;

WITH g(t, m, i, e) AS (VALUES ('Manager', 'Quotation', true, true),
                             ('Salesman', 'Sale Order', true, true),
                             ('Salesman', 'Customer', true, false))
UPDATE app_config c SET can_view = true, can_insert = g.i, can_edit = g.e
  FROM g
 WHERE trim(c.user_type) = g.t AND c.module_name = g.m
   AND NOT (coalesce(c.can_view, false) OR coalesce(c.can_insert, false) OR coalesce(c.can_edit, false)
            OR coalesce(c.can_delete, false));

INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view)
SELECT v.t, v.m, v.i, v.e, false, true
  FROM (VALUES ('Manager', 'Quotation', true, true),
               ('Salesman', 'Sale Order', true, true),
               ('Salesman', 'Customer', true, false)) v(t, m, i, e)
 WHERE EXISTS (SELECT 1 FROM app_config r WHERE trim(r.user_type) = v.t)
   AND NOT EXISTS (SELECT 1 FROM app_config c WHERE trim(c.user_type) = v.t AND c.module_name = v.m);
