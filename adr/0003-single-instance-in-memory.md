# 0003 — Instance เดียว: cache และ rate limit ของ staff app อยู่ใน memory

- **Status:** Accepted
- **Date:** 2026-09-18 (ย้ายจาก `docs/backend-rebase-plan.md` §31 / §14)

## Context

แอปรันบน Render **instance เดียว** ผู้ใช้เป็นพนักงาน ~110 คน · Render↔Supabase ≈ 75 ms/query จึงต้อง cache lookup ที่อ่านบ่อย
และต้องกันสคริปต์/แท็บค้างยิง export/ค้นหาจน CPU/RAM พุ่ง — ไม่คุ้มที่จะเพิ่ม Redis

## Decision

- cache: `src/server/cache.ts` (lru-cache, ≤ 500 key, TTL ต่อ call, single-flight, stale-while-revalidate) · write path เรียก `invalidate()`
- rate limit: `src/server/rate-limit.ts` sliding window ใน `Map` · key = อีเมลใน session หรือ IP (IPv6 นับต่อ /64 — `ipBucket()` ใน `src/lib/client-ip.ts`) · 429 + `retryAfter`
  export 5/นาที · `/api/data/*` 240/นาที · `/api/customers/lookup` 120/นาที · directory 30/นาที
- map ของ rate limit มีเพดาน 20,000 bucket: เต็มแล้วทิ้ง key ที่เงียบเกิน 5 นาที แล้วถ้ายังเต็มทิ้ง 1/10 ที่เก่าสุด (ไม่ล้างทั้งหมด — ไม่งั้นคนเปิด 20,000 key รีเซ็ตทุกคนได้) — `npm run test:rate-limit`
- **ไม่ใช่** security boundary — auth/permission ยังเช็กทุก request · `/track` สาธารณะใช้ rate limit ใน Postgres แทน (ADR 0004)

## Consequences

- เร็ว ไม่มี infra เพิ่ม · reset ทุก deploy/restart
- **เพดาน**: scale เป็น 2+ instance เมื่อไร cache จะไม่ invalidate ข้าม instance (เห็นข้อมูลเก่าได้ถึง TTL) และ limit คูณตามจำนวน instance
  → ตอนนั้นย้าย rate limit ไป Postgres (`hit()` แบบ `/track`) หรือ Redis และ invalidate ผ่าน pub/sub
- แก้ข้อมูลตรงด้วย SQL จะเห็นช้าไม่เกิน TTL ของ key นั้น
