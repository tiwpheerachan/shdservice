# 0002 — Soft delete แบบเดียวทั้งระบบด้วย `record_status`

- **Status:** Accepted
- **Date:** 2026-09-15 (migration `drizzle/0003`, ย้ายจาก `docs/backend-rebase-plan.md` §13)

## Context

ระบบเดิมมี flag ปนกันหลายแบบ (`is_active`, `app_user.deleted`, SO `document_status`, งานสถานะ 0) และ hard delete บางที่
ทำให้เอกสารอ้างถึงแถวที่หายไป และไม่มีทางรู้ว่าใครลบเมื่อไร

## Decision

- ตาราง lookup `record_status`: `ACTIVE` ใช้งาน · `INACTIVE` ปิดใช้งาน (ยังเห็นในรายการ/หน้า admin แต่ไม่ขึ้น dropdown) · `DELETED` ลบแล้ว (ซ่อนทุกหน้า)
- คอลัมน์ `record_status` (FK) + `status_changed_at` + `status_changed_by` ใน 14 ตาราง: category, manufacturer, color, job_type, product_type, symptom, model, product, customer, app_user, job, quotation_hd, sale_out_hd, document_attach
- **ไม่มี hard delete** — ปุ่มลบ/ยกเลิก → `DELETED`; toggle → `ACTIVE`/`INACTIVE` · ผ่าน `POST /api/admin/records {table,id,status}` (DELETED ต้องมีสิทธิ์ `del`, ที่เหลือ `edit`; master/ผู้ใช้ = System Admin) · การอ่านรับ `?deleted=active|exclude|only|all`
- ยัง mirror flag legacy: `is_active = (ACTIVE)`, `app_user.deleted = (DELETED)`, SO `document_status=false` เมื่อ DELETED, งานที่ DELETED ตั้ง `job_status_id=0` + `job_log` ตามระบบเดิม
- backfill รันซ้ำได้หลัง re-dump (แตะเฉพาะแถวที่ยัง ACTIVE): `is_active=false` → INACTIVE · job สถานะ 0 → DELETED · SO `document_status=false` → DELETED · `app_user.deleted` → DELETED · ไฟล์แนบ `is_active=false` → DELETED

## Consequences

- เอกสารเก่ายังอ้างถึงแถวได้เสมอ, audit log บันทึกการเปลี่ยนสถานะ
- **กู้คืนทาง SQL เท่านั้น** (ตามที่ตกลง): `update <table> set record_status='ACTIVE', is_active=true where …` (งาน: ตั้ง `job_status_id` กลับเองด้วย)
- ทุก query ใหม่ต้องกรอง `record_status` เอง — ลืม = แถวที่ลบแล้วโผล่
