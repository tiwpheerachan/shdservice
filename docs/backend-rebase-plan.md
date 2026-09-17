# Backend rebase — แผนและ business rule ที่อนุมานจากข้อมูลจริง

> สถานะ: **implement เสร็จ ทดสอบกับ Postgres local ที่โหลด dump แล้ว** (2026-09-15) — ยังไม่ได้ต่อ Supabase จริง (รอ `DATABASE_URL`)
> ที่มา: วิเคราะห์ dump `SHDElectronicServiceDB` 52 ตาราง / 420,113 แถว (job ล่าสุด 2026-09-14 17:11) บน Postgres local
> หลักการ: **DB legacy เป็น source of truth** — ชื่อ field / ค่า / รูปแบบเลขเอกสาร ยึดตาม DB, UI คง layout เดิม

---

## 0. ข้อตกลงที่ได้แล้ว

| เรื่อง | ตัดสินใจ |
|---|---|
| ฐานข้อมูล | Supabase project เดิม (โหลด legacy แล้ว) · re-dump ก่อน go-live ผู้ใช้ทำเอง → migration ต้องรันซ้ำได้หลัง reload |
| ORM / migration | drizzle-orm + drizzle-kit · `npm run db:migrate` |
| Login | Central SSO เดิม · provision ลง `app_user` (จับคู่ `email_address`) · **drop `users`** |
| ผู้ใช้ระบบ | หน้า "ผู้ใช้ระบบ" = `app_user` **ทุกคน** — admin เพิ่มคน/กำหนด role ได้เลยไม่ต้องรอ login (แก้ 2026-09-15) · login SSO ทีหลังจับคู่ด้วย email แล้วได้ role ที่ตั้งไว้ · dropdown ช่าง/ผู้เปิดงาน/พนักงานขาย = ทุกคนที่ `is_active` |
| Role | = `app_user.user_type` (System Admin, Customer Service, Engineer, Head Engineer, Stock, Salesman, Manager, Account, Audit, Call Center) · รออนุมัติ = `user_type IS NULL` · approve ครั้งแรก default **Customer Service** |
| Permission | `app_config` (user_type × module_name × can_insert/edit/delete/view) · **บังคับที่ API + ซ่อนเมนู/ปุ่ม** · ไม่เพิ่ม module · หน้า admin/* และ reports/* = System Admin เท่านั้น |
| ตาราง mock 19 ตัว | drop ทั้งหมด (ย้ายคนใน `users` → `app_user` ก่อน) |
| ชนิดคอลัมน์ legacy | ไม่แก้ (re-dump จะทับ) · parse ในแอป · `timestamp` เขียนเวลาไทย · sentinel `1900-01-01` / `-1` / `0` = ว่าง |

### 0.1 การแก้ UI ที่หลีกเลี่ยงไม่ได้ (ขอ confirm)

ฟอร์มทุกตัวตอนนี้เป็น **static** (`defaultValue`, ไม่มี state, ปุ่มบันทึกแค่ toast) → จะ CRUD จริงต้องเดินสายฟอร์ม:
- เพิ่ม `value/onChange` + submit handler ใน `job-form.tsx`, `quotation-form.tsx`, `sale-order-form.tsx`, หน้า customers / stock receive / pick / master-table
- **ไม่เปลี่ยน** markup, class, layout, ข้อความ, ลำดับ field
- dropdown ที่ hardcode (`TECHNICIANS`, `OUTSOURCE_VENDORS`, `PROVINCES`, `ROLES`) เปลี่ยนเป็นดึงจาก DB (`app_user`, `job_send_forward_dt.send_to_name` distinct, `mt_city`, `app_config.user_type`)
- ค่าคงที่ที่เป็นชื่อสถานะ/ประเภท (`JOB_STATUS_OPTIONS`, `JOB_TYPE_OPTIONS`, `CHANNELS`, `RETURN_METHODS` …) ตรงกับ DB อยู่แล้ว → คงเป็น const แต่ **แก้ให้ตรง DB 100 %** (เช่น "พ้นกำหนดเสนอราคา" → DB สะกด "พันกำหนดเสนอราคา")
- Permission: sidebar กรองตาม `can_view`, ปุ่มเพิ่ม/แก้ไข/ลบซ่อนตาม `can_insert/can_edit/can_delete`

---

## 1. Module ↔ หน้า (สำหรับ permission)

| module (`app_config.module_name`) | หน้า |
|---|---|
| Job Management | /jobs/dashboard, /jobs/list, /jobs/new, /jobs/edit, /jobs/swap-refund |
| Job Assign | /jobs/assign |
| Job Repair | /jobs/repair, /jobs/outsource |
| Job Closing | /jobs/close |
| Product | /stock/products |
| Product Onhand | /stock/inventory |
| Product Receive Stock | /stock/receive |
| Product Pick Stock | /stock/pick |
| Customer | /customers |
| Quotation | /quotation/* |
| Sale Order | /sale/orders/* |
| *(System Admin เท่านั้น)* | /admin/*, /reports/* |

---

## 2. เลขเอกสาร (`running_no`) — อนุมานจากข้อมูล

รูปแบบ = `prefix` + (ปี ค.ศ. 2 หลัก ถ้า `length_year=2`) + running เติมศูนย์ `length_number` หลัก

| running_type | ตัวอย่าง | reset รายปี | หมายเหตุ |
|---|---|---|---|
| Job | `J2612164` | ใช่ | มีแถวเดียว (pyear อัปเดตเมื่อขึ้นปีใหม่) |
| Quotation | `Q2600462` | ใช่ | แถวใหม่ต่อปี |
| SaleOrder | `SO2600760` | ใช่ | แถวเดียว |
| Inventory-In | `WHI2601406` | ใช่ | แถวใหม่ต่อปี |
| Inventory-Out | `WHO2602247` | ใช่ | แถวใหม่ต่อปี |
| Customer | `C43601` | ไม่ | |
| Product | `P02551` | ไม่ | |
| Model | `MD01174` | ไม่ | |

**Rule:** ใน transaction เดียว → `SELECT … FOR UPDATE` แถว `(running_type, pyear = ปีปัจจุบัน หรือ 0)` ถ้าไม่มีให้ insert `number=0` → `number+1` → ประกอบเลข → ใช้เลขนั้น

---

## 3. งานบริการ (`job` + `job_log`)

**ข้อเท็จจริง:** `job_log` มี 1 แถวต่อการเปลี่ยนสถานะ (48,613/48,613 งาน แถวแรกเป็นสถานะ 1 และ `job.job_status_id` = สถานะล่าสุดใน log เสมอ) → **ทุกครั้งที่เปลี่ยน `job_status_id` ต้อง insert `job_log (job_no, job_status_id, now, user_id)`**

`job_status_group`: Pending / Repaired / Finished / Cancel → ใช้ทำ Dashboard 4 กลุ่ม

| หน้า | เขียนอะไร | สถานะใหม่ (`job_status_id`) |
|---|---|---|
| เปิดงานใหม่ | `job` (job_no จาก running J, `job_create_by`, `customer_id` + `customer_detail` = `"{code} {name} {phone}"`, product_*, symptom, reception_*, sale_out_channel/shop/date, warranty) · ลูกค้าใหม่ → insert `customer` (running C) · แนบไฟล์ → `document_attach (reference_topic='Jobs', reference_item_code=job_no)` | 1 งานใหม่ |
| แก้ไขข้อมูลงาน | update `job` field เดิม (ไม่เปลี่ยนสถานะ) | — |
| จนท.รับมอบหมายงาน | `engineer_id` (เลือกได้หลายงาน) | 2 อยู่ระหว่างดำเนินการ |
| บันทึกงานซ่อม | `engineer_symptom_id`, `engineer_repair_detail`, `engineer_remark`, `product_serial` (new S/N), ค่าใช้จ่าย · ตารางอะไหล่ → `job_order_spare_part_log` (ดูข้อ 5) · `job_repaired_date/by` เมื่อเลือกสถานะกลุ่ม Repaired | เลือกจาก 12 สถานะ REPAIR |
| ส่งซ่อมต่อ (Out-Source) | insert `job_send_forward_dt` (send_status "ส่งเครื่องซ่อมแล้ว") · รับคืน → update แถวเดิม `receive_*`, send_status "รับเครื่องซ่อมแล้ว" | 14 ส่งซ่อม Out-Source / 15 รับคืนจาก Out-Source |
| Swap / Refund | `swap_refund_detail`, `swap_refund_document_no`, `product_serial` (new S/N), `job_payment_*` (กรณี refund) | 18 เบิกสินค้าใหม่แล้ว / 19 เบิกจ่ายเงินแล้ว / 21 ปิดงาน Refund |
| ปิดงาน-ส่งคืน | `job_payment_type/no/amount/detail/slip`, `job_return_date`, `return_customer_type/tracking_no/detail`, `job_return_by`, `job_closed_date/by` | 7 / 8 / 24 / 20 (CLOSE_STATUS) |
| ยกเลิกข้อมูล (ลบ) | soft-delete = สถานะ 0 | 0 ยกเลิกข้อมูล |

**Field mapping → type `Job` ของ UI (รายการงาน)**
`no ← job_no` · `openDate ← job_create_date` · `customer ← customer_detail` · `so ← job_reference_no` (เลขคำสั่งซื้อ Shopee/Lazada) · `brandModel ← manufacturer_name + ' ' + product_model_name` · `jobType ← job_type_name` · `owner ← app_user(engineer_id) first+last` · `status ← job_status_name` · `imei ← product_imei_no` · `amount ← job_total_cost`

`job_total_cost = spare_part_total_cost + service_cost + service_tool_cost + delivery_cost + carton_box_cost` (ตรง 48,584/48,613)

**Dashboard** (คำนวณสดแทนตาราง mock): กลุ่ม 4 = นับ `job` ตาม `job_status_group` · TAT = `now − job_create_date` ของงานที่ยังไม่ Finished/Cancel แบ่งช่วง 1–3/4–7/8–14/15–30/>30 วัน ต่อสถานะ · รายเดือน = นับ `job_create_date` / `job_closed_date` 12 เดือนล่าสุด · อาการเสียยอดนิยม = นับ `product_symptom_id` → `symptom_name`

---

## 4. ลูกค้า (`customer`)

- `customer_code` จาก running C · `customer_type` (Normal/Corporate/Dealer) · `use_price_group` = "Retail" (ค่าใน DB; UI แสดง "ขายปลีก (Retail Price)" → map) · `is_active`
- ที่อยู่: UI มี เลขที่ / ซอย-ถนน / จังหวัด / อำเภอ / ตำบล / ไปรษณีย์ → `customer_address1`, `customer_address2`, `city_id`, `district_id`, `sub_district_id`, `postal_code` และ **ประกอบ `customer_address` เป็นข้อความเต็ม** (แบบเดิม) · dropdown จังหวัด/อำเภอ/ตำบล ดึงจาก `mt_city / mt_district / mt_sub_district`
- mapping `Customer`: `code ← customer_code` · `name ← customer_name` · `address ← customer_address` · `phone ← phone_number` · `email` · `line ← line_id` · `taxId ← customer_card_id` · `status ← is_active`

---

## 5. อะไหล่และสต๊อก

**ข้อเท็จจริง (ยืนยันด้วยตัวเลข):**
- มีคลังเดียว (`store_location_id=1` คลังสินค้าดี), condition เดียว, `is_serial_control=false` ทุกตัว → ใช้ `product_none_serial` 1 แถว/สินค้า
- `quantity_available` = ยอดรับเข้าสะสม (= Σ WHI **2,197/2,197**) · `quantity_used` = ยอดจ่ายออกสะสม (= Σ WHO 2,139/2,197) · `quantity_remain = available − used` (2,544/2,550) · `quantity_booking` = จองจากใบเบิกที่ยังไม่จ่าย (ค่าใน DB เพี้ยนอยู่แล้ว 156/158 แถว — จะดูแลต่อแต่ไม่ใช้ตัดสินใจ)
- ทุกการเคลื่อนไหว = `inventory_hd` (เลข WHI/WHO, `inventory_type_id` 1–5, `item_type='SparePart'`, `reference_document_no`, `create_by`) + `inventory_dt` (`item_code=product_code`, `item_quantity`, `item_unit='Pcs.'`, `store_location_id=1`, `stock_type_id=1`)

| หน้า / เหตุการณ์ | inventory_type | reference | ผลต่อ `product_none_serial` |
|---|---|---|---|
| รับเข้าอะไหล่ | 1 รับเข้า (WHI) | PO/Supplier ใน `inventory_remark` | available += q, remain += q |
| รับคืนจากการเบิก (งานซ่อมคืนอะไหล่) | 2 (WHI) | job_no | used −= q, remain += q · `job_order_spare_part_log` → 5 คืนแล้ว |
| จ่ายออกตามงานซ่อม (ตัดจ่ายให้ใบเบิก) | 3 (WHO) | job_no | used += q, remain −= q, booking −= q · log → 3 จ่ายแล้ว (grant_qty/date/by) |
| จ่ายออกตามใบสั่งขาย (ตอนอนุมัติ SO) | 4 (WHO) | SO no | used += q, remain −= q · `sale_out_dt.pick_inventory_no`, `sale_out_hd.reference_no` = WHO |
| จ่ายออกอื่นๆ | 5 (WHO) | `reference_out_to` ข้อความ | used += q, remain −= q |

**ใบเบิกอะไหล่ในงานซ่อม (`job_order_spare_part_log`)**: ช่างเพิ่มรายการ → status 1 เบิก (`request_qty/date/by`, booking += q, `is_quotation`/`is_special` = ตาราง A, `*_b` = ตาราง B, job → 11 เริ่มเบิกอะไหล่) → คลังตัดจ่ายที่หน้า "ตัดจ่ายอะไหล่" ประเภท "จ่ายออกตามงานซ่อม" (ดึงรายการค้างของ job_no นั้น) → 3 จ่ายแล้ว; เมื่อจ่ายครบทุกรายการ job → 10 เบิกจ่ายอะไหล่ครบแล้ว

**mapping `Product`**: `sysCode ← product_code` · `mfgCode ← product_vender_code` · `name ← product_name` · `category ← category_name` · `brand ← manufacturer_name` · `onhand ← quantity_remain` · `price ← retail_price` · `status ← is_active`
**mapping `Movement`**: `doc ← inventory_no` · `type ← inventory_type_name` · `ref ← reference_document_no` · `date ← create_date` · `by ← app_user(create_by)` · `from/to ← คลังสินค้าดี / reference_out_to` · `remark ← inventory_remark`

สร้างอะไหล่ใหม่: `product` (running P, `create_by`) + `product_none_serial` (qty 0, `retail_price`) + `product_model` (รุ่นที่ใช้ได้)

---

## 6. ใบเสนอราคา (`quotation_hd` / `quotation_dt`)

- เลข Q running · 1 ใบ/งานเป็นหลัก (3,013/3,023) · `customer_code` ต้องมีใน `customer` (3,035/3,035) · `quotation_type` = "Normal" (UI: Type A/B → เก็บ "Normal"/"VIP")
- รายการ: `quotation_dt` เฉพาะอะไหล่ (`item_type='SparePart'`, `item_code=product_code`, `unit='หน่วย'`, ตัวเลขเก็บเป็น string) + ค่าขนส่ง `item_type='Delivery'` · **ค่าบริการอยู่ใน header** `service_amount` (ไม่ใช่บรรทัด)
- ยอดเงิน (header): `spare_part_amount` = Σ dt · `sum_exclude_amount = spare_part + service` · ส่วนลด: `discount_type` (ไม่มี/รวม/ค่าบริการ/ค่าอะไหล่) + `discount_formula` ("10%" หรือ "200บาท") → `discount_amount` · `after_discount_amount` · `total_base_amount` · `vat_rate` (0/7) → `vat_amount` · `total_amount` · `rounding_amount` · `net_amount`
- **สถานะใบเสนอราคาไม่ sync กับสถานะงาน** (ตัดสินใจ 2026-09-15) — ช่างเปลี่ยนสถานะงานเองที่หน้าบันทึกซ่อม · เมื่อลูกค้าตกลงซ่อม (สถานะ 3/6/9) เก็บ `job.quotation_no_approved` + `customer_approve_date` เท่านั้น · ยกเลิกใบ (5) → `is_active=false`

- mapping `Quotation`: `no ← quotation_no` · `date ← create_date` · `type ← quotation_type` · `customer ← customer_name` (join) · `jobRef ← reference_job_no` · `imei/brandModel ← job` (join) · `amount ← net_amount` · `status ← quotation_status_name`

---

## 7. ใบสั่งขาย (`sale_out_hd` / `sale_out_dt`)

- เลข SO running · `document_type='SaleOrder'` · ลูกค้า snapshot ลง header (`customer_id/code/card_id/name/address/phone`) · `payment_type` (โอนเงิน/เงินสด/บัตรเครดิต), `payment_amount`, `slip_file_name` · `vat_rat=0` ทุกใบ · `net_amount = total_base_amount + fee_amount − rounding`
- รายการ: `sale_out_dt` (`product_id/code`, `product_type` SparePart|Service, `retail_price`, `sale_out_price`, `sale_out_quantity`, `amount_dt`, `onhand_item_id = product_none_serial.item_id`)
- Flow อนุมัติ (`approve_status`): 1 กำลังจัดทำ → 2 รออนุมัติ (บันทึก) → 4 อนุมัติแล้ว (`approve_date/by`; **ตัดสต๊อก WHO type 4 ตอนอนุมัติ** — 2,813/3,756 ใบ WHO ถูกสร้างวันเดียวกับ approve) / 5 ปฏิเสธ · 3 แก้ไขข้อมูล = ส่งกลับแก้
- `is_sale_out=true`, `sale_out_date/by` = เวลาบันทึก · `document_status=true` (ยกเลิก = false + `document_cancel_*`)
- mapping `SaleOrder`: `no ← sale_out_hd_no` · `date ← document_create_date` · `customer ← customer_name` · `amount ← net_amount` · `sales ← app_user(document_create_by)` · `approve ← approve_name_th` · `stockDoc ← reference_no` · `tracking ← delivery_tracking_no`

---

## 8. ข้อมูลระบบ (master)

| หน้า | ตาราง | mapping `MasterRow` (`id, name, detail, status, extra`) | unique |
|---|---|---|---|
| หมวดหมู่สินค้า | `category` | category_id, category_name, category_description, is_active, shot_code | category_name |
| ยี่ห้อ | `manufacturer` | manufacturer_id, manufacturer_name, logo_name, is_active | manufacturer_name |
| รุ่น (`Model`) | `model` | code←model_code (running MD), name←model_name, brand←manufacturer, price←market_price, updated←last_update, status←is_active | (model_name, manufacturer_id, is_active) |
| สี | `color` | id, color_name, description, is_active | — |
| ประเภทงานซ่อม | `job_type` | job_type_id, job_type_name, job_type_description, is_active | job_type_name |
| ประเภทเครื่องซ่อม | `product_type` | product_type_id, product_type_name, —, is_active | product_type_name |
| อาการเสีย | `symptom` | symptom_id, symptom_name, symptom_description, group←symptom_group_name, is_active | — |

ลบ = `is_active=false` (มุมมอง "รายการที่ลบ" = `is_active=false`) · กู้คืน = `true`

---

## 9. ผู้ใช้ / สิทธิ์

**migration เพิ่มใน `app_user`**: `lark_id varchar(50)`, `department varchar(100)`, `title varchar(100)`, `avatar text`, `last_login timestamp`, `deleted boolean default false` + unique index `lower(email_address)` (where not null)

**provision ตอน SSO callback**: หา `app_user` ด้วย email (ilike) → ไม่มีให้ insert (`username = email prefix`, `first_name/last_name` แยกจากชื่อ, `user_type NULL`, `is_active true`) → owner emails บังคับ `user_type='System Admin'` → อัปเดต `avatar/title/department/lark_id/last_login` → cookie เก็บ `role=user_type`, `approved = user_type IS NOT NULL AND is_active`

**mapping `User`**: `id ← user_id` · `code ← lark_id` · `name ← first_name + ' ' + last_name` · `username` · `role ← user_type ?? 'รออนุมัติ'` · `branch ← department` · `email ← email_address` · `phone ← phone_no` · `lastLogin ← last_login` · `status ← is_active ? Active : Inactive` · `avatar` · `title`

**mapping `Permission`**: `id ← config_id` · `role ← user_type` · `menu ← module_name` · `add/edit/del/view ← can_insert/can_edit/can_delete/can_view` — หน้า "สิทธิการใช้งาน" แสดง matrix role × 17 module ของ DB

**บังคับใช้**: helper `can(user_type, module, action)` อ่าน `app_config` (cache 60 s) → ทุก route handler ที่เขียนเช็คก่อน (403) · System Admin ผ่านทุกอย่าง · sidebar/ปุ่มอ่านสิทธิ์จาก `/api/me/permissions`

---

## 10. ไฟล์แนบ

`document_attach` เก็บ `reference_topic` ('Jobs'), `reference_item_code` (job_no), `original_file_name`, `system_file_name` → ไฟล์ใหม่อัปโหลดขึ้น **Supabase Storage bucket `attachments`** path `jobs/{job_no}/{system_file_name}` · ไฟล์เก่า 5,919 รายการไม่ย้าย (แสดงชื่อ, เปิดไม่ได้) · ใช้ `sale_out_hd.slip_file_name` / `job_payment_slip_file_name` แบบเดียวกัน

---

## 11. โครงสร้างโค้ดใหม่ (ไม่แตะ UI)

```
src/db/
  client.ts            # drizzle(node-postgres) — SERVER ONLY, DATABASE_URL
  schema/*.ts          # 52 ตาราง legacy + คอลัมน์เพิ่ม (snake_case ตรง DB)
  running-no.ts        # ออกเลขเอกสาร (FOR UPDATE)
src/server/
  auth.ts              # session → app_user, can()
  services/*.ts        # jobs, customers, products, stock, quotations, sale-orders, masters, users, dashboard
  mappers/*.ts         # แถว DB → type เดิมของ UI (Job, Product, …)
src/app/api/**         # route handlers: GET list / POST create / PATCH update / POST actions
src/data/db.ts         # hook ชื่อเดิม (useJobs …) → fetch('/api/...')   ← UI ไม่ต้องแก้ import
src/data/mock.ts       # เหลือเฉพาะ type + const ที่ตรง DB
drizzle/
  0000_baseline.sql    # legacy schema แบบ IF NOT EXISTS (รันซ้ำได้)
  0001_app.sql         # app_user +คอลัมน์, drop ตาราง mock, index
scripts/migrate.ts     # npm run db:migrate — ถ้า reload แล้ว journal ค้าง จะ reset ให้เอง
```

`.env` เพิ่ม `DATABASE_URL` (Session pooler :5432) · `@supabase/supabase-js` เหลือใช้เฉพาะ Storage ฝั่ง server

---

## 12. สิ่งที่ตัดสินใจเพิ่มระหว่างทำ

- **หน้าผู้ใช้ระบบ** แสดง `app_user` ทุกคน (ไม่ใช่เฉพาะที่ login SSO) — admin กำหนด role ล่วงหน้าได้
- **Server-side pagination**: `DataTable` มี `server` mode (หน้าตาเดิม) ใช้กับ รายการงาน / ลูกค้า / ใบเสนอราคา / ใบสั่งขาย; อะไหล่ (2.5k) และ master โหลดทั้งหมด
- **หลายอาการเสีย**: ตาราง `job_symptom` (migration 0002) + `job.product_symptom_id` = อาการแรก
- **`?job=` / `?no=`** ทุกหน้าที่เริ่มจากช่อง "ระบุหมายเลข" (แก้ไข/ซ่อม/outsource/swap/ปิดงาน/ใบเสนอราคา/ใบสั่งขาย) เปิดพร้อมข้อมูลได้จากลิงก์ในรายการ
- **ใบเบิกอะไหล่**: `is_special` = "เบิก" (จองสต๊อก), `is_quotation` = "เสนอ" (คิดเงิน) · คลังตัดจ่ายที่หน้า ตัดจ่ายอะไหล่ › จ่ายออกตามงานซ่อม · จ่ายครบทุกรายการ → งานเป็น 10 อัตโนมัติ
- **สต๊อก**: `quantity_remain` ปรับแบบ delta (ไม่คำนวณใหม่ทั้งแถว) เพื่อไม่ไปแก้แถวที่ระบบเก่าเพี้ยนอยู่แล้ว
- **มอบหมายช่าง** ต้องชี้ `app_user`: เลือกจาก dropdown ผู้ใช้ระบบ หรือเลือกจากไดเรกทอรี Lark แล้ว server หา/สร้าง `app_user` ด้วยอีเมล
- **Storage**: อัปโหลดขึ้น Supabase Storage bucket `attachments` (path `jobs/{job_no}/{system_file_name}`) — key ใน `.env` ปัจจุบันถูกปฏิเสธ (401) ต้องอัปเดตก่อนใช้แนบไฟล์

## 13. Soft delete แบบเดียวทั้งระบบ — `record_status` (เพิ่ม 2026-09-15, migration `0003`)

- ตาราง lookup **`record_status`**: `ACTIVE` ใช้งาน · `INACTIVE` ปิดใช้งาน (ยังเห็นในรายการ/หน้า admin แต่ไม่ขึ้น dropdown) · `DELETED` ลบแล้ว (ซ่อนทุกหน้า **กู้คืนทาง SQL เท่านั้น** ตามที่ตกลง)
- คอลัมน์ `record_status` (FK) + `status_changed_at` + `status_changed_by` ใน 14 ตาราง: category, manufacturer, color, job_type, product_type, symptom, model, product, customer, app_user, job, quotation_hd, sale_out_hd, document_attach
- **ไม่มี hard delete ที่ไหนเลย** — ทุกปุ่มลบ/ยกเลิก → `DELETED`; toggle สถานะ → `ACTIVE`/`INACTIVE`
- ยัง mirror flag เดิมของ legacy: `is_active = (ACTIVE)`, `app_user.deleted = (DELETED)`, ใบสั่งขาย `document_status=false` เมื่อ DELETED, งานที่ DELETED ตั้ง `job_status_id=0` + `job_log` ตามระบบเก่า
- backfill (รันซ้ำได้หลัง re-dump, แตะเฉพาะแถวที่ยังเป็น ACTIVE): `is_active=false` → INACTIVE · job สถานะ 0 → DELETED · SO `document_status=false` → DELETED · `app_user.deleted` → DELETED · ไฟล์แนบ `is_active=false` → DELETED
- API: `POST /api/admin/records {table,id,status}` — DELETED ต้องมีสิทธิ์ `del`, ACTIVE/INACTIVE ต้องมี `edit` (master/ผู้ใช้ = System Admin) · การอ่านรับ `?deleted=active|exclude|only|all`
- กู้คืน: `update <table> set record_status='ACTIVE', is_active=true where …` (งาน: ตั้ง `job_status_id` กลับเองด้วย)

## 14. ประสิทธิภาพ / pagination (2026-09-15)

วัดจริงกับ dump 420k แถว ก่อน→หลัง:
- ค้นหาข้อความรายการงาน 165 ms → 15 ms, ลูกค้า 90 → 7 ms (migration `0004_indexes`: `pg_trgm` GIN 16 ตัว + btree ที่ขาด: `job_closed_date`, `job_repaired_date`, `product_symptom_id`, `job_type_id`, อำเภอ/ตำบล, ประเภทเอกสารสต๊อก, สถานะอนุมัติ SO)
- Dashboard กราฟรายเดือน 838 ms → 12 ms (query เดียว group by month)
- **Pagination ฝั่ง server ทุกตารางที่โต**: รายการงาน, ลูกค้า, ใบเสนอราคา, ใบสั่งขาย, อะไหล่, รุ่นสินค้า, ประวัติสต๊อก, จนท.รับมอบหมายงาน, รายงานทั้ง 7 (KPI คำนวณที่ DB ด้วย `*_summary` / `*_stats` endpoint บน filter ชุดเดียวกับตาราง — ไม่มีเพดาน 20,000 แถวอีก) · ที่ยังโหลดทั้งหมด: master ≤ 300 แถว และผู้ใช้ระบบ ~110 แถว (server paging ไม่ช่วยอะไร)
- dropdown อะไหล่ทุกหน้าใช้ `products?fields=lite` (5 field, ACTIVE เท่านั้น) 1.2 MB → 540 KB (≈ 80 KB หลัง gzip)
- ต้นทุนเครือข่าย Render↔Supabase ≈ 75 ms/query — หน้ารายการ = auth + count + rows ≈ 250 ms

## 15. งานตาม UI audit (2026-09-16)

- **ส่งออก Excel**: `exceljs` (MIT) → `GET /api/export/<resource>?<filter เดียวกับหน้า>` ไฟล์ .xlsx (header/freeze/auto-filter/number format, เพดาน 50k แถว) ผูก 9 ปุ่ม + Excel ในรายงาน 7 ตัว · สิทธิ์ = `view` ของ module · ปุ่ม PDF ในรายงาน = เปิดหน้าต่างพิมพ์ของเบราว์เซอร์ (บันทึกเป็น PDF)
- **ไฟล์**: bucket private **`oneservice`** โครง `jobs/{no}/attachments|slip/…`, `sale-orders/{no}/slip/…`, `products/{code}/…` · เสิร์ฟผ่าน `GET /api/files?path=` (signed URL 1 ชม. ต้อง login) · อัปโหลดผ่าน `POST /api/upload {kind,id,file}` (รูปอะไหล่ → `product.pictrue_file_name`, สลิป SO → `sale_out_hd.slip_file_name`, สลิปปิดงาน → `job.job_payment_slip_file_name`) จำกัด 10 MB jpg/png/webp/pdf
- **พิมพ์ (CSS print-view, A4, ไม่มี lib)**: `/print/job/:no` ใบรับงานซ่อม · `/print/job/:no/return` ใบส่งคืนสินค้า · `/print/quotation/:no` · `/print/sale-order/:no` — ข้อมูลบริษัท/เงื่อนไขแก้ที่ `src/lib/company.ts` (ที่อยู่/เลขผู้เสียภาษียังว่าง รอข้อมูลจริง) · ปุ่มเรียกจากหน้า บันทึกซ่อม/แก้ไขงาน/ปิดงาน/ใบเสนอราคา/ใบสั่งขาย
- **Login ด้วยบัญชีอื่น — ถอดออกแล้ว (2026-09-16)**: SSO กลางไม่รองรับ `prompt=login`; ทางเดียวคือ `POST https://sso.shd-technology.co.th/api/auth/logout` ซึ่งเป็น logout กลาง (แอป SSO อื่นหลุดด้วย, ไม่รับ return URL, ไม่อยู่ในคู่มือทางการ) → ผู้ใช้ตัดสินใจถอดปุ่มออก; logout ของแอปล้างเฉพาะ cookie ของแอป กดเข้าสู่ระบบจะได้บัญชีเดิมของ SSO; `/api/sso/login?prompt=login` ยังส่งพารามิเตอร์ต่อให้ authorize ไว้ เผื่อ SSO รองรับในอนาคต
- **Session Timer** ผูกกับ `exp` จริงของ cookie, ต่ออายุอัตโนมัติเมื่อใช้งาน (≤ 1 ครั้ง/10 นาที), หมด → login
- ทุกหน้างานบันทึกส่วนข้อมูลเครื่อง/ข้อมูลอื่น/ค่าใช้จ่ายผ่าน PATCH ก่อน action ของหน้า · ปุ่มตา = modal อ่านอย่างเดียว / ไปหน้าแก้ไข · ข้ามกระดิ่งแจ้งเตือนไว้ก่อน

## 16. ลำดับทำงาน (ทำครบแล้ว)

1. **Infra**: drizzle + schema 52 ตาราง + migrations + `db:migrate` (ทดสอบกับ Postgres local ที่โหลด dump แล้ว)
2. **Auth**: provision → `app_user`, approval gate, `can()`, permission API, sidebar/ปุ่ม
3. **Read ทุกหน้า**: services + mappers + hook เดิม → ทุกหน้าแสดงข้อมูลจริง (dashboard/รายงานคำนวณสด)
4. **Write**: master → customers → products/stock → jobs (เปิด/แก้/มอบหมาย/ซ่อม/outsource/swap/ปิด) → quotation → sale order → attachments
5. ตรวจ `next build` + ทดสอบ flow เต็มกับ DB local → ส่ง

## 17. ตรวจข้อมูลระบบ (admin masters) เทียบ DB จริง — 2026-09-16
- จำนวนแถวทุกตารางดึงครบ (app_user 107, app_config 64/10 บทบาท/17 โมดูล, category 11, manufacturer 95, model 1,171, color 10, job_type 10, product_type 11, symptom 302)
- แก้: รุ่นสินค้า — ตัดช่อง "ประเภทเครื่อง" (ไม่มีใน DB) และ dropdown ยี่ห้อรวมยี่ห้อ Inactive ของรุ่นที่แก้ (152 รุ่น Active สังกัดยี่ห้อ Inactive); ประเภทเครื่องซ่อม — เพิ่มคอลัมน์ `product_type_description` (migration 0005); อาการเสีย — ช่องกลุ่มพิมพ์ใหม่ได้ + datalist ค่าเดิม
- ตัดสินใจไม่ทำ (ผู้ใช้): แยกชื่อ/สกุล/title ในผู้ใช้ระบบ, `category.shot_code`, `manufacturer.logo_name` (ว่างทั้งหมด)

## 18. UI: Tailwind v4 + shadcn/ui (2026-09-16)
- ตัดสินใจ: "shadcn ข้างใน หน้าตาเดิมข้างนอก" — `components/ui/*` คงชื่อ/props เดิม (หน้าเพจ 42 หน้าไม่แก้), ข้างในเป็น Radix/shadcn; ไฟล์ shadcn ต้นฉบับอยู่ `components/shadcn/*`
- Tailwind 3.4 → 4.3 ด้วย `@tailwindcss/upgrade` แล้วแก้มือ: `@theme inline` (token อ้าง HSL var เดิม เพื่อให้ `.auth-page`/`.dark` override ได้), ฟอนต์ย้ายเข้า `@theme`, ลบ compat border block, คง `cursor:pointer` ให้ปุ่ม, ตัว upgrade เปลี่ยน variant `"outline"` ของ Button เป็น `"outline-solid"` ผิด → แก้กลับ
- แทนแล้ว: Modal→Dialog, Toast→Sonner, Tabs→Radix, Checkbox→Radix, Button/Badge→cva, CommandPalette→cmdk · คงเดิม: native Select/Radio, DataTable, Field, Sidebar/Topbar, ฟอร์ม, print
- `cn()` เป็น twMerge → class ที่หน้าเพจส่งมาชนะ base เสมอ (เดิมแพ้ตามลำดับ CSS): ผลที่มองเห็น = DataTable ช่องค้นหา/page-size สูง 32px ตาม `h-8`, ช่องตัวเลขในสรุปราคามีความกว้างตาม `w-*` (label ไม่ขึ้นบรรทัดใหม่แล้ว), การ์ด TAT/งานล่าสุดบน dashboard ใช้ `p-0` ตามที่หน้าเพจสั่ง — ถือเป็นการทำให้ตรงเจตนาเดิมของโค้ด
- ทดสอบ: screenshot 40 หน้า × light/dark + modal states เทียบก่อน/หลังด้วย headless Chrome (สคริปต์ใน scratchpad), ทดสอบ interaction (dialog focus/Esc, toast, tabs keyboard, checkbox, ⌘K) ผ่าน; build/tsc ผ่าน
- `next.config.mjs` เพิ่ม `distDir` จาก `NEXT_DIST_DIR` เพื่อ build production ทดสอบคู่กับ `next dev` ได้ (`.next-*` ถูก ignore)

## 19. ตรวจข้อมูลทีละส่วน (2026-09-16) — ส่วน 1 อะไหล่ / ส่วน 2 ลูกค้า
**อะไหล่** (จำนวนแถวดึงครบทุกตาราง)
- ตัดจ่ายอะไหล่: อ้างอิงเลขงานเป็นช่องพิมพ์ + datalist จาก `job_nos?mode=pending_parts` (งานที่มีรายการค้างเบิก ไม่สนสถานะงาน — เดิมโชว์แค่ 100 งานล่าสุดที่ยังไม่ปิด ทำให้ 34/36 งานที่ค้างเบิกเลือกไม่ได้)
- เพิ่มประเภทเอกสาร "รับคืนจากการเบิก" (inventory_type 2) ในหน้าตัดจ่าย: `job_nos?mode=returnable`, `pick-lines?type=return`, `POST /api/stock/issue type=return` → `returnFromJob` (used −= qty, log.return_qty/date/by/return_stock_id, สถานะ 5 คืนแล้วเมื่อคืนครบ, WHI จาก running "Inventory-In", ไม่แตะสถานะงาน)
- รับเข้า: PO ไม่บังคับ (ระบบเดิมว่างทั้ง 6,309 ใบ)
- modal อะไหล่: แสดง `product_none_serial.remark` (log ปรับสต๊อกเดิม 971 แถว) และ `cancel_remark/date/by` แบบอ่านอย่างเดียว
- รูปอะไหล่เดิม: อัปโหลด 786/822 ไฟล์จาก `~/Downloads/ImagesProduct` ขึ้น bucket `oneservice` ที่ `products/{code}/{ชื่อไฟล์เดิม}` (ไม่แก้ DB); 36 รายการไม่มีไฟล์ต้นทาง (รายชื่อในแชท) สคริปต์ `img-upload.mts` อยู่ใน scratchpad
- ไม่ทำ: `category.shot_code`, `manufacturer.logo_name`, `model.tier_id`, `product_serial`/`model_part` (ว่างทั้งหมด); ไม่มีหน้า "ปรับยอด" (ใช้รับเข้า/จ่ายอื่นๆ แทน); ข้อมูลเก่าผิดปกติ (remain ติดลบ 5, drift 6, SO อนุมัติแล้วไม่ตัดสต๊อก 3 ใบปี 2024) รอเคลียร์ตอน re-dump
**ลูกค้า** (43,529 แถว ครบ; ทุก job.customer_id มีลูกค้า)
- ปุ่ม "ประวัติงานซ่อม" ในแถวลูกค้า → `/jobs/list?customer=CODE` (หน้ารายการงานอ่าน param มาเติมฟิลเตอร์ลูกค้า)
- เพิ่มลูกค้าใหม่: ถ้าเบอร์ซ้ำกับลูกค้าเดิม (ซ้ำอยู่ 1,843 เบอร์/3,973 ราย) แสดง toast เตือนพร้อมรหัสเดิม ไม่บล็อก
- แก้ลูกค้าเก่าที่ยังไม่มีจังหวัด (26,020 ราย): hint ใต้ช่องที่อยู่เตือนให้ตัดส่วนท้ายก่อนเลือกจังหวัด (กันที่อยู่ซ้ำตอนประกอบ `customer_address`)
- modal โหมดดู: แสดงวันที่สร้าง/สร้างโดย (`created_date`, `create_by` join app_user)
- ไม่ทำ: `fax_number` (ว่างหมด)
**งานบริการ (ส่วน 3)** — job 48,613 / job_log 224,555 สอดคล้อง 100% (สถานะล่าสุดใน log = job) · referential ครบ · job_symptom ว่าง แต่ fallback product_symptom_id
- `is_job_bounce` (งานเด้ง 16%): checkbox ในส่วน "ข้อมูลการเปิดงาน" (เปิดใหม่/แก้ไข) + badge "งานเด้ง" ในรายการงาน; `JobInput.isBounce`, list select
- งานย่อย: Input + datalist จาก `job_type_details` (24 ค่าจริงใน DB แทน 5 ค่าตายตัว), พิมพ์ใหม่ได้
- บริษัทขนส่ง (รับเข้า + ส่งคืนตอนปิดงาน): Input + datalist จาก `shippers` (top 15 ใน DB, ตัดค่าที่สั้นกว่า 2 ตัวอักษร) — free text เหมือนระบบเดิม
- วิธีชำระเงินตอนปิดงาน: `JOB_PAYMENT_METHODS` = เงินโอน / เงินสด / บัตรเครดิต (ตรง `job.job_payment_type` เดิม; ใบสั่งขายยังใช้ "โอนเงิน")
- รอ: โฟลเดอร์ไฟล์แนบงานจากระบบเดิม (document_attach 5,866 ไฟล์ → `jobs/{no}/attachments/{system_file_name}`)
- ไม่ทำ: product_color, job_reference_no_gspn, job_payment_no (ว่าง); job_return_hd/dt, job_service_code, temp tables (ไม่เคยใช้)
**ใบเสนอราคา (ส่วน 4)** — hd 3,035 / dt 3,989 · สูตรยอดเงินตรง 100% · ผูกงานสองทางครบ
- ฟิลเตอร์ ประเภท/Warranty/ยี่ห้อ ย้ายไปกรองที่ server (`QuotationFilters.warranty/brand`, count query join manufacturer) — เดิมกรองเฉพาะหน้าที่โหลด
- แสดง `customer_approve_date` + ผู้สร้าง ในฟอร์ม (อ่านอย่างเดียว) และคอลัมน์ "วันที่ตอบรับ" ในรายการ; export รับฟิลเตอร์ครบ
- ไม่ทำ: customer_approve_remark (ว่าง), quotation_temp (ไม่ใช้)
**ใบสั่งขาย (ส่วน 5)** — sale_out_hd 3,866 / dt 4,100 · ยอดเงินตรง 100% · อนุมัติแล้ว 3,759 ทุกใบมี WHO type 4 (ยกเว้น 3 ใบปี 2024 ค้างจากระบบเดิม) · ชื่อสถานะอนุมัติตรง approve_status
- ทดสอบ create → approve (WHO type 4, reference_no, pick_inventory_no, used+1) → tracking → deny ผ่านครบ; บรรทัด Service (SV0001) ไม่มี product_id เหมือนเดิม
- ไฟล์สลิปเดิมจากโฟลเดอร์ FileUpload: SO 2,828/3,808 และสลิปงาน 19/75 อัปโหลดขึ้น `sale-orders/{no}/slip/` และ `jobs/{no}/slip/` แล้ว (ที่เหลือไม่มีไฟล์ต้นทาง)
- ใบเสนอราคา: บรรทัดค่าขนส่ง (Delivery) แยกจาก spare_part_amount ตามกติกาเดิม (sum_exclude = อะไหล่ + บริการ + ขนส่ง)
- ไม่ทำ: sale_in_hd/dt (ว่าง), document_credit_note_*/cancel_* (ว่าง), fee_amount/rounding (ว่าง)
**รายงาน (ส่วน 6)** — KPI ทั้ง 7 รายงานคำนวณจาก where เดียวกับตาราง; เทียบกับ SQL ตรง ๆ (ส.ค. 2026) ตรงทุกตัว: เปิดงาน 1,947/ใหม่ 16, ปิดงาน 1,837/รับชำระ 75,200/TAT 8.7/เกิน30วัน 29, ซ่อม 1,879/83,700, ใบเสนอราคา 63/40/86,500, SO 103/103/42,280, เบิกอะไหล่ 497 บรรทัด/620 ชิ้น
- สต๊อกคงเหลือ: KPI ใช้ `greatest(remain,0)` (ตัด 5 แถวติดลบจากระบบเดิม −544 ชิ้น) — ตั้งใจ
- แก้: Export "อะไหล่" (หน้ารายการอะไหล่ + รายงานสต๊อก) รับฟิลเตอร์ หมวด/ยี่ห้อ/สถานะสต๊อก/… เหมือนตาราง (เดิม export ทั้งหมดเสมอ) — ใช้ `pageProducts` + `ProductFilters` ใน export.ts

## 20. Audit trail (2026-09-17)
- ตัดสินใจ: ตาราง `audit_log` เดียว (migration 0006) แทนการเพิ่ม `updated_by` ทุกตาราง; เขียนใน transaction เดียวกับข้อมูล; append-only ด้วย trigger; เก็บ diff เฉพาะฟิลด์ที่เปลี่ยน; บันทึก LOGIN แต่ไม่บันทึกการเปิดดู; เก็บตลอด; การแก้ผ่าน SQL ไม่บันทึก
- จุดเขียนที่ครอบคลุม: งาน (เปิด/แก้/มอบหมาย/บันทึกซ่อม/ส่งซ่อมต่อ/swap-refund/ปิดงาน/ทุกการเปลี่ยนสถานะผ่าน `setStatus`/แนบ-ลบไฟล์/บันทึกการโทร), ใบเสนอราคา (สร้าง/แก้/เปลี่ยนสถานะ), ใบสั่งขาย (สร้าง/แก้/อนุมัติ-ปฏิเสธ-ส่งกลับ/เลขพัสดุ/ตัดสต๊อก), สต๊อก (รับเข้า/จ่ายตามงาน/จ่ายอื่นๆ/รับคืน/เพิ่ม-แก้อะไหล่), ลูกค้า (เพิ่ม/แก้), master ทุกตัว (เพิ่ม/แก้/สถานะ/ลบ), ผู้ใช้ (เพิ่ม/แก้/อนุมัติ/ลบ-กู้คืน), สิทธิ์ (บันทึกเป็นรหัส V/A/E/D ต่อเมนู), soft delete ทุกตารางผ่าน `/api/admin/records`, LOGIN ใน SSO callback (มี ip/ua ใน meta)
- UI: หน้า `/admin/audit` (System Admin, paged + ฟิลเตอร์ + modal ดู diff + Excel `audit_log`) และ `JobHistorySection` ในหน้าแก้ไขข้อมูลงาน (พับได้ แสดง 100 รายการล่าสุด)
- ประวัติเริ่มนับตั้งแต่ deploy — ข้อมูลเก่าไม่มี (job_log เดิมยังใช้ดูสถานะย้อนหลังได้)

## 21. Dashboard date range (2026-09-17)
- ปุ่ม 7/30/90 วัน/ทั้งหมด เดิมไม่ได้ผูกกับข้อมูล → เปลี่ยนเป็นช่องวันที่ เริ่ม–สิ้นสุด + preset (7/30/90 วัน, เดือนนี้, ทั้งหมด) ค่าเริ่มต้น 30 วันย้อนหลัง
- ตามช่วง: การ์ด 4 ใบ (นับงานที่เปิดในช่วง แยกสถานะปัจจุบัน), กราฟ (รายวันเมื่อ ≤ 62 วัน / รายเดือน; ทั้งหมด = รายเดือนตั้งแต่งานแรก), Top อาการเสีย, งานล่าสุด · **TAT คง snapshot งานที่ยังค้าง** · ยึด job_create_date (เส้นปิดงานใช้ job_closed_date)
- `dashboard({from,to})` memo 30 วิ ต่อช่วง; resources dash_* รับ from/to; ตรวจกับ SQL ตรง (ส.ค. 69: เปิด 1,947 / ปิด 1,839 ✓)

## 22. SymptomPicker (2026-09-17)
- ช่อง "อาการเสียหลัก (มาตรฐาน)" จาก chip 299 ปุ่ม → `SymptomPicker` (shadcn Popover + cmdk): ค้นหา, ติ๊กหลายอาการ, คีย์บอร์ด ↑↓ Enter Esc, chip ตัวแรก ★ = อาการหลัก (`product_symptom_id`) กดดาวที่ chip อื่นเพื่อสลับ
- รายการเรียงตามความถี่ใช้จริง (`symptom_stats` = product_symptom_id ∪ job_symptom, memo 5 นาที) + กลุ่มบน "อาการที่พบบ่อยของรุ่นนี้" (`model_symptoms?model=` top 5 จากประวัติงานรุ่นเดียวกัน)
- ใช้ใน ProductSection (เปิดงาน/แก้ไข/บันทึกซ่อม/ส่งซ่อมต่อ/Swap-Refund) และ "อาการเสียที่ตรวจพบ" ของช่าง (single-select, `engineer_symptom_id`)
- บทเรียน: ห้ามประกาศ component ซ้อนใน render (cmdk item remount ระหว่าง pointerdown→click ทำให้คลิกเมาส์ไม่ติด) — ใช้ render function แทน


## 23. CustomerSelect + ห้ามลูกค้าซ้ำ (2026-09-17)
- บล็อกข้อมูลลูกค้าในฟอร์ม เปิดงาน/แก้ไขงาน/ใบเสนอราคา/ใบสั่งขาย ใช้ `CustomerSelect` ตัวเดียว: เริ่มด้วยตัวเลือก "ประเภทลูกค้า: ลูกค้าเดิม — เคยมีข้อมูลในระบบ / ลูกค้าใหม่ — ยังไม่เคยมีข้อมูล" (ยังไม่แสดงช่องใด ๆ)
- ลูกค้าเดิม → `CustomerSearch` (cmdk + Popover, `/api/customers/lookup` debounce 300ms, ≥2 ตัวอักษร, 10 แถว รหัส·ชื่อ·เบอร์, พิมพ์รหัส `C#####` ตรงตัว = เลือกทันที, ท้ายรายการ "ไม่ใช่รายเหล่านี้? เพิ่มลูกค้าใหม่" พาไปโหมดใหม่พร้อมเบอร์/ชื่อที่พิมพ์)
- เลือกแล้ว → 7 ช่องอ่านอย่างเดียว + hint "ข้อมูลลูกค้าแก้ไขที่หน้าข้อมูลลูกค้า" ลิงก์ `/customers?edit=CODE` (แท็บใหม่ เฉพาะผู้มีสิทธิ์แก้ Customer) · ปุ่ม "โหลดข้อมูลใหม่" · "ค้นหาลูกค้ารายอื่น"
- ลูกค้าใหม่ (ต้องมีสิทธิ์เพิ่ม Customer) → `CustomerFields` ชุดเดียวกับหน้าข้อมูลลูกค้า (ซ่อนสถานะ) + ปุ่ม "บันทึกลูกค้าใหม่" → POST `/api/customers` แล้วสลับเป็นโหมดเลือกแล้วอัตโนมัติ — **บันทึกลูกค้าก่อน แล้วค่อยบันทึกงาน** (ไม่รวมใน transaction เดียวกับงาน เพื่อให้ได้รหัสลูกค้า + audit แยกชัด)
- **ห้ามซ้ำ (server)** `findCustomerConflicts`: เบอร์โทร (เทียบเฉพาะตัวเลข ≥6 หลัก), อีเมล (lower-case), เลขผู้เสียภาษี/บัตรประชาชน (ตัวเลข ≥5 หลัก) — ไม่นับ DELETED และไม่นับตัวเอง; สร้างใหม่ชนอย่างใดอย่างหนึ่ง = 409; แก้ไขตรวจเฉพาะฟิลด์ที่เปลี่ยน (ลูกค้าเก่าที่ซ้ำอยู่แล้วยังแก้ข้อมูลอื่นได้)
- 409 ส่ง `{error, details:{conflicts:[{field,code,name,value}]}}` (`HttpError.details` → `ApiError.details`) → UI แสดง `ConflictNotice` พร้อมปุ่ม "ใช้ลูกค้ารายนี้" (ในฟอร์มงาน = เลือกลูกค้ารายนั้นแทน; ในหน้าข้อมูลลูกค้า = เปิดแก้รายนั้น)
- หน้าข้อมูลลูกค้า: รองรับ deep link `?edit=CODE` และ `?new=1&phone=&name=`; ตัด warning เบอร์ซ้ำเดิม (ตอนนี้ server บล็อกจริง)
- ทดสอบ: curl (ซ้ำเบอร์/อีเมล → 409, แก้ลูกค้าเก่าโดยไม่เปลี่ยนเบอร์ → ผ่าน, เปลี่ยนเบอร์ไปชน → 409, เลขภาษี "-" ไม่นับ) + headless Chrome (ค้นหา/เลือก/hint/กลับไปเลือกใหม่/โหมดใหม่/ซ้ำ → notice → ใช้ลูกค้ารายนี้) ผ่านครบ

## 24. JobSearch — ช่อง "ระบุ หมายเลขงาน" (2026-09-17)
- ช่องพิมพ์เลขงาน + ปุ่ม GO ใน 6 หน้า (แก้ไขข้อมูลงาน / รับมอบหมาย / บันทึกซ่อม / ส่งซ่อมต่อ / Swap-Refund / ปิดงาน) → `JobSearch` ตัวเดียว (cmdk + Popover, debounce 300ms, ≥2 ตัวอักษร, 10 แถวล่าสุด) ค้นจากตัวกรองเดียวกับรายการงาน: เลขงาน / รหัส·ชื่อ·เบอร์ลูกค้า (`customer_detail`) / เลขอ้างอิง / IMEI / Serial / รุ่น — แถวแสดง เลขงาน · ลูกค้า · รุ่น+S/N · สถานะ (badge) · วันที่เปิด
- กรองตามหน้า: แก้ไข = ทุกงาน · รับมอบหมาย = `unassigned` · บันทึกซ่อม/ส่งซ่อมต่อ/Swap-Refund = `open` (ไม่นับ Finished/Cancel) · ปิดงาน = `closable` ใหม่ (กลุ่ม Repaired หรือสถานะ 7 รอลงเลขพัสดุ / 24 รอลูกค้ามารับ) — hint ท้าย dropdown บอกเงื่อนไข
- พิมพ์เลขงานเต็ม `J#######` = เลือกทันที; ถ้าอยู่นอกเงื่อนไขหน้านั้นจะมีแถว "เรียกงานนี้ตรง ๆ" (Enter) → หน้าโหลดงานเหมือนกด GO เดิม จึงไม่มีอะไรที่เคยทำได้แล้วทำไม่ได้; ลิงก์ `?job=` เดิมยังใช้ได้
- ปุ่ม GO ถูกตัดออก (Enter/คลิกในรายการทำหน้าที่แทน); ปิด popover โดยไม่เลือก = ล้างคำค้น
