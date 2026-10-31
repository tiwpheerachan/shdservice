# 0008 — `pk bigint` ภายใน + `id uuid v7` ภายนอก ทุกตาราง (แบบ OneLink 0003) หลังเลิกใช้ระบบเก่า

- **Status:** Deferred — ทำแน่ (เจ้าของระบบ 2026-10-28) ยังไม่กำหนดวัน
- **Date:** 2026-10-28

## Context

- ตารางทั้งหมดมาจาก dump ของระบบเก่า (SQL Server) PK เป็น int รัน (`user_id`, `customer_id` …) บางตารางเป็นข้อความ
  (`job.job_no`, `service_code`) และการเชื่อมกันส่วนใหญ่เป็นข้อความ (`job_log.job_no`, `sale_out_dt.sale_out_hd_no`,
  `customer_code`) — มี FK จริงแค่ 31 ตัวจาก 66 ตาราง
- id ที่ออกนอกฐานตอนนี้: เลข int ใน API ฝั่งพนักงาน (~50 จุดใน `src/server/contract`) เช่น ผู้ใช้ ช่าง ไฟล์แนบ โปรไฟล์
  ข้อมูลหลัก รายการคลัง — อยู่หลัง SSO + สิทธิ์ แต่เลขรันบอกจำนวนแถวและชวนไล่ดูแถวอื่น · หน้าสาธารณะ `/track`
  ไม่ส่ง id เลย (token + ticket ใช้ครั้งเดียว, ADR 0004)
- ระหว่างที่ระบบเก่ายังใช้อยู่ ทุกการโหลด dump สร้างตารางเดิมใหม่หมด (`setupdata/load_supabase.sh`) การรื้อ PK ตอนนี้ต้อง
  ทำซ้ำทุกการโหลด และชนกับการเปิดใช้จริง

## Decision

ตามกติกาของ OneLink (`../../../shd_onelink/adr/0003-ids.md`) — **ทุกตาราง ไม่มีข้อยกเว้น**:

- `pk bigint GENERATED ALWAYS AS IDENTITY` คอลัมน์แรก เป็น PK — ใช้ join และ FK เท่านั้น ไม่ออกนอก repository/service
- `id uuid NOT NULL DEFAULT uuid_generate_v7()` คอลัมน์ที่สอง unique — **id เดียวที่ออกนอกฐาน** (API, URL, log)
  Postgres 17 ยังไม่มี `uuidv7()` → ใช้ฟังก์ชันเดียวกับ OneLink migration 0027 (มี `ts` ไว้ backfill ตาม `created_at`)
- FK ชื่อ `<table>_pk`; ตารางเดียวกันถูกอ้างหลายบทบาท → `<บทบาท>_<table>_pk` (`job.engineer_app_user_pk`,
  `job.created_by_app_user_pk`, `job.closed_by_app_user_pk`)
- เลขธุรกิจ (`J…`, `Q…`, `SO…`, `C…`, รหัสอะไหล่) **ไม่ใช่ id** — คงเป็นคอลัมน์ unique ที่คนพิมพ์/ค้น/พิมพ์บนกระดาษ
  แต่ความสัมพันธ์ที่เคย join ด้วยข้อความเปลี่ยนเป็น FK บน `pk`
- ตารางถูก **สร้างใหม่** (ไม่ใช่ ALTER) ให้ `pk`, `id` อยู่หน้าสุด เหมือน OneLink 0027 — ทั้งไฟล์ใน transaction เดียว
- บังคับด้วยเทสต์กับ schema จริง (แบบ `public-ids.test.ts`): ทุกตารางมี `pk` + `id`, ไม่มีคำตอบ API ไหนมี `pk`/`*_pk`

## Consequences

- ได้: id ภายนอกเดาไม่ได้และไม่บอกปริมาณ, join บน bigint, uuid v7 เรียงตามเวลา (index ไม่กระจาย), กติกาเดียวกับ OneLink
- เสีย: งานใหญ่ (L, หลายวัน) — ทุก service/route/contract/หน้าเว็บที่รับหรือส่ง id, `test:db`, e2e, OpenAPI snapshot
  และ `scripts/seed-export.mts`; bookmark / URL เก่าที่มีเลข int ใช้ไม่ได้ (ฝั่งพนักงานเท่านั้น)
- หลังทำแล้ว **โหลด dump ระบบเก่าอีกไม่ได้** — `load_supabase.sh` / `db:dev:load` ต้องเลิกใช้หรือแปลงผ่าน migration นี้
- ระหว่างรอ: id int อยู่เฉพาะ API ที่ล็อกอิน + เช็กสิทธิ์รายแถว; ห้ามเพิ่ม id ใหม่ในหน้าสาธารณะ

## ถ้าทำก่อนเลิกโหลด dump (คุยไว้ 2026-10-28)

การโหลดคือ ล้าง → dump โครงเก่า → migrate อยู่แล้ว ตัวแปลงจึงเป็น migration ที่รันต่อท้ายทุกการโหลดได้:
`pk` = id เดิมของระบบเก่า (ความสัมพันธ์ตรงทุกรอบ, identity นับต่อจาก max) · `id` สร้างแบบ **คงที่ข้ามการโหลด**
(เวลา v7 จากวันที่สร้างแถว + บิตสุ่มจาก hash(ตาราง, id เดิม)) ให้ URL/bookmark ไม่เปลี่ยน · คอลัมน์ `<table>_pk` ของ
ความสัมพันธ์ที่ join ด้วยข้อความเติมจากการจับคู่ทุกครั้ง (ข้อความเดิมเก็บไว้) · ข้ามถ้าแปลงแล้ว (`--reset`) ·
`seed-export.mts` ใช้คอลัมน์ใหม่ · งานเพิ่ม ~1 วัน

## Phase 1 decisions (เจ้าของระบบ 2026-10-29)

Phase 1 = API พูดแต่ `id` uuid (`drizzle/0005` เติมให้ 66 ตารางแล้ว) ขณะที่ join / FK ยังใช้คีย์เดิม — phase 2 ค่อยสร้าง `pk`

1. **ทุก id ของแถว**ที่ข้าม API (params, query, body, คำตอบ, URL, cookie) = `id` uuid ของแถวนั้น · เลข int ออกจาก API ทั้งหมด
2. **ข้อยกเว้น: รหัสสถานะยังเป็นตัวเลข** — `job_status_id` (JS 0–24), `quotation_status_id` (QS), `approve_status_id` (AS),
   `order_status_id` ของอะไหล่ (PART) (`src/lib/status-ids.ts`) · ตารางพวกนี้ก็มี `id uuid` แต่ API ส่งรหัส: เป็นค่าคงที่
   ไม่ใช่ตัวนับ ทุกคนเห็นรายการเต็มอยู่แล้ว ไล่เลขก็ไม่ได้อะไร
3. **ลิงก์เอกสารใช้ uuid ไม่ใช่เลขเอกสาร** — URL หน้าเว็บและ path ของ API สำหรับงาน ใบเสนอราคา ใบสั่งขาย ลูกค้า สินค้า
   (`/jobs/edit?id=<uuid>`, `/api/jobs/<uuid>`, หน้าพิมพ์ด้วย) · เลข J… Q… SO… C… P… ยังแสดง ค้นได้ พิมพ์ และอยู่บนบาร์โค้ด —
   สแกน/พิมพ์เลขแล้วไปผ่านการค้นหาสู่ลิงก์ uuid · **ไม่มี redirect จากลิงก์เลขเก่า** ("ใช้ uuid อย่างเดียว") ลิงก์เก่าตอบไม่พบ
4. id ที่ส่งแต่หน้าเว็บไม่ได้ใช้ (เช่น `JobDetail.createBy`, `jobTypeId` / `productTypeId` / `brandId` / `modelId` /
   `symptomIds` / `engineerSymptomId`, `Permission.id`, `AuditRow.userId`, id / productId ของบรรทัดใบสั่งขาย / ใบเสนอราคา)
   **ตัดทิ้ง** ไม่แปลง — ตรวจว่าไม่มีใครใช้ก่อนทุกตัว
5. `SHD_PROFILE_ID = 1` → หาโปรไฟล์ SHD ด้วย code `'SHD'` (หรือ `isDefault`) แทนเลข
6. path โลโก้ที่เก็บไว้แล้ว (`profiles/{int}/…`, `shippers/{int}/…`) คงเดิม · อัปโหลดใหม่ใช้ uuid ใน path
7. `audit_log`: แถวเก่าคง `entity_key` / `changes` ที่เป็น int (append-only) · แถวใหม่ของ entity ที่อ้างแถวเขียน uuid เป็น `entity_key`
8. `/track` สาธารณะคงเดิม (ไม่มี id ของแถวอยู่แล้ว) นอกจาก path โลโก้ตามข้อ 6

**ชั้นกลาง (phase 0 ของ phase 1):** `uuid()` / `byUuid()` ใน `src/server/contract/common.ts` (อ่านเป็นตัวเล็ก; ไม่ใช่ uuid
→ ข้อความของ schema, path → 404 `ไม่พบ<สิ่งนั้น>`) · `src/server/ids.ts` `rowByUuid` / `pkOf` / `pksOf` (uuid → แถว / คีย์ภายใน,
ไม่พบ → 404 ข้อความเดียวกัน) · `shapes.ts` / `data.ts` / `src/data/types.ts` ส่ง uuid · `useAccess().userId` และ cookie `os_seen` = uuid

## Phase 2 design (decided 2026-10-30)

เฟส 1 (id ภายนอก = uuid, migration 0005) อยู่บน prod แล้ว · เฟส 2 = `pk bigint` คอลัมน์แรก + `id uuid` คอลัมน์ที่สอง ทุกตาราง,
FK บน `pk`, ความสัมพันธ์ที่เคย join ด้วยข้อความเป็น FK — API ไม่เปลี่ยน (OpenAPI snapshot ต้องต่าง 0)

### การตัดสินใจ (เจ้าของระบบ 2026-10-30 — รับทุกข้อที่แนะนำ)

1. **สร้างตารางใหม่ทั้ง 66 ตาราง** (แบบ OneLink 0027) — `pk`, `id` หน้าสุด · ไม่ใช่ ALTER
2. **ลบคอลัมน์ข้อความที่ใช้เชื่อมตาราง** (~20 คอลัมน์ ในตารางลูก) — แทนด้วย `<…>_pk` · เลขธุรกิจคงอยู่ในตารางของมันเอง
   (UNIQUE): `job.job_no` (เช่น J2612490 — เก็บไว้ ตัวอักษรหน้าเลขอาจมีความหมาย), `customer.customer_code`, `product.product_code`,
   `model.model_code`, `quotation_hd.quotation_no`, `sale_out_hd.sale_out_hd_no`, `inventory_hd.inventory_no`, `sale_in_hd.sale_in_hd_no`,
   `job_return_hd.return_no`, `service_cost.service_code`, `job_service_code.service_code`
3. **ON DELETE RESTRICT ทุก FK** (แอปลบแบบ soft delete) รวม `app_user_tour` (เดิม CASCADE)
4. **ค่าที่ชี้หาแถวที่ไม่มีอยู่** (รวมค่าแทนว่าง 0 / -1): FK = NULL และเก็บค่าเดิมทีละแถวใน `legacy_orphan_ref` — ไม่เก็บ `''`
   (dev: 262,966 แถว ~35 MB; ของจริงที่ไม่ใช่ค่าแทนว่างมี 46 = บรรทัดค่าบริการ SV0001 ×43, SVD0001 ×3) · ทบทวนตอน dump รอบสุดท้าย
5. **ตารางรหัส** ใช้รหัสเดิมเป็นเป้าของ FK (ยังได้ `pk` + `id`): job_status.job_status_id, quotation_status, approve_status,
   job_order_spare_part_status.order_status_id, inventory_type, store_location, condition, record_status.code
6. **แถว -1 ของ mt_city / mt_district / mt_sub_district ลบทิ้ง** — ลูกค้าที่ไม่ระบุที่อยู่ = NULL (customers.ts เขียน NULL)
7. **รหัสบรรทัดค่าบริการคงไว้**: `quotation_dt.item_code`, `sale_out_dt.product_code` (รหัสที่พิมพ์บนเอกสาร) คู่กับ `product_pk`
8. **`job.pk` = ตัวเลขของ `job_no`** (J2612490 → 2612490) — เท่ากันทุก dump · ที่ไม่ตรง `^J\d{7}$` = max + row_number
   ตาม (job_create_date, job_no) · identity หลัง cutover นับต่อจาก max · **`pk` ไม่ใช่เลขงาน** (เลขงาน = `job_no`)
9. `pk` = `GENERATED ALWAYS AS IDENTITY` · insert ที่ระบุ pk ใช้ `OVERRIDING SYSTEM VALUE`
10. `view_customer` ลบ (ไม่มีใครใช้) · ตารางว่าง/ไม่ใช้ แปลงด้วย (ทุกตาราง)
11. เลขเอกสารอ้างอิงที่ชี้ได้หลายแบบ → FK แยก: `inventory_hd.reference_document_no` → `job_pk` + `sale_out_hd_pk`;
    `track_doc_ticket.ref` → `quotation_hd_pk` / `sale_out_hd_pk` · `track_event.job_no` คงเป็นข้อความ (สิ่งที่สาธารณะพิมพ์ ไม่ใช่การอ้างถึง)
12. CI: รัน migration ซ้ำบนฐานที่แปลงแล้วทำไม่ได้ → ล้างฐานแล้ว migrate ใหม่ · `migrate.ts --reset` บนฐานที่มี `job.pk` = ปฏิเสธ
13. Deploy: ล็อกทุกตาราง ~1–3 นาที, เครื่องที่รันโค้ดเก่าพังเมื่อ commit → ช่วงปิดปรับปรุง (เจ้าของ deploy เองหลัง QA) ·
    เช็กดิสก์ว่าง ≥ 2 GB · backup ก่อน

### `pk` มาจากไหน

ตารางที่ key เป็นเลข: `pk` = เลขเดิม (ผู้ใช้ 105 = pk 105, ความสัมพันธ์ int เดิมใช้ค่าเดิมได้เลย) · `job`: ข้อ 8 · ตารางที่ key เป็นข้อความ /
composite / ไม่มี key: `row_number()` ตาม key เดิม (temp_spare_part: แบบ 0005 — ข้อความทั้งแถว + ลำดับแถวซ้ำ) · ตารางของแอป
(track_*, idempotency_key, app_user_tour) ว่างตอนโหลด dump — มีข้อมูลเฉพาะครั้งที่รันบน prod ตอน deploy

### `drizzle/0006_bigint_pk.sql` (transaction เดียว, สร้างจาก `scripts/gen-0006.mts` + mapping นี้ + catalog ของ dev แล้ว commit เป็น SQL ล้วน)

0. `SET LOCAL statement_timeout = 0` · ถ้า `job.pk` มีอยู่แล้ว → raise "already converted (drizzle/0006)"
1. **ปฏิเสธสิ่งที่ไม่รู้จัก**: policy ใด ๆ, trigger นอก 7 ตัว, view นอก `view_customer`, **คอลัมน์ใดที่ไม่อยู่ใน mapping** (จับ dump/prod ที่เปลี่ยน)
2. `legacy_orphan_ref` (pk identity, id = `uuid_v7_stable('2023-01-01', table/column/row_pk)`, table_name, row_pk, column_name
   (ชื่อคอลัมน์เดิม), legacy_value text NOT NULL, UNIQUE (table_name, row_pk, column_name), RLS) — ไม่มี FK
3. สร้าง `<t>__new` ทั้ง 66: `pk bigint GENERATED ALWAYS AS IDENTITY`, `id uuid NOT NULL DEFAULT uuid_generate_v7()`, คอลัมน์ที่เหลือ
   ตามลำดับเดิม (`*_pk` อยู่ตำแหน่งคอลัมน์ที่แทน) — ยังไม่มี PK/index/FK
4. คัดลอก parent ก่อน: `INSERT … OVERRIDING SYSTEM VALUE SELECT` · `id` คัดลอกจากแถวเดิม (uuid คงที่ของ 0005) · ความสัมพันธ์ int
   คัดลอกตรง (NULL ถ้าไม่มีเป้า) · ความสัมพันธ์ข้อความ `LEFT JOIN` ตาราง `__new` ของ parent ด้วยเลขธุรกิจ
5. orphan: `INSERT INTO legacy_orphan_ref … ORDER BY` ต่อความสัมพันธ์ (ค่าไม่ว่างที่ไม่มีเป้า, ไม่รวม `''`) + `RAISE NOTICE '<t>.<col>: n'`
6. **ห้ามหาย** (abort): จำนวนแถวเท่ากันทั้ง 66 · ทุกความสัมพันธ์ non-NULL เดิม = non-NULL ใหม่ + orphan · ชุด `id` เท่าเดิม ·
   ทุก index เดิมถูกสร้างใหม่หรืออยู่ในรายการ "แทนด้วย"
7. สลับ: `DROP VIEW view_customer`, drop 66 ตารางเก่า, rename `__new` → `<t>`, sequence → `<t>_pk_seq`, `pk RESTART WITH max+1`
8. PK บน `pk` · `ux_<t>_id` UNIQUE (id) · UNIQUE เลขธุรกิจ (ข้อ 2) และคอลัมน์รหัส · index เดิมทุกตัว (index บนคอลัมน์ข้อความที่ลบ
   → ย้ายไป `*_pk`) · index ทุก `*_pk` · FK `fk_<t>_<col>` RESTRICT · CHECK เดิม (`ck_inventory_dt_qty` คง NOT VALID) ·
   FK NOT VALID เดิม (product→manufacturer, sale_out_dt→product) กลายเป็น VALID
9. trigger: `bump_row_version` ×4 (อาร์กิวเมนต์ `document_profile_id` → `document_profile_pk`), `audit_log_readonly` ×2,
   `job_track_token_hash_sync` · `ENABLE ROW LEVEL SECURITY` ×67 · comment · `merge_legacy_users()` ใช้ `pk` (+ REVOKE แบบ 0003) · `ANALYZE`

### Mapping (dev 2026-10-30; ตัวเลขในวงเล็บ = แถวที่ไปเป็น NULL + `legacy_orphan_ref`)

ผู้ใช้: `<บทบาท>_app_user_pk` → `app_user.pk` (= user_id เดิม) · ทุก `*_pk` nullable เว้น NN · ทุก FK RESTRICT

| ตาราง (แถว) | pk ← | ความสัมพันธ์ → คอลัมน์ใหม่ (orphan) | เลขธุรกิจ / หมายเหตุ |
|---|---|---|---|
| app_back_up_db_log (381) | pk | back_up_by → backed_up_by_app_user_pk | |
| app_config (88) | config_id | — | UNIQUE (user_type, module_name) |
| app_user (133) | user_id | status_changed_by → status_changed_by_app_user_pk | record_status = รหัส |
| app_user_tour | row_number(user_id) | user_id → app_user_pk NN UNIQUE | เดิม CASCADE → RESTRICT |
| approve_status (5) | approve_status_id | — | ตารางรหัส |
| audit_log (271) | pk | user_id → app_user_pk (แอปเขียน 0 = ระบบ → ต้องเขียน NULL) | entity_key / changes คงเดิม |
| category, color, job_type, manufacturer, product_type, symptom | key เดิม | status_changed_by → status_changed_by_app_user_pk | |
| condition (3), store_location (2), inventory_type (5), job_status (25), quotation_status (8), job_order_spare_part_status (5) | key เดิม | — | ตารางรหัส |
| customer (45,686) | customer_id | create_by → created_by_app_user_pk · city_id → mt_city_pk (27,657) · district_id → mt_district_pk (27,815) · sub_district_id → mt_sub_district_pk (27,844) | customer_code UNIQUE |
| document_attach (5,985) | document_attach_id | reference_item_code → job_pk NN | ลบ reference_item_code, reference_topic |
| document_profile (2), shipping_profile (16) | pk | deleted_by → deleted_by_app_user_pk | code UNIQUE เฉพาะแถวที่ยังไม่ลบ (partial index จาก 0011 — ลบแล้วคืนรหัส) |
| idempotency_key | ใหม่ | user_id → app_user_pk NN | UNIQUE (app_user_pk, key) |
| inventory_dt (27,792) | inventory_dt_id | inventory_no → inventory_hd_pk NN · item_code → product_pk · receive_inventory_no → receive_inventory_hd_pk (`''` ทั้งหมด → NULL) | ลบ inventory_no, item_code, receive_inventory_no |
| inventory_hd (21,485) | inventory_hd_id | create_by → created_by_app_user_pk (369) · reference_document_no → job_pk (9,824) + sale_out_hd_pk (3,865) | inventory_no UNIQUE; ลบ reference_document_no · **เพิ่ม `po_no` varchar(50) NOT NULL DEFAULT ''** (เลข PO ของใบรับเข้า, ข้อความอิสระ; แถวเดิม '') |
| job (51,138) | ตัวเลขของ job_no | customer_id → customer_pk · job_create_by → created_by_app_user_pk · job_repaired_by → repaired_by_app_user_pk (1,938) · job_closed_by → closed_by_app_user_pk (3,627) · engineer_id → engineer_app_user_pk (34,125) · job_return_by → returned_by_app_user_pk (51,134) · job_type_id → job_type_pk · product_type_id → product_type_pk (6) · product_brand_id → brand_manufacturer_pk · product_model_id → model_pk · product_symptom_id → reported_symptom_pk (1,870) · engineer_symptom_id → engineer_symptom_pk (50,812) · document_profile_id → document_profile_pk · return_shipper_id → return_shipping_profile_pk · quotation_no_approved → approved_quotation_hd_pk | **job_no UNIQUE (คงไว้)**; job_status_id = รหัส; ลบ quotation_no_approved |
| job_call_log, job_log (234,776), job_send_forward_dt, job_symptom, job_order_spare_part_log | key เดิม (job_symptom: row_number) | job_no → job_pk NN + ผู้ใช้ตามบทบาท (job_log action_by (1), jsfd receive_by (2,197), jospl grant_by (670), return_by (12,442)) · jospl spare_part_code → product_pk · stock_id/return_stock_id → รหัส store_location (return 12,537) · job_symptom symptom_id → symptom_pk NN | ลบ job_no, spare_part_code · UNIQUE (job_pk, symptom_pk) |
| job_close_temp, job_create_temp, job_return_hd/dt, job_service_code, quotation_temp, sale_in_hd/dt, product_serial, model_color, model_part, model_tier, temp_model, temp_spare_part (ว่าง/ไม่ใช้) | key เดิม / ใหม่ | ข้อความ → `*_pk` ตามชื่อ | แปลงตามกติกาเดียวกัน |
| model (1,202) | model_id | manufacturer_id → manufacturer_pk · tier_id → model_tier_pk (1,202; แอปเขียน 0 → NULL) | model_code UNIQUE |
| mt_city / mt_district / mt_sub_district | key เดิม | district/sub_district: city_id, district_id → *_pk | ลบแถว -1 |
| product (2,583) | product_id | category_id → category_pk · manufacturer_id → manufacturer_pk (3) · create_by, cancel_by (2,513) → *_app_user_pk | product_code UNIQUE |
| product_model (4,134), product_none_serial (2,582) | key เดิม | product_id → product_pk · model_code → model_pk | ลบ model_code |
| quotation_dt (4,067) | quotation_dt_id | quotation_no → quotation_hd_pk NN · item_code → product_pk (3 SVD0001) | **item_code คงไว้**; ลบ quotation_no |
| quotation_hd (3,105) | quotation_hd_id | customer_code → customer_pk · reference_job_no → job_pk · create_by → created_by_app_user_pk · document_profile_id → document_profile_pk | quotation_no UNIQUE; ลบ customer_code, reference_job_no |
| record_status (3) | row_number(sort_order) | — | `code` = เป้าของ FK 16 ตัว |
| running_no (17) | running_id | — | |
| sale_out_dt (4,230) | sale_out_dt_id | sale_out_hd_no → sale_out_hd_pk NN · product_id → product_pk (43 SV0001) · onhand_item_id → product_none_serial_pk (43) · pick_inventory_no → pick_inventory_hd_pk · return_inventory_no → return_inventory_hd_pk | **product_code คงไว้**; ลบ sale_out_hd_no, pick/return_inventory_no |
| sale_out_hd (3,983) | sale_out_hd_id | customer_id → customer_pk (ลบ customer_code) · document_create_by, document_cancel_by (3,982), sale_out_by, approve_by (90) → *_app_user_pk · document_profile_id → document_profile_pk | sale_out_hd_no UNIQUE |
| service_cost (7) | ใหม่ | — | service_code UNIQUE |
| track_* | ใหม่ (track_event: pk เดิม) | job_no → job_pk NN (ticket, doc_ticket) · customer_ids → customer_pks bigint[] | track_event.job_no คงข้อความ |
| **legacy_orphan_ref** (ใหม่) | identity | — | ข้อ 4 |

### แอป, CI, seed

- drizzle: `pkCol()` คอลัมน์แรกทุกตาราง, `*_pk` = `bigint({ mode: 'number' })` (ชนิด TS ยัง `number`), เปลี่ยนชื่อ property ตาม mapping
  (`appUser.userId` → `appUser.pk`, `job.engineerId` → `job.engineerAppUserPk`, `jobLog.jobNo` → `jobLog.jobPk` …), ลบ `viewCustomer`
- join ข้อความ 46 จุด + raw SQL ~12 จุด → join บน pk · เขียนค่าแทนว่าง 17 จุด → NULL · `ids.ts` `pkOf(table, id)` ใช้ `table.pk` เสมอ ·
  `CurrentUser.userId` → `CurrentUser.pk` (ค่าเดิม)
- `migrate.ts --reset` / reset อัตโนมัติบนฐานที่มี `job.pk` = ปฏิเสธ ("แปลงแล้ว (0006): สร้างใหม่ — db-wipe + migrate") ·
  `prepare-db -- --reset` = db-wipe แล้ว migrate (ในเครื่องเท่านั้น) · CI: prepare → wipe → prepare
- `seed-export.mts`: ส่งออก `pk`, `app_user_tour` ผ่าน `app_user_pk`, insert ด้วย `OVERRIDING SYSTEM VALUE` + คอลัมน์ระบุชัด, ต้นทางต้อง ≥ 0006
- fixture เทสต์ ~330 INSERT: `OVERRIDING SYSTEM VALUE`, ตารางลูกใส่ `job_pk = (SELECT pk FROM job WHERE job_no = …)`, `setval(…,'pk')`

### เทสต์บังคับกติกา (ID-4)

1. schema จริง (`test-qa-ids.mts`): ทุกตาราง (67) คอลัมน์ 1 = `pk bigint` identity ALWAYS + PK, คอลัมน์ 2 = `id uuid` default v7 + unique ·
   ทุก `*_pk` มี FK ไป `<t>.pk` (ยกเว้น `legacy_orphan_ref.row_pk` และ array `track_otp/track_session.customer_pks` — FK ไม่ได้โดยธรรมชาติ) · ทุก FK ชี้ `pk` ยกเว้น allowlist ตารางรหัส · ทุก FK RESTRICT · ไม่มีคอลัมน์ที่ลบ · มี `legacy_orphan_ref`
2. drizzle (`test-schemas.mts`, ไม่ใช้ DB): ทุก `pgTable` คอลัมน์ 0 = `pk`, 1 = `id`
3. API (`test-openapi.mts`): ไม่มี property ชื่อ `pk` หรือลงท้าย `_pk` / `Pk` ในคำขอหรือคำตอบ

### แบ่งงาน

| # | งาน | ไฟล์ | ต่อจาก |
|---|---|---|---|
| S1 | migration + generator + journal + migrate.ts guard + prepare-db + CI | `drizzle/0006*`, `drizzle/meta/_journal.json`, `scripts/gen-0006.mts`, `scripts/migrate.ts`, `tests/prepare-db.mts`, `.github/workflows/ci.yml` | — |
| S2 | drizzle schema | `src/db/schema/*` | — (พร้อม S1) |
| S3 | ผู้ใช้ / สิทธิ์ / master / ลูกค้า / auth / audit / idempotency / ids | services + routes/pages ของกลุ่มนี้ | S2 |
| S4 | งาน + tracking | jobs.ts, job-checks.ts, alerts.ts, tracking.ts, track-*.ts + routes/pages/print | S2, S3 |
| S5 | ใบเสนอราคา / ใบสั่งขาย / โปรไฟล์ | quotations.ts, sale-orders.ts, document-profiles.ts, shipping-profiles.ts + print | S2, S3 |
| S6 | คลัง / รายงาน / records / export | stock.ts, reports.ts, records.ts, export.ts | S2, S3 |
| S7 | เทสต์: test-domain / test-qa-* + test-api + test-track / seed.mts + e2e support + seed-export | ตามชื่อ | S1, S2 |
| S8 | เทสต์บังคับกติกา | test-qa-ids.mts, test-openapi.mts, test-schemas.mts | S1, S2 |
| S9 | ตรวจทั้งหมด: tsc / eslint / npm test (snapshot ต่าง 0), test:db, e2e, `db:dev:load` 2 รอบ fingerprint เท่ากัน, สำเนา prod (เวลา, WAL, ขนาด), QA เบราว์เซอร์ | — | ทั้งหมด |

## Phase 2 — no redundant data (เจ้าของระบบ 2026-10-30)

โครงสร้างของระบบใหม่ต้องถูกตั้งแต่แรก: ข้อมูลเก่าอยู่ไว้เทียบได้ แต่ **แถวใหม่ห้ามเก็บสิ่งที่หาได้จากความสัมพันธ์** และคอลัมน์ที่ตาย /
ค่าคงที่ / สำเนาของอีกคอลัมน์ ถูกลบใน 0006 (`NO_REDUNDANT` ใน `scripts/gen-0006.mts`). ก่อนลบทุกคอลัมน์ ตรวจทั้งโหลด dump ใหม่และสำเนา prod
(`prod-before-uuid-20261029-2110.dump` → 0005 → 0006) ว่าไม่มีข้อมูลหาย — และ **section 6 ตรวจซ้ำทุกแถวตอน migrate** (ไม่ตรง = abort):

- **ลบ (ค่าคงที่ / ว่างทุกแถว)**: job.company_id, branch_id (=1), product_color, job_reference_no_gspn (ว่าง), job_gspn_create_date (1900-01-01),
  track_token (NULL ทุกแถวตั้งแต่ 0033 — /track อ่าน track_token_hash, trigger `trg_job_track_token_hash` + `job_track_token_hash_sync()` ลบตาม;
  แอปเขียน hash เอง) · sale_order.document_type ('SaleOrder'), document_status / is_sale_out (true), document_credit_note_no (ว่าง) ·
  sale_order_line.store_location_id / condition_id (1), serial_no, document_credit_note_no (ว่าง) · stock_move.item_type ('SparePart'), is_active
  (true), company_id / branch_id (1 หรือ NULL) · stock_move_line.item_unit ('Pcs.'), store_location_id / stock_type_id (1), receive_inventory_no (ว่าง
  ทุกแถว) · job_part.stock_id (1), spare_part_serial_no (ว่าง) · product_stock.is_publish (true), store_location_id / condition_id (1) ·
  product.is_serial_control (false) · app_user.password (NULL, 0002), asc_code / asc_name (ว่าง) · quotation.customer_contact_name (ว่าง) ·
  quotation_line.unit ('หน่วย')
- **ลบ (สำเนาของสิ่งที่ความสัมพันธ์บอก)**: job.brand_manufacturer_pk = model_pk → model.brand_pk (ทุกแถว; job.model_pk จึง NOT NULL — 0 แถวว่าง) ·
  sale_order.sale_out_date = document_create_date · sale_order.reference_no = inventory_no ของใบเบิก (stock_move type 4 ที่ sale_order_pk ชี้) ·
  sale_order_line.product_none_serial_pk = แถวสต็อกของ product_pk (บรรทัดค่าบริการ 43 แถวชี้ไม่เจออะไร → legacy_orphan_ref ตามเดิม) ·
  sale_order_line.product_type: 'Service' ⇔ product_pk NULL · job_outsource.send_status: รับแล้ว ⇔ receive_date ไม่ใช่ 1900-01-01 ·
  app_user.deleted ⇔ record_status = 'DELETED' · model.model_tier_pk (0 / -1 ทุกแถว — ไม่มี tier; ค่าเดิมอยู่ใน legacy_orphan_ref) ·
  `is_active` ของ 12 ตาราง (category, color, customer, job_attachment, job_type, brand, model, product, product_type, quotation, symptom, app_user)
  ⇔ record_status = 'ACTIVE' (0 แถวต่าง) — `ix_unique_model` เดิม (ชื่อ, ยี่ห้อ, is_active) = (ชื่อ, ยี่ห้อ, record_status = 'ACTIVE');
  `ix_username_and_password` ลบ (password NULL ทุกแถว ไม่เคยบังคับอะไร)
- **เงิน / จำนวนเบิก / บัญชี ห้ามลบ ห้ามคำนวณใหม่ ห้ามแก้** (เจ้าของระบบ 2026-10-30) แม้คงที่หรือเท่าคอลัมน์อื่น: sale_order total_amount, vat_rate
  (เดิม vat_rat — เปลี่ยนแค่ชื่อ), vat_amount, rounding_amount · sale_order_line.wholesale_price · product_stock.quantity_inspection /
  not_available / loss · model.market_price · ทุก price/amount/qty/cost/discount — section 6 ตรวจว่าทุกคอลัมน์ตัวเลข (และ integer ที่ชื่อเป็น
  จำนวน/ราคา) **เท่าเดิมทุกแถว**
- **ไม่ลบ (ข้อมูลไม่ครบ 100%)**: job.approved_quotation_pk — 49 งานชี้ใบเสนอราคาที่ภายหลังปฏิเสธ/ยกเลิก (หาไม่ได้จากสถานะ) → คงค่าเดิม, แถวใหม่ NULL,
  อ่าน "ใบที่ตกลง" จาก quotation (job_pk, สถานะตกลง 3/6/9) — `ux_quotation_agreed_job` UNIQUE (job_pk) WHERE status IN (3, 6, 9) (legacy: 0 งานมี 2 ใบ) ·
  product.cancel_date / cancelled_by_app_user_pk / cancel_remark — 70 แถวยกเลิกจริงที่ status_changed_* ไม่มี → คงไว้, แถวใหม่ใช้ status_changed_*
- **คงไว้ให้ข้อมูลเก่า แถวใหม่ NULL** (nullable + COMMENT "legacy snapshot — new rows NULL, read via …"): job.customer_detail (customer_pk),
  product_model_name (model_pk), job_reception_shipper (reception_shipping_profile_pk), return_customer_detail (แถวใหม่เก็บเฉพาะหมายเหตุการส่งคืนที่พนักงานพิมพ์ — ขนส่งอ่านจาก return_shipping_profile_pk; หมายเหตุไม่ใช่สำเนาของข้อมูลอื่น), spare_part_replace (job_part),
  swap_refund_detail (new_serial_no), reported_symptom_pk (job_symptom), approved_quotation_pk · quotation_line.item_code (product_pk) ·
  sale_order_line.product_code (product_pk; บรรทัดค่าบริการเก็บรหัสเป็นข้อความ) · stock_move.reference_out_to (job_pk / sale_order_pk) ·
  customer.customer_address (customer_address1/2 + province/district/sub_district)
- **เพิ่ม**: job.reception_shipping_profile_pk → shipping_profile (FK RESTRICT + index; เติมเมื่อ btrim(job_reception_shipper) = name_th ของโปรไฟล์ที่ใช้อยู่
  ตรงทุกตัวอักษร: 1,236 งาน ทั้ง dump และ prod) · job.new_serial_no (S/N ใหม่ตอนเปลี่ยนเครื่อง / ปิดงาน; ไม่เติม) · quotation.customer_name /
  customer_address / customer_tax_id / customer_phone (สำเนาลูกค้าตอนลูกค้าตกลง; legacy NULL) · sale_order.customer_* เดิมคงอยู่ (เขียนตอนอนุมัติแทนตอนร่าง)
- **`legacy_boundary`** (pk, id, table_name UNIQUE, max_pk, loaded_at; RLS, ไม่มีสิทธิ์ anon/authenticated) เติมท้าย 0006 ด้วย max(pk) ของทั้ง 66 ตาราง
  (ชื่อใหม่): แถว pk ≤ max_pk มาจากระบบเก่า — แอปล็อกช่องเงิน/จำนวนของแถวเหล่านั้น · มี pk + id ตามกติกา "ทุกตาราง" ของ ADR นี้

## Phase 2 — table naming (เจ้าของระบบ 2026-10-30)

ทำใน 0006 รอบเดียว (ทุกตารางถูกสร้างใหม่อยู่แล้ว): ชื่อบอกว่าเก็บอะไร + แก้ชื่อสะกดผิด. section 1–6 ใช้ชื่อเก่า, section 7 rename ตาราง / คอลัมน์ /
sequence (`<ใหม่>_pk_seq`) / CHECK (`ck_<ใหม่>_…`), section 8–9 ใช้ชื่อใหม่ (index `ix_/ux_/gin_<ใหม่>_…`, FK `fk_<ใหม่>_<คอลัมน์>`, trigger
`tr_<ใหม่>_…`). ตารางเก่าที่ไม่ใช้ 16 ตารางคงชื่อ (ลบหลัง cutover) · `legacy_orphan_ref` เก็บชื่อตาราง/คอลัมน์ **ของระบบเก่า** · `audit_log.entity`
ของตารางที่เปลี่ยนชื่อถูกเขียนเป็นชื่อใหม่ตอนคัดลอก (changes / meta คงเดิม; dump + prod วันนี้: 0 แถว) · `running_no.running_type` คงเดิม

product_none_serial → product_stock · job_order_spare_part_log → job_part · job_order_spare_part_status → job_part_status · job_send_forward_dt →
job_outsource · document_attach → job_attachment · app_config → role_permission · product_model → product_compatible_model · mt_city / mt_district /
mt_sub_district → province / district / sub_district · manufacturer → brand · job_log → job_status_log · sale_out_hd / sale_out_dt → sale_order /
sale_order_line · quotation_hd / quotation_dt → quotation / quotation_line · inventory_hd / inventory_dt / inventory_type → stock_move /
stock_move_line / stock_move_type. คอลัมน์ `*_<ตารางเก่า>_pk` ตามชื่อใหม่ (sale_order_pk, quotation_pk, stock_move_pk, province_pk, brand_pk, …),
เลขเอกสาร (sale_order_no, stock_move_no), รหัส (stock_move_type_id, job_part_status_id), `_hd`/`_dt` (remark, amount), job_status_log.log_date,
brand.brand_name, สะกดผิด (picture_file_name, product_vendor_code, short_code, vat_rate). รายการเต็ม old → new (ตาราง / คอลัมน์ / ชื่อ TS):
[0008-phase2-renames.md](0008-phase2-renames.md#final-names-after-drizzle0006-2026-10-30-no-redundant-data--table-naming)

## Phase 2 — audit trail (เจ้าของระบบ 2026-10-30)

บันทึกต้องบอกตัวผู้กระทำครบ **ตามที่เป็นในเวลานั้น** (ชื่อ / อีเมล / บทบาท / แผนกอาจเปลี่ยนภายหลัง จึงเก็บสำเนาในแถว ไม่ join ไปหา):

- `audit_log` (สิ่งที่พนักงานแก้): คัดลอกแถวเดิมทุกคอลัมน์ตรงทุกไบต์ (section 6 ตรวจ; `entity` ของตารางที่เปลี่ยนชื่อ = ชื่อใหม่) · app_user_pk → `actor_pk`
  (FK RESTRICT, NULL = ระบบ / ไม่ระบุตัว), user_name → `actor_name` · เพิ่ม `actor_email`, `actor_role` (user_type ขณะนั้น), `actor_department`, `ip`,
  `user_agent`, `session_id` (ตัวระบุ session — ไม่ใช่ cookie), `request_id`, `permission` (module/สิทธิ์ + action ที่ใช้), `entity_id` (uuid ของแถว),
  `entity_no` (เลขธุรกิจ J… / SO… / Q… / C…), `reason`, `row_hash` · แถวเก่าที่ไม่เคยบันทึกค่าใด = NULL (ไม่เดา) ยกเว้น entity_id / entity_no ที่หาได้จาก
  entity_key (job_no, customer_code, คีย์ int เดิม, uuid): สำเนา prod 42 / 42 แถวได้ entity_id, 11 แถวได้ entity_no · index (entity, entity_id, at),
  (entity_no), (actor_pk, at), (at) + เดิม (entity, entity_key, at), (module, at)
- `security_log` (ใหม่): LOGIN, LOGIN_FAILED, LOGOUT, DENIED, ROLE_CHANGE, PERMISSION_CHANGE, USER_STATUS, EXPORT, PRINT × OK / DENIED / FAILED (CHECK) +
  ผู้กระทำแบบเดียวกัน + module, permission, entity, entity_id, entity_no, detail jsonb · index (at), (actor_pk, at), (event, at) · RLS, ไม่มีสิทธิ์
  anon/authenticated · แถว LOGIN / LOGOUT เดิมใน audit_log อยู่ที่เดิม (ไม่ย้ายประวัติ)
- ทั้งสองตาราง append-only (trigger ห้าม UPDATE / DELETE / TRUNCATE) · `row_hash` = sha256 ของเนื้อหาแถว (ทุกคอลัมน์ยกเว้น row_hash) ตั้งโดย trigger
  BEFORE INSERT; แถวที่คัดลอกมาถูก hash ตอน 0006 (พิสูจน์ "ไม่เปลี่ยนตั้งแต่ 0006") · **ไม่ทำ hash chain**: chain (แต่ละแถว hash ทับแถวก่อน) บังคับให้
  ทุกการเขียนของทั้งระบบเข้าคิวที่แถวเดียว
- **retention: forever for now — owner to decide (suggested: audit forever, security_log 1 year under PDPA)** (อยู่ใน COMMENT ของทั้งสองตารางด้วย)
