# เปิดใช้ระบบใหม่ (cutover): ระบบเก่า SQL Server → OneService (Postgres)

> **ร่าง** 2026-10-20 · ตัวเลขทั้งหมดมาจาก dump ชุด `setupdata/` (ข้อมูลถึง 2026-09-14 17:32) ที่โหลดเข้า Postgres ชั่วคราว
> แล้วรัน migration 0000–0035 ครบ (จำลองวันเปิดใช้) · ไม่ได้ต่อ production · 👤 = เจ้าของต้องตัดสินใจ

## สรุปผลตรวจ dump ปัจจุบัน (ใช้เป็นค่าอ้างอิง)

- `data.sql` มี 420,113 INSERT = `rowcounts.txt` = จำนวนแถวที่โหลดได้จริง ครบทั้ง 52 ตาราง
- **migration ไม่ลบหรือรวมแถวไหนเลย** เทียบทีละแถวด้วย PK แล้วต่างกันแค่ 4 จุด: `app_config` เพิ่ม 20 แถว (สิทธิ์จาก 0029/0030) และแก้ 1 แถว (0028), `job_status` 16 แก้คำผิด (0028), `running_no` 5 แถว `company_id` → 1 (0007) · ยอดเงิน, สถานะ และสต๊อกตรงกับระบบเก่าทุกปี ทุกเดือน (ต่าง 0.00)
- 0031 ต้องขึ้น NOTICE 3 บรรทัดนี้เท่านั้น: `sale_out_dt.product_id` 41 แถว, `product.manufacturer_id` 3 แถว, `inventory_dt` ติดลบ 1 แถว (เป็นค่า sentinel `-1` ของระบบเก่า ไม่ใช่แถวกำพร้า)
- ไม่มีแถวกำพร้า ไม่มีเลขเอกสารซ้ำ ไม่มีภาษาไทยเพี้ยน (mojibake / `?` / U+FFFD = 0) · มีอักขระล่องหน (NBSP / zero-width) ในชื่อลูกค้า 1,991 ราย และที่อยู่ 3,708 ราย (ระบบใหม่ค้นเจออยู่แล้ว)
- เลขเอกสารถัดไปที่ระบบใหม่จะออก = `running_no.number + 1` ซึ่งมากกว่าเลขสูงสุดที่มีอยู่ทุกชุด **ไม่ชนกัน**: J2612165 · Q2600463 · SO2600761 · WHI2601407 · WHO2602248 · C43602 · P02552 · MD01175 (จะชนก็ต่อเมื่อระบบเก่ายังออกเลขต่อหลัง dump ครั้งสุดท้าย)
- ระบบใหม่ไม่แก้ยอดเงินของงานที่ปิดแล้ว แต่บางค่าคิดคนละแบบกับระบบเก่า (ไม่ใช่ข้อมูลหาย):
  - ค้างชำระ = รวม − มัดจำ − รับแล้ว → งานที่ "ซ่อมเสร็จ" ยังไม่ชำระ 73 งาน 121,350.50 บาท, งานปิดแล้วค้าง 2 งาน 3,300 บาท, คืนมัดจำ 1 งาน, รับเกิน 1 งาน
  - ยอดอะไหล่ของงานที่ยังเปิด 14 งานไม่ตรงกับกติกาใหม่ (นับเฉพาะบรรทัดที่ติ๊ก "เบิก" และยังไม่ยกเลิก) → ถ้ามีการรับคืนอะไหล่ ยอดจะถูกคำนวณใหม่ ลดลงรวม 9,700 บาท
  - ใบเสนอราคา "เสนอราคาแล้ว" 13 ใบ จะขึ้นป้าย "หมดอายุ" (เกิน 7 วัน) · มี 48 งานที่ยังชี้ไปใบเสนอราคาที่ลูกค้าปฏิเสธหรือยกเลิกไปแล้ว
- สต๊อก: ยอดคงเหลือที่ระบบใหม่แสดง (`product_none_serial.quantity_remain`) ไม่ตรงกับ Stock Card (รวมความเคลื่อนไหว) **15 สินค้า ต่างกันรวม 565 ชิ้น** (P00229 ต่างคนเดียว 550: คงเหลือ −540 แต่ Stock Card บอก 10) · คำขอเบิกที่ค้างอยู่ 279 บรรทัด ในจำนวนนี้ 245 บรรทัดเป็นของงานที่ปิดหรือยกเลิกไปแล้ว · ยอดจองที่เก็บไว้ 560 ชิ้น อยู่ใน 10 สินค้าเท่านั้น
- ไฟล์แนบ (ไฟล์ในโฟลเดอร์ ณ 2026-09-15):

  | ชนิด | แถวใน DB | มีไฟล์ | ไม่มีไฟล์ | ไม่มีไฟล์ แยกปี |
  |---|---|---|---|---|
  | ไฟล์แนบงาน `document_attach` | 5,866 | 4,413 | 1,453 | 2023: 667 · 2024: 399 · 2025: 300 · 2026: 87 |
  | สลิปใบสั่งขาย | 3,808 | 2,828 | 980 | 2023: 359 · 2024: 160 · 2025: 222 · 2026: 239 |
  | สลิปงาน | 75 | 19 | 56 | 2023: 53 · 2024: 3 |
  | รูปสินค้า | 822 | 786 | 36 | |

  ไฟล์ที่อยู่ในโฟลเดอร์แต่ไม่มี DB อ้างถึง: `FileUpload` 170 ไฟล์ และ `ImagesProduct` 19 ไฟล์ · ใน `receipt/` และ `sales_order/` มี PDF อย่างละ 1 ไฟล์ ซึ่งไม่ใช่ข้อมูลระบบเก่า (เลขเอกสารสูงกว่าเลขใน dump)
- ผู้ใช้: ใช้งานอยู่ 44 คน **มีอีเมลแค่ 6 คน** (System Admin มีอีเมล 2 คน) · ผู้ใช้ที่ใช้งานอยู่แต่ไม่มีอีเมล 38 คน (เอกสาร production-readiness บอกว่า 40 คน — ให้นับใหม่จาก dump ครั้งสุดท้าย)

## ⚠️ ต้องรู้ก่อนเลือกวิธี

> `AGENTS.md` ห้ามรัน `load_supabase.sh` / `db:migrate:reset` กับ production — วันเปิดเป็นข้อยกเว้นเดียว ทำตามลำดับด้านล่าง และเจ้าของต้องสั่งก่อน 👤

1. **dump ใหม่ = ข้อมูลทุกอย่างที่กรอกในระบบใหม่ก่อนวันนั้นหายทั้งหมด** เพราะ `01_schema.sql` ลบ (DROP) แล้วสร้างทั้ง 52 ตารางใหม่ ซึ่งรวมถึง
   `app_user` (อีเมลหรือ Lark ที่ผูกไว้, ตำแหน่ง, ผู้ใช้ SSO ที่เพิ่มใหม่), `app_config` (สิทธิ์ที่ปรับในหน้าสิทธิ์ ส่วนสิทธิ์ที่เคยถอดออกจะกลับมา), งาน, ใบเสนอราคา, ใบสั่งขาย, ลูกค้า และความเคลื่อนไหวสต๊อก
   → ตั้งแต่ dump ครั้งสุดท้ายจนถึงเปิดระบบ **ห้ามมีใครคีย์ข้อมูลในระบบไหนเลย**
2. ตารางที่ระบบใหม่สร้างเอง **ไม่ถูกลบ** และไม่มี FK ไปหาตารางเดิม: `job_symptom`, `track_*`, `idempotency_key`, `audit_log` (ลบไม่ได้ เพราะ trigger 0035 กันไว้), `document_profile`, `shipping_profile`
   → ถ้า dump ทับโปรเจกต์ Supabase เดิม แถวเก่าในตารางเหล่านี้จะไปผูกกับเลขงานหรือรหัสผู้ใช้ที่ตอนนี้เป็นของคนอื่นแล้ว
3. migration รันตอน deploy ผ่าน Render `preDeployCommand: npm run db:migrate` แต่**ถ้า dump ทับโปรเจกต์เดิม Render จะไม่ยอมรัน** เพราะ journal บอกว่ารันแล้ว แต่ไม่มีคอลัมน์ `lark_id` → deploy ล้ม
   ต้องรัน `ALLOW_PROD_DB=1 npm run db:migrate:reset` ด้วยมือ (dev ทำ) ระหว่างนั้นแอปตัวที่รันอยู่ใช้งานไม่ได้ จึงต้องเปิดโหมดปิดปรับปรุงไว้ก่อน (ขั้น 3)
4. ไฟล์ที่อัปโหลดผ่านระบบใหม่เก็บไว้ที่ `jobs/{job_no}/…` ถ้าเลขงานถูกออกซ้ำหลัง dump ไฟล์จะไปโผล่ที่งานอื่น · ลิงก์ `/track` ที่ส่งให้ลูกค้าก่อน dump จะใช้ไม่ได้ (0012 สร้าง token ใหม่) · เอกสารที่พิมพ์จากระบบใหม่ก่อน dump จะมีเลขที่ไปซ้ำกับเอกสารใหม่

👤 **ตัดสินใจ: โหลดเข้าที่ไหน**

| | A. โปรเจกต์ Supabase ใหม่ (แนะนำ) | B. dump ทับโปรเจกต์เดิม |
|---|---|---|
| ข้อมูลค้างจากการทดสอบ | ไม่มี | ต้องลบ `job_symptom` / `track_*` / `idempotency_key` · `audit_log` ลบไม่ได้ |
| migration | journal ว่าง → Render preDeploy รันให้เอง | ต้อง `db:migrate:reset` ด้วยมือ |
| ไฟล์ (~2 GB) | อัปโหลดใหม่ทั้งหมด (`upload all`, ใช้เวลานานหลายชั่วโมง) | ข้ามไฟล์ที่อัปไว้แล้ว |
| ค่าที่ต้องเปลี่ยน | Render: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, publishable / secret key, ตั้ง `ALTER ROLE` (TimeZone / statement_timeout) ใหม่ · ย้าย `document_profile` / `shipping_profile` ด้วยมือ | ไม่ต้อง |
| ถอยกลับ | โปรเจกต์เดิมยังอยู่ครบ | ต้องกู้จาก backup ของ Supabase |

## ผู้รับผิดชอบ

| บทบาท | ใคร | หน้าที่ |
|---|---|---|
| เจ้าของ | _👤_ | ประกาศวันปิดระบบเก่า, ตัดสิน go / no-go, เลือก A/B |
| ผู้ดูแลระบบเก่า | _👤_ | ตั้งระบบเก่าให้อ่านอย่างเดียว, dump, คัดลอกโฟลเดอร์ไฟล์ |
| dev | _👤_ | แปลงไฟล์, โหลด, migrate, รัน reconcile, อัปไฟล์, Render |
| หัวหน้าแต่ละแผนก | _👤_ | ทดสอบเข้าใช้งานและตรวจตัวเลขของแผนกตัวเอง |

## ก่อนวันเปิด (T−7 ถึง T−1)

- [ ] 👤 ตัดสินใจเรื่องที่ค้างใน `docs/production-readiness.md` § "ข้อที่ต้องให้เจ้าของตัดสินใจ" ที่กระทบข้อมูลตั้งต้น: สต๊อก 15 สินค้า (ลงเอกสารปรับยอดหลังเปิดระบบ หรือแก้ในระบบเก่าก่อน dump), คำขอเบิกค้าง 245 บรรทัด, 48 งานที่ชี้ใบเสนอราคาที่ปฏิเสธไปแล้ว, จะกู้ไฟล์ที่หายหรือไม่ · `docs/data-cleanup*.sql` **ยังไม่ได้รัน** ตัดสินใจว่าจะรันหลังโหลดหรือไม่
- [ ] 👤 **ผูกอีเมลผู้ใช้ 38–40 คน** ถ้าผูกในระบบใหม่ก่อน dump อีเมลจะหาย → เลือกทางใดทางหนึ่ง: (1) ใส่อีเมลในระบบเก่า (`User.EmailAddress`) ก่อน dump หรือ (2) ผูกในหน้าผู้ใช้หลังโหลด **ก่อนเปิดให้พนักงานเข้า** (ต้องมี System Admin ที่มีอีเมลอย่างน้อย 1 คน ตอนนี้มี 2 คน)
- [ ] 👤 ถ้ามีการแก้สิทธิ์ในหน้าสิทธิ์ของระบบใหม่ไว้ ให้จดไว้ เพราะ dump จะล้าง `app_config` จะได้ใส่กลับหลังโหลด
- [ ] dev ซ้อมทั้งชุดกับ dump ล่าสุดบน Postgres ชั่วคราว: `convert.py` → 01/02/03 → migration ทั้งหมด → `recon.sql` (ด้านล่าง) → `diff` ต้องต่างกันแค่ `app_config` และจับเวลาแต่ละขั้นไว้ใช้วางแผนวันจริง
- [ ] dev ถ้าเลือก A: สร้างโปรเจกต์, ตั้ง `ALTER DATABASE/ROLE … SET timezone='Asia/Bangkok'`, `statement_timeout`, เตรียม env ใน Render dashboard (`render.yaml` ไม่ sync), เริ่มอัปรูปและไฟล์แนบล่วงหน้าได้ (`upload` ข้ามไฟล์ที่มีแล้ว)
- [ ] 👤 แจ้งพนักงาน: วันและเวลาที่ระบบเก่าหยุดรับข้อมูล, งานที่รับระหว่างนั้นให้จดใส่กระดาษ

## วันเปิด (ลำดับ)

| # | ใคร | ทำอะไร | ตรวจ |
|---|---|---|---|
| 1 | เจ้าของ | ประกาศหยุดใช้ระบบเก่า | |
| 2 | ผู้ดูแลระบบเก่า | ตั้งระบบเก่าให้**อ่านอย่างเดียว** (`ALTER DATABASE SHDElectronicServiceDB SET READ_ONLY` หรือถอนสิทธิ์เขียนของ login ที่เว็บใช้) · จดเลขเอกสารล่าสุด J / Q / SO / WHI / WHO | ลองบันทึกในระบบเก่าแล้วต้องไม่ผ่าน |
| 3 | dev | Render: เปิด**โหมดปิดปรับปรุง** (ดู "โหมดปิดปรับปรุง" ด้านล่าง) · ปิด Auto-Deploy (Settings → Auto-Deploy: Off) · ถ้าเลือก B: สั่ง backup โปรเจกต์ Supabase | เปิดหน้าใดก็ได้ / `/track` เห็น "ระบบปิดปรับปรุง" (HTTP 503) · `/api/health` มี `"maintenance":true` |
| 4 | ผู้ดูแลระบบเก่า | backup `.bak` + SSMS Generate Scripts (data only + schema, UTF-16) → `setupdata/data.sql` · คัดลอก `FileUpload/` และ `ImagesProduct/` ชุดล่าสุด | |
| 5 | dev | `python3 convert.py data.sql out` → ได้ `rowcounts.txt` ใหม่ · โหลดเข้า Postgres ชั่วคราว (ไม่ต้อง migrate) → `recon.sql` → `recon_legacy.txt` | ผลรวม rowcounts = จำนวน INSERT ใน data.sql |
| 6 | dev | โหลดเข้าปลายทาง (`load_supabase.sh` ใช้ Session pooler port 5432 เท่านั้น) | สคริปต์เทียบ row count ผ่าน |
| 7 | dev | migrate: A = deploy ให้ preDeploy รัน · B = `ALLOW_PROD_DB=1 npm run db:migrate:reset` | 36/36 ไฟล์ · NOTICE เฉพาะ 3 บรรทัดของ 0031 · **ไม่มี** NOTICE ของ 0022 (เลขเอกสารซ้ำ) |
| 8 | dev | B เท่านั้น: `DELETE FROM job_symptom; DELETE FROM track_ticket, track_session, track_doc_ticket, track_otp, track_event, track_rate, track_block; DELETE FROM idempotency_key;` (👤 ยืนยันก่อน) | |
| 9 | dev | `recon.sql` บนปลายทาง → `diff recon_legacy.txt recon_prod.txt` | ตามเกณฑ์ go / no-go |
| 10 | dev | `npm run files:validate` → `npm run files:upload` → `validate` อีกรอบ | `uploadable = 0` |
| 11 | เจ้าของ + dev | ผูกอีเมลผู้ใช้ที่เหลือ, ใส่สิทธิ์ที่จดไว้กลับ, ตรวจ `document_profile` / `shipping_profile` | `active_users_without_email` = 0 หรือเหลือแค่คนที่ยืนยันว่าไม่ใช้แล้ว |
| 12 | dev | admin เปิดลิงก์ bypass แล้วเปิด `/api/health` (ยังอยู่ในโหมดปิดปรับปรุง) | DB ok, TZ = `Asia/Bangkok` |
| 13 | หัวหน้าแผนก | เปิดลิงก์ bypass ก่อน แล้วทดสอบเข้าใช้งาน และเปิดงาน / ใบเสนอราคา / ใบสั่งขาย / สต๊อกของแผนกตัวเองดู (**อย่าเพิ่งสร้างเอกสาร**) | ตัวเลขตรงกับระบบเก่า |
| 14 | เจ้าของ | go / no-go | |
| 15 | dev → ทุกคน | ลบ `MAINTENANCE_MODE` ใน Render → Save and deploy → เปิด Auto-Deploy คืน · เปิดใช้ · คีย์งานที่จดกระดาษไว้ระหว่างปิดระบบ | หน้าเว็บเปิดได้โดยไม่ใช้ bypass (ไม่ใช่ 503) · ดู "หลังเปิด" |

### โหมดปิดปรับปรุง (`src/lib/maintenance.ts`)

แทนการ Suspend: ทุกหน้า (รวม `/track` ของลูกค้า) ตอบ 503 พร้อมหน้า "ระบบปิดปรับปรุง" · ทุก `/api/*` ตอบ 503 JSON · `/api/health` ยังตอบ 200 (Render health check ผ่าน) · ไฟล์ static โหลดได้

1. Render → Environment: `MAINTENANCE_MODE` = `1` · `MAINTENANCE_UNTIL` = เวลาที่คาดว่าจะเปิด เช่น `21 ต.ค. 18:00` (ไม่ใส่ก็ได้) · `MAINTENANCE_BYPASS_SECRET` = `openssl rand -hex 16` (อย่างน้อย 16 ตัว)
2. **Save and deploy** — ค่า env มีผลหลัง deploy / restart เท่านั้น (รอ deploy เสร็จ ~ไม่กี่นาที)
3. ทีมที่ต้องตรวจระบบก่อนเปิด: เปิด `https://<โดเมน>/?maintenance_bypass=<secret>` ครั้งเดียวต่อเบราว์เซอร์ → เข้าแอปจริงได้ 12 ชม. (cookie `__Host-os_maint`) · ส่ง secret ทางช่องทางส่วนตัวเท่านั้น
4. เปิดระบบ: ลบ `MAINTENANCE_MODE` → Save and deploy · เปลี่ยน / ลบ `MAINTENANCE_BYPASS_SECRET` หลังใช้ (secret ผ่าน URL log มาแล้ว)

## เกณฑ์ go / no-go

ทุกข้อต้องผ่าน ถ้าข้อไหนไม่ผ่าน = no-go เว้นแต่เจ้าของยอมรับเป็นรายข้อ 👤

| ตรวจ | เกณฑ์ | ยอมให้ต่าง |
|---|---|---|
| จำนวนแถว 52 ตาราง | = `rowcounts.txt` ชุดสุดท้าย · ยกเว้น `app_config` = เดิม + จำนวนแถวที่ 0029/0030 เพิ่ม (dump นี้ +20) | 0 |
| เงินรายปี (งาน, อะไหล่, ใบเสนอราคา, ใบสั่งขาย) | = `recon_legacy.txt` | 0.00 บาท |
| จำนวนตามสถานะ (งาน / ใบเสนอราคา / ใบสั่งขาย) | = `recon_legacy.txt` | 0 |
| สต๊อก `stock_total` และรายการ `stock_ne_card` | = `recon_legacy.txt` (dump นี้ 15 สินค้า) | 0 |
| `running_no` ปีปัจจุบัน | `number` ≥ `max_used` ทุกชุด | 0 |
| แถวกำพร้า `orphan_*` | 0 | 0 |
| migration | 36/36 · NOTICE เฉพาะที่รู้จัก | — |
| ไฟล์ | `uploadable = 0` · จำนวนที่หาไม่เจอไม่เกินค่าอ้างอิง (1,453 / 980 / 56 / 36) + ไฟล์ที่เพิ่มหลัง 2026-09-15 | 👤 |
| เข้าระบบ | admin 1 คน + หัวหน้าแผนกละ 1 คนเข้าได้และเห็นเมนูถูกต้อง | 0 |

## คำสั่ง reconcile (อ่านอย่างเดียว)

`psql "$URL" -X -At -F'|' -f recon.sql > recon_<db>.txt` บนทั้งสองฐาน แล้ว `diff` (ไฟล์เดียวกับที่ dev ใช้ตรวจ dump นี้)

```sql
BEGIN READ ONLY;
-- 1. จำนวนแถว 52 ตาราง
SELECT 'rows', t, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', t), false, true, '')))[1]::text
FROM unnest(ARRAY['app_back_up_db_log','app_config','app_user','approve_status','category','color','condition','customer','document_attach',
 'inventory_dt','inventory_hd','inventory_type','job','job_call_log','job_close_temp','job_create_temp','job_log','job_order_spare_part_log',
 'job_order_spare_part_status','job_return_dt','job_return_hd','job_send_forward_dt','job_service_code','job_status','job_type','manufacturer',
 'model','model_color','model_part','model_tier','mt_city','mt_district','mt_sub_district','product','product_model','product_none_serial',
 'product_serial','product_type','quotation_dt','quotation_hd','quotation_status','quotation_temp','running_no','sale_in_dt','sale_in_hd',
 'sale_out_dt','sale_out_hd','service_cost','store_location','symptom','temp_model','temp_spare_part']) t ORDER BY 2;
-- 2. เงินรายปี
SELECT 'job', to_char(job_create_date,'YYYY'), count(*), sum(job_total_cost), sum(deposit_cost), sum(job_payment_amount), sum(spare_part_total_cost), sum(service_cost) FROM job GROUP BY 2 ORDER BY 2;
SELECT 'part_log', to_char(request_date,'YYYY'), count(*), sum(spare_part_total_price), sum(request_qty), sum(grant_qty), sum(return_qty) FROM job_order_spare_part_log GROUP BY 2 ORDER BY 2;
SELECT 'quotation', to_char(create_date,'YYYY'), count(*), sum(net_amount), sum(vat_amount), sum(discount_amount) FROM quotation_hd GROUP BY 2 ORDER BY 2;
SELECT 'quotation_dt', count(*), sum(nullif(replace(total_price::text,',',''),'')::numeric) FROM quotation_dt;
SELECT 'sale_order', to_char(document_create_date,'YYYY'), count(*), sum(net_amount), sum(payment_amount) FROM sale_out_hd GROUP BY 2 ORDER BY 2;
SELECT 'sale_order_dt', count(*), sum(amount_dt), sum(sale_out_quantity) FROM sale_out_dt;
-- 3. จำนวนตามสถานะ
SELECT 'job_status', job_status_id, count(*) FROM job GROUP BY 2 ORDER BY 2;
SELECT 'quotation_status', quotation_status_id, count(*), sum(net_amount) FROM quotation_hd GROUP BY 2 ORDER BY 2;
SELECT 'so_approve_status', approve_status_id, count(*), sum(net_amount) FROM sale_out_hd GROUP BY 2 ORDER BY 2;
-- 4. สต๊อก: ยอดรวม + สินค้าที่คงเหลือ ≠ Stock Card
SELECT 'stock_total', count(*), sum(quantity_remain), sum(quantity_available), sum(quantity_used), sum(quantity_booking) FROM product_none_serial;
WITH card AS (SELECT d.item_code, sum(d.item_quantity * coalesce(t.movement_action,1)) q FROM inventory_dt d
  JOIN inventory_hd h USING (inventory_no) LEFT JOIN inventory_type t USING (inventory_type_id) WHERE h.is_active IS DISTINCT FROM false GROUP BY 1)
SELECT 'stock_ne_card', p.product_code, s.quantity_remain, coalesce(c.q,0)::int FROM product p
  LEFT JOIN product_none_serial s USING (product_id) LEFT JOIN card c ON c.item_code = p.product_code
 WHERE coalesce(s.quantity_remain,0) <> coalesce(c.q,0) ORDER BY 2;
-- 5. เลขเอกสาร: เลขถัดไป (number+1) ต้องมากกว่าเลขสูงสุดที่ใช้แล้ว (ปีปัจจุบัน)
SELECT 'running_no', r.running_type, r.pyear, r.number,
  (SELECT max(substring(no from '[0-9]{5}$')::int) FROM (
     SELECT job_no no FROM job WHERE r.running_type='Job' UNION ALL SELECT quotation_no FROM quotation_hd WHERE r.running_type='Quotation'
     UNION ALL SELECT sale_out_hd_no FROM sale_out_hd WHERE r.running_type='SaleOrder'
     UNION ALL SELECT inventory_no FROM inventory_hd WHERE r.running_type IN ('Inventory-In','Inventory-Out') AND inventory_no LIKE r.prefix||'%') x
   WHERE no LIKE r.prefix || right(r.pyear::text, 2) || '%') AS max_used
FROM running_no r WHERE r.pyear = extract(year from now())::int AND (r.running_type NOT IN ('Job','Quotation','SaleOrder') OR r.company_id = (SELECT max(company_id) FROM running_no r2 WHERE r2.running_type = r.running_type AND r2.pyear = r.pyear))
ORDER BY 2;
-- 6. แถวกำพร้า (ต้องเป็น 0) + sentinel ที่รู้จัก
SELECT 'orphan_job_customer', count(*) FROM job j WHERE j.customer_id > 0 AND NOT EXISTS (SELECT 1 FROM customer c WHERE c.customer_id = j.customer_id);
SELECT 'orphan_job_log', count(*) FROM job_log l WHERE NOT EXISTS (SELECT 1 FROM job j WHERE j.job_no = l.job_no);
SELECT 'orphan_part_log', count(*) FROM job_order_spare_part_log l WHERE NOT EXISTS (SELECT 1 FROM job j WHERE j.job_no = l.job_no);
SELECT 'orphan_attach', count(*) FROM document_attach a WHERE NOT EXISTS (SELECT 1 FROM job j WHERE j.job_no = a.reference_item_code);
SELECT 'orphan_quotation_dt', count(*) FROM quotation_dt d WHERE NOT EXISTS (SELECT 1 FROM quotation_hd h WHERE h.quotation_no = d.quotation_no);
SELECT 'orphan_sale_out_dt', count(*) FROM sale_out_dt d WHERE NOT EXISTS (SELECT 1 FROM sale_out_hd h WHERE h.sale_out_hd_no = d.sale_out_hd_no);
SELECT 'orphan_inventory_dt', count(*) FROM inventory_dt d WHERE NOT EXISTS (SELECT 1 FROM inventory_hd h WHERE h.inventory_no = d.inventory_no);
SELECT 'sentinel_sale_out_dt_product_-1', count(*) FROM sale_out_dt WHERE product_id = -1;
SELECT 'sentinel_product_manufacturer_-1', count(*) FROM product WHERE manufacturer_id = -1;
-- 7. ผู้ใช้ที่ใช้งานอยู่แต่ไม่มีอีเมล (SSO เข้าไม่ได้จนกว่าจะผูก)
SELECT 'active_users_without_email', count(*) FROM app_user WHERE is_active AND btrim(coalesce(email_address,'')) = '';
ROLLBACK;
```

ค่าอ้างอิงจาก dump นี้ (ข้อมูลถึง 2026-09-14): งาน 48,613 (ปี 2026: 12,164 งาน ยอดรวม 502,320.50 รับแล้ว 363,280) · ใบเสนอราคา 3,035 (net รวม 4,671,531.70) · ใบสั่งขาย 3,866 (net 2,157,434 = ผลรวมรายการ) · สต๊อก 2,550 แถว คงเหลือรวม 2,980 จอง 560 · ผู้ใช้ไม่มีอีเมล 38

## แผนถอยกลับ

- **ก่อนเปิดให้พนักงานใช้ (ขั้น 1–14):** no-go = ยังไม่มีใครเขียนข้อมูลในระบบใหม่ → ผู้ดูแลระบบเก่าเปิดสิทธิ์เขียนคืน (`SET READ_WRITE`) แล้วใช้ระบบเก่าต่อ · dev คงโหมดปิดปรับปรุงไว้ (หรือ suspend Render) · ถ้าเลือก B ให้กู้ backup จากขั้น 3
- **หลังเปิดแล้ว:** ระบบเก่าเปิดค้างไว้แบบ**อ่านอย่างเดียว 👤 N วัน (แนะนำ 30 วัน)** เพื่อดูย้อนหลังและเทียบตัวเลข · ถอยกลับได้ถึง 👤 วันที่ … เท่านั้น
  - วิธีถอย: ดึงรายการเอกสารที่สร้างหลังเปิดจาก `audit_log` (`action IN ('CREATE','ISSUE','RECEIVE','APPROVE')` และ `at >=` เวลาเปิด) → คีย์กลับเข้าระบบเก่าด้วยมือ → เปิดสิทธิ์เขียนระบบเก่า
  - หลังวันที่กำหนด = ไม่ถอยแล้ว แก้ไปข้างหน้าอย่างเดียว · เก็บ `.bak` ชุดสุดท้ายไว้อย่างน้อย 👤 1 ปี

## หลังเปิด (วันแรก → สัปดาห์แรก)

- [ ] งานแรกที่ออก = **เลขงานล่าสุดของระบบเก่า + 1** (dump นี้ J2612165) · ตรวจแบบเดียวกันกับ ใบเสนอราคา / ใบสั่งขาย / รับเข้า WHI / จ่ายออก WHO ฉบับแรก
- [ ] ไม่มี error 409 "ข้อมูลซ้ำ" ตอนสร้างเอกสาร (unique index 0022 / 0031)
- [ ] สต๊อก: เปิดสินค้า 15 รายการใน `stock_ne_card` ดู ยอดต้องเท่ากับก่อนเปิด จนกว่าจะลงเอกสารปรับยอดตามที่เจ้าของตัดสิน · สุ่มสินค้าที่มีการเบิกวันแรก 5 รายการ เทียบคงเหลือกับ Stock Card
- [ ] ผู้ใช้ทุกคนเข้าระบบได้ (หน้าผู้ใช้: `last_login` ไม่ว่าง ภายใน 3 วัน) · ไม่มีบัญชีใหม่ที่ไม่มีสิทธิ์โผล่ขึ้นมา ถ้ามี แปลว่าผูกอีเมลผิดคน หรือยังไม่ได้ผูก
- [ ] แนบไฟล์ใหม่และเปิดไฟล์เก่าได้ · ลิงก์ `/track` ของงานใหม่ใช้ได้
- [ ] `/api/health` ok · Render log ไม่มี `API contract drift` หรือ 5xx ผิดปกติ
- [ ] สิ้นวันที่ 1 / 3 / 7: นับเอกสารใหม่ (`job`, `quotation_hd`, `sale_out_hd`, `inventory_hd` ที่ `create_date >=` เวลาเปิด) เทียบกับที่หน้างานจดไว้ และรันส่วนที่ 4 (สต๊อก) ของ `recon.sql` อีกรอบ รายการ `stock_ne_card` ต้องไม่เพิ่มขึ้น
- [ ] หลัง 1 เดือน: ดู `pg_stat_user_indexes` (DB-7) · ลบตารางที่ไม่ใช้ (DB-6)
