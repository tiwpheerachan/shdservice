# 0009 — Migrate ฐานที่ระบุชื่อเอง: dev / prod (ถามก่อน) / deploy — แบบ OneLink

- **Status:** Accepted — แทนข้อ "production migrate เฉพาะตอน deploy … ไม่รันจากเครื่อง" ของ [0005](0005-production-db-safety.md)
- **Date:** 2026-10-29

## Context

0005 ปิดการ migrate production จากเครื่อง (`db:migrate` ปฏิเสธ URL ของ prod, ทางออกคือ `ALLOW_PROD_DB=1` ที่ไม่มีคำสั่ง)
— 28/10 migration 0001 / 0002 รอ deploy อยู่นาน และการโหลดข้อมูลจริงต้องใช้ทางลัดนั้น · OneLink ใช้แบบ "พูดชื่อปลายทาง"
(`scripts/db.mjs`: dev / prod ถามก่อน / deploy)

## Decision

- `npm run db:dev:migrate` — Docker dev DB (เดิม)
- `npm run db:prod:migrate` — `scripts/db-prod-migrate.mts`: อ่าน `.env` ต้องเป็นโปรเจกต์ prod (`bnntps…`), ใช้ session pooler 5432,
  แสดง host + migration ที่ยังไม่ได้รัน (อ่านอย่างเดียว) แล้ว **ให้พิมพ์ project ref** ก่อนรัน · ไม่ใช่ terminal = ไม่รัน · ไม่มี `--reset`
- `npm run db:migrate:deploy` — Render pre-deploy เท่านั้น (`--deploy` ต้องมี `RENDER`) · `db:migrate` เดิมทำแบบเดียวกัน
  (Render dashboard ยังเรียกชื่อเดิมจนกว่าจะแก้เป็น `db:migrate:deploy`) — จากเครื่องถูกปฏิเสธพร้อมบอกสองคำสั่งข้างบน
- การโหลดข้อมูลใหม่ทั้งหมด (`--reset`, ล้างฐาน) ยังเป็นของ `setupdata/load_supabase.sh` เท่านั้น
- เทสต์: `npm run test:db-guard` (อยู่ใน `npm test`)

## Consequences

- migrate prod ได้ทันทีโดยไม่ต้องรอ deploy — แต่แอปยังรันโค้ดที่ deploy อยู่: migration ที่รันก่อนต้องใช้กับโค้ดเก่าได้
  (เพิ่มคอลัมน์ / ตาราง ได้ · ลบ / เปลี่ยนชื่อ ต้องรอ deploy คือ `db:migrate:deploy`)
- ต้องแก้ `preDeployCommand` ใน Render dashboard เป็น `npm run db:migrate:deploy` ด้วยมือ (`render.yaml` แก้แล้ว)
