-- 0001_shipping_aliases — the courier names the legacy system typed by hand (job_reception_shipper,
-- return_customer_type: "THAIPOST", "ไปรษณีย์", "EMS", "t", "kr", "F" …) belong to a โปรไฟล์บริษัทขนส่ง, so the
-- job form selects that profile and /track links the parcel to the courier's site (decided 2026-10-28).
-- `aliases` = other names of the profile, comma separated, editable on the admin page; matched ignoring case,
-- spaces, punctuation and Thai marks (src/lib/shipper.ts). Seeded from the names in the dump of 27/10/2026.
-- The couriers of that dump with no profile yet are added (logos are uploaded on the admin page; a tracking link
-- only where the courier has a public page per parcel number — each checked in a browser on 2026-10-28:
-- Speed-D / Ship Smile / Grab / Lalamove / LINE MAN have none, Post Sabuy is delivered by Thailand Post, SCG Express
-- has closed → inactive). Two seeded links had broken since 0013: J&T moved to /service/track, kerryexpress.com is
-- gone (KEX) — fixed where they are still the 0013 value.
-- Idempotent: aliases are filled only where empty, a profile is added only when its code is not live.

ALTER TABLE shipping_profile ADD COLUMN IF NOT EXISTS aliases varchar(500) NOT NULL DEFAULT '';

UPDATE shipping_profile p SET aliases = v.aliases
  FROM (VALUES
    ('THP',   'THAIPOST, ไปรษณีย์, ไปรษณีไทย, บริษัท ไปรษณีย์ไทย จำกัด, ปณ, EMS, TP, thaipos, Thailand, t'),
    ('FLASH', 'Flash, Fash, Falsh, เฟลช, แฟลช, แฟรช, Flash Express (C), F'),
    ('KEX',   'Kerry, KR, K'),
    ('JNT',   'J&T, เจแอนด์ที, J'),
    ('SPX',   'Shopee, Shoppy')
  ) AS v(code, aliases)
 WHERE p.code = v.code AND p.aliases = '' AND p.deleted_at IS NULL;

UPDATE shipping_profile p SET track_url = v.now, updated_at = now()
  FROM (VALUES
    ('https://www.jtexpress.co.th/index/query/gzquery.html?bills={no}', 'https://www.jtexpress.co.th/service/track?waybillNo={no}'),
    ('https://th.kerryexpress.com/th/track/?track={no}', 'https://th.kex-express.com/th/track/?track={no}')
  ) AS v(was, now)
 WHERE p.track_url = v.was;

INSERT INTO shipping_profile (code, name_th, name_en, track_url, aliases, is_active, sort_order)
SELECT v.code, v.name_th, v.name_en, v.track_url, v.aliases, v.active,
       (SELECT coalesce(max(sort_order), 0) FROM shipping_profile) + v.n
  FROM (VALUES
    ('DHL',       'DHL',          'DHL',          'https://ecommerceportal.dhl.com/track/?ref={no}',
                  'DHL eCommerce, DHL Express', true, 1),
    ('BEST',      'Best Express', 'Best Express', 'https://www.best-inc.co.th/track?bills={no}', 'Best, Best Expess', true, 2),
    ('NIM',       'Nim Express',  'Nim Express',  'https://www.nimexpress.com/web/p/tracking?h_i={no}', 'Nim', true, 3),
    ('NINJAVAN',  'Ninja Van',    'Ninja Van',    'https://www.ninjavan.co/th-th/tracking?id={no}', '', true, 4),
    ('POSTSABUY', 'Post Sabuy',   'Post Sabuy',   'https://track.thailandpost.co.th/?trackNumber={no}', '', true, 5),
    ('SPEEDD',    'Speed-D',      'Speed-D',      '', 'SPD, 7-11', true, 6),
    ('SHIPSMILE', 'Ship Smile',   'Ship Smile',   '', 'Ship Smite', true, 7),
    ('GRAB',      'Grab Express', 'Grab Express', '', 'Grab, Grad, Garb, แกร็ป, แกร็บ, G', true, 8),
    ('LALAMOVE',  'Lalamove',     'Lalamove',     '', 'LLM, ลาล่ามูฟ, Lalamove มาส่ง', true, 9),
    ('LINEMAN',   'LINE MAN',     'LINE MAN',     '', '', true, 10),
    ('SCG',       'SCG Express',  'SCG Express',  '', '', false, 11)
  ) AS v(code, name_th, name_en, track_url, aliases, active, n)
 WHERE NOT EXISTS (SELECT 1 FROM shipping_profile p WHERE p.code = v.code AND p.deleted_at IS NULL);
