# 0010 — เทสต์รันด้วย vitest (แบบ OneLink) ย้ายจากสคริปต์ tsx ทีละเฟส

- **Status:** Accepted — เฟส 1 (เทสต์ที่ไม่ใช้ DB) เสร็จ · เฟส 2–3 รอ
- **Date:** 2026-11-03

## Context

P1-CI-2 เลือก `tsx` + `node:test` เพราะไม่ต้องเพิ่ม dependency (docs/production-readiness.md) — ตอนนั้นมีเทสต์ 2 ไฟล์
ตอนนี้ `scripts/test-*.mts` ~37 ไฟล์ ~20k บรรทัด (`test-domain.mts` ไฟล์เดียว ~6.7k บรรทัด 255 เคส) แต่ละไฟล์มี `test()` + `process.exit` ของตัวเอง (ก๊อปกัน 35 ที่)
ต่อกันด้วย `&&` ใน package.json: ไฟล์แรกที่ล้มบังไฟล์ที่เหลือ · รันเคสเดียว / watch ไม่ได้ · OneLink ใช้ vitest อยู่แล้ว (shared DB, test DB URL, TZ แก้ไว้ใน config)

## Decision

- `vitest` (pin เวอร์ชันเดียวกับ OneLink) · `vitest.config.mts` มีสอง project:
  - `unit` — `tests/unit/**/*.test.{ts,mts}` + `workers/**/*.test.ts` · ไม่ใช้ DB · `npm test`
  - `db` — `tests/db/**` · `globalSetup` (`tests/db-global-setup.mts`) เรียก `assertLocal` ของ `tests/db-url.mts` · `fileParallelism: false` (DB เดียวกัน)
- config เรียก `assertLocal` แล้วตั้ง `DATABASE_URL` = test DB และ `TZ=Asia/Bangkok` เสมอ (ทุก project รวม `unit`) · ไม่อ่าน env file
- `'server-only'` → alias ไปที่ `server-only/empty.js` (แทน `NODE_OPTIONS=--conditions=react-server`)
- ไฟล์ที่ย้ายมาใช้ `node:assert/strict` เหมือนเดิม (vitest รายงาน AssertionError ได้) · ชื่อเคสเดิม
- ย้ายทีละเฟส — สคริปต์ที่ยังไม่ย้ายรันแบบเดิม (`npm run test:db` ไม่เปลี่ยน):
  1. เทสต์ไม่ใช้ DB 11 ไฟล์ → `tests/unit/` (เสร็จ 2026-11-03, 205 เคสเท่าเดิม)
  2. fixture ของ `test-domain` → `globalSetup` ของ project `db` แล้วย้าย `test-domain` / `test-api` / `test-track` / `test-running-no`
  3. `test-qa-*` ย้ายทีละไฟล์เมื่อมีคนแก้ไฟล์นั้น

## Consequences

- เคสที่ล้มไม่บังเคสอื่น · `npx vitest run <ไฟล์> -t '<ชื่อ>'` รันเคสเดียว · `npm run test:watch`
- เพิ่ม devDependency (vitest + vite/rolldown ~34 package, dev เท่านั้น)
- ไฟล์ที่ย้ายมายังเป็น `.mts` — `tsc` ไม่ตรวจ (`tsconfig` include แค่ `**/*.ts`) เหมือนตอนอยู่ `scripts/` · ตั้งชื่อ `.ts` แล้วจะเจอ type error เดิม 7 จุด — แก้แยก
  เทสต์ใหม่ใช้ `.test.ts` (tsc ตรวจ)
- ระหว่างเฟส มีสองแบบอยู่ด้วยกัน: เทสต์ใหม่ที่ไม่ใช้ DB เขียนเป็น vitest · เทสต์ใหม่ที่ใช้ DB ยังเขียนต่อในสคริปต์เดิมจนกว่าเฟส 2 เสร็จ
