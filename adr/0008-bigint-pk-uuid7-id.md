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

