-- 0030_special_rights — rules that were hard-coded by role name become "special rights" the business sets
-- itself on the permissions page (section สิทธิ์พิเศษ): one app_config row per (role, right) with a pseudo
-- module name, can_view = has the right (insert / edit / delete unused, false). src/lib/modules.ts RIGHTS.
--
-- Seeded so behaviour is identical after deploy:
--   SO Approve            approve / deny / send back sale orders      Manager (System Admin always)
--   Job Take              takes jobs, offered as assignee              Engineer, Head Engineer (admin only if ticked)
--   Overdue All           a job taker's overdue bell shows everyone's  Head Engineer (an Engineer sees own jobs)
--   Job Reopen            re-open a closed job                         nobody (System Admin always)
--   Job Money After Close edit money on a closed job                   nobody (System Admin always)
--   Product Cost          sees ราคาทุน                                 every role that may edit products (Product edit)
--   Report                the report pages                             nobody (System Admin always)
--   Export                ส่งออก Excel (on top of the list's own view)  every role in app_config / app_user
--
-- Insert-if-missing only: a row that exists is never changed — a right the business removed stays removed
-- when this runs again (legacy reload). Idempotent: running it again changes nothing.

INSERT INTO app_config (user_type, module_name, can_insert, can_edit, can_delete, can_view)
SELECT DISTINCT r.t, r.m, false, false, false, true
  FROM (
        SELECT 'Manager' AS t, 'SO Approve' AS m
        UNION ALL SELECT 'Engineer', 'Job Take'
        UNION ALL SELECT 'Head Engineer', 'Job Take'
        UNION ALL SELECT 'Head Engineer', 'Overdue All'
        UNION ALL SELECT trim(user_type), 'Product Cost' FROM app_config
                   WHERE module_name = 'Product' AND can_edit IS TRUE
        UNION ALL SELECT trim(user_type), 'Export' FROM app_config WHERE module_name <> 'Export'
        UNION ALL SELECT trim(user_type), 'Export' FROM app_user
       ) r
 WHERE coalesce(r.t, '') <> ''
ON CONFLICT (user_type, module_name) DO NOTHING;
