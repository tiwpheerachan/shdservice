-- forensic-check.sql — read-only checks after the 2026-09-18 suspension.
-- Run in Supabase Dashboard → SQL Editor (one block at a time). Nothing here writes.
-- Adjust the date window if needed (incident: 2026-09-17 .. 2026-09-19).

-- 1. Could anyone read tables through PostgREST with the PUBLIC publishable key?
--    (the key is in render.yaml / git history — it is only safe if RLS blocks anon)
--    no_rls > 0  ⇒  those tables are fully readable by anyone holding the key
--    unless the `public` schema is NOT exposed (Settings → API → Exposed schemas).
select count(*) filter (where not rowsecurity) as no_rls,
       count(*) filter (where rowsecurity)     as rls_on,
       count(*)                                as total
from pg_tables where schemaname = 'public';

select tablename from pg_tables
where schemaname = 'public' and not rowsecurity order by 1;

-- 2. What can the PostgREST roles do on public tables?
select grantee, privilege_type, count(*) as tables
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','authenticated')
group by 1,2 order by 1,2;

-- 3. App logins per day (audit_log, action LOGIN)
select date(at) as d, count(*) as logins, count(distinct user_id) as users
from audit_log where action = 'LOGIN' and at > now() - interval '14 days'
group by 1 order by 1;

-- 4. Who logged in around the incident
select user_name, user_id, count(*) as n, min(at) as first_at, max(at) as last_at
from audit_log
where action = 'LOGIN' and at between '2026-09-16' and '2026-09-20'
group by 1,2 order by 3 desc;

-- 5. Users the SSO auto-provisioned or that changed around then
--    (any company Google account that reached the SSO gets a "pending" row —
--    unknown names here = people who tried to get in)
select user_id, email_address, user_type, record_status, last_login, status_changed_at
from app_user
where last_login        between '2026-09-15' and '2026-09-21'
   or status_changed_at between '2026-09-15' and '2026-09-21'
order by last_login desc nulls last;

-- 6. All app writes around the incident (reads/exports are NOT audited)
select date(at) as d, action, module, count(*) as n
from audit_log where at between '2026-09-16' and '2026-09-21'
group by 1,2,3 order by 1,2,3;

-- 7. Postgres query statistics since the last reset — big "rows" on customer /
--    job / product with few calls = someone pulled whole tables
select stats_reset from pg_stat_statements_info;

select left(regexp_replace(query, '\s+', ' ', 'g'), 120) as query,
       calls, rows, round(total_exec_time::numeric) as total_ms
from pg_stat_statements
where rows > 10000
order by rows desc limit 30;

-- 8. Login-capable DB roles — anything you don't recognise is a red flag
select rolname, rolsuper, rolcreaterole, rolvaliduntil
from pg_roles where rolcanlogin order by 1;

-- 9. Who is connected right now (application_name / client_addr you don't expect?)
select usename, application_name, client_addr, count(*)
from pg_stat_activity where datname = current_database()
group by 1,2,3 order by 4 desc;

-- 10. Storage: objects touched around the incident (uploads / overwrites)
select bucket_id, count(*) as objects, min(created_at), max(updated_at)
from storage.objects
where created_at between '2026-09-15' and '2026-09-21'
   or updated_at between '2026-09-15' and '2026-09-21'
group by 1;
