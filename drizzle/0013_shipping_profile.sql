-- 0013_shipping_profile — "โปรไฟล์บริษัทขนส่ง": the courier a repaired device is
-- shipped back with, so the customer tracking page can show its logo and a link
-- straight to that courier's own tracking page.
-- The legacy DB never stored the courier for the RETURN leg (it was free text
-- mixed into return_customer_detail), so only jobs closed from now on get an id;
-- older jobs keep showing just the tracking number (agreed 2026-09-23).
-- Idempotent.
CREATE TABLE IF NOT EXISTS shipping_profile (
    id          serial        PRIMARY KEY,
    code        varchar(20)   NOT NULL,                 -- FLASH, JNT, SPX …
    name_th     varchar(200)  NOT NULL,
    name_en     varchar(200)  NOT NULL DEFAULT '',
    logo_path   varchar(200)  NOT NULL DEFAULT '',      -- bucket path (shippers/<id>/…); '' = no logo
    track_url   varchar(300)  NOT NULL DEFAULT '',      -- {no} is replaced with the tracking number
    is_active   boolean       NOT NULL DEFAULT true,
    sort_order  integer       NOT NULL DEFAULT 0,
    created_at  timestamp     NOT NULL DEFAULT now(),
    updated_at  timestamp     NOT NULL DEFAULT now(),
    deleted_at  timestamp,
    deleted_by  integer
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_shipping_profile_code_live ON shipping_profile (code) WHERE deleted_at IS NULL;

-- which courier carried the device back (NULL = legacy / not recorded)
ALTER TABLE job ADD COLUMN IF NOT EXISTS return_shipper_id integer;
CREATE INDEX IF NOT EXISTS ix_job_return_shipper ON job (return_shipper_id);

-- seed the couriers actually seen in the data; URLs are editable in the admin
-- page because carriers change them (verify each one after deploying)
INSERT INTO shipping_profile (code, name_th, name_en, track_url, sort_order)
SELECT * FROM (VALUES
    ('FLASH',    'Flash Express',      'Flash Express',      'https://www.flashexpress.com/fle/tracking?se={no}', 1),
    ('JNT',      'J&T Express',        'J&T Express',        'https://www.jtexpress.co.th/index/query/gzquery.html?bills={no}', 2),
    ('SPX',      'Shopee Express',     'SPX Express',        'https://spx.co.th/track?{no}', 3),
    ('KEX',      'Kerry Express',      'KEX Express',        'https://th.kerryexpress.com/th/track/?track={no}', 4),
    ('THP',      'ไปรษณีย์ไทย',          'Thailand Post',      'https://track.thailandpost.co.th/?trackNumber={no}', 5)
) AS v(code, name_th, name_en, track_url, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM shipping_profile WHERE shipping_profile.code = v.code);
