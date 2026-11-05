-- 0002_legacy_cleanup — legacy data the QA of the 27/10/2026 dump found (decided 2026-10-28). Idempotent.
--
-- 1. app_user.password: 109 rows hold the legacy system's plain-text passwords. The app signs in through SSO only and
--    never reads them → cleared. NULL, not '': ix_username_and_password is unique on (username, password) and two
--    legacy rows share the username "Ploiprakai" (NULLs never collide).
-- 2. ไปรษณีย์ไทย's alias "Thailand" (0001) is too loose for a courier name → removed.
-- 3. The same person twice: a legacy row (old username, no e-mail, often another role — bell = System Admin while
--    belle.kridsawan is Customer Service) and the row they sign in with through SSO. The legacy row goes INACTIVE: its
--    old jobs keep showing its name, it leaves the staff pickers and can never be signed in to. vulkan (id 44) is a
--    System Admin holding may.pradit.s@shd-technology.co.th while she signs in as may.pradit.s@shd-company.com
--    (Customer Service) → INACTIVE, so that address cannot reach System Admin. The pairs are listed, not guessed from
--    names: legacy user_id + username are the same in every dump. A function, because the SSO rows of a reload
--    arrive with the seed after this migration — seed.sql calls it again (scripts/seed-export.mts).

UPDATE app_user SET password = NULL WHERE password IS NOT NULL;

UPDATE shipping_profile
   SET aliases = array_to_string(ARRAY(SELECT btrim(a) FROM unnest(string_to_array(aliases, ',')) a
                                        WHERE lower(btrim(a)) <> 'thailand'), ', ')
 WHERE code = 'THP' AND aliases ~* '(^|,)\s*thailand\s*(,|$)';

CREATE OR REPLACE FUNCTION merge_legacy_users() RETURNS integer LANGUAGE sql AS $$
  WITH pair(legacy_id, legacy_username, sso_email) AS (VALUES
    (105, 'bell',       'belle.kridsawan@rabbitthailand.co.th'),
    (12,  'birx1122',   'bird.soksit@shd-technology.co.th'),
    (8,   'Bonus',      'bonut.nuttaphong@shd-technology.co.th'),
    (34,  'Varintorn',  'fonn.varintorn@shd-technology.co.th'),
    (11,  'mayme',      'maymay.naphatsawan@shd-technology.co.th'),
    (13,  'kkn.29',     'nok.kanokon@shd-technology.co.th'),
    (46,  'kanya',      'noon.kanya@shd-technology.co.th'),
    (14,  'Siriporn20', 'baitoey.siriporn@shd-technology.co.th'),
    (102, 'tonton',     'ton.mongkolchai@rabbitthailand.co.th'),
    (45,  'Areeya',     'yean.areeya@shd-technology.co.th'),
    (109, 'Ying',       'ying.thanyakarn@rabbitthailand.co.th'),
    (63,  'Titima',     'yui.thitima@shd-technology.co.th'),
    (93,  'Dream1',     'dream.daranee@rabbitthailand.co.th'),
    (44,  'vulkan',     'may.pradit.s@shd-company.com')
  ), done AS (
    UPDATE app_user u SET record_status = 'INACTIVE', is_active = false, status_changed_at = now()::timestamp
      FROM pair p
     WHERE u.user_id = p.legacy_id
       AND btrim(u.username) = p.legacy_username           -- the row is still that legacy person
       AND u.record_status = 'ACTIVE'
       AND EXISTS (SELECT 1 FROM app_user s              -- and their SSO row is there
                    WHERE s.user_id <> u.user_id AND lower(btrim(s.email_address)) = p.sso_email)
    RETURNING 1
  )
  SELECT count(*)::integer FROM done;
$$;

SELECT merge_legacy_users();
