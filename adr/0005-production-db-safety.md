# 0005 — ความปลอดภัยของ DB production

- **Status:** Accepted
- **Date:** 2026-10-14 (`docs/production-readiness.md` P0-8, P0-7)

## Context

`.env` ในเครื่องคือ **production** (Supabase `bnntps…`) · เคยมีสคริปต์ที่ `DROP TABLE … CASCADE` 52 ตารางโดยไม่ถาม,
`migrate.ts` reset journal เอง, และ `next dev` / test ยิง DB จริงได้ทันที · Render **ไม่ได้ sync กับ `render.yaml`** — dashboard คือของจริง

## Decision

- dev ใช้ Postgres ใน Docker (`npm run db:dev:up`, `.env.development.local` ทับ DB/Storage/Turnstile/SMS) · test/e2e ใช้ DB ทิ้งได้ `*_test` บน localhost เท่านั้น — `tests/db-url.mts` ปฏิเสธ URL อื่น และ e2e ไม่อ่าน env file เลย (`tests/e2e/support/env.ts`)
- guard: `next dev` / `db:migrate --reset` กับ project prod ต้อง `ALLOW_PROD_DB=1` (`src/db/client.ts`, `scripts/migrate.ts`) · `setupdata/load_supabase.sh` ต้อง `I_UNDERSTAND_THIS_DROPS_PRODUCTION=1` + พิมพ์ DROP · บน Render ไม่ reset journal เอง
- production migrate เฉพาะตอน deploy (`preDeployCommand: npm run db:migrate`) — ไม่รันจากเครื่อง · migration ต้อง idempotent (รันซ้ำได้หลัง re-dump)
- ทุกค่าที่แก้ใน `render.yaml` ต้องตั้งใน Render dashboard ด้วยมือ

## Consequences

- พลาดพิมพ์คำสั่งผิดในเครื่องไม่ลบ/ไม่แก้ production
- ⚠️ `npm run build && npm start` ในเครื่อง = `NODE_ENV=production` อ่าน `.env` → ต่อ DB จริง (ไม่มี guard) — ใช้ `NEXT_DIST_DIR` + env ของ e2e แทน
- การตั้งค่า deploy มีสองที่ (yaml + dashboard) จนกว่าจะ sync blueprint — ตรวจ dashboard ทุกครั้งที่แก้ yaml
