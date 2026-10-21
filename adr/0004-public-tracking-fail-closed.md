# 0004 — หน้าติดตามสาธารณะ (`/track`) fail-closed

- **Status:** Accepted
- **Date:** 2026-09-23 (รุ่นแรก `docs/backend-rebase-plan.md` §35) · ปรับ 2026-10-14

## Context

`/track` เป็นส่วนเดียวที่คนนอกเข้าได้ และพาข้อมูลงาน/ลูกค้าออกไป · เลขงาน `J26xxxxx` เรียงลำดับ ไล่เดาได้ทั้งหมด
ระบบ tracking ที่โดน enumeration รั่วข้อมูลหลักล้านรายการ — ทุกการป้องกันที่ตั้งค่าไม่ครบต้อง **ปิด** ไม่ใช่ปล่อยผ่าน

## Decision

- **Origin auth**: Cloudflare ใส่ `X-Origin-Auth` ทุก request · production default `enforce` (ไม่มี header = 403, ไม่ได้ตั้ง secret = 503) — `src/lib/origin-auth.ts`, `src/proxy.ts` · IP ของลูกค้าเชื่อ `CF-Connecting-IP` หลังผ่านเช็กนี้เท่านั้น (`src/lib/client-ip.ts`)
- **Turnstile**: ไม่มี secret / test key ใน production / ไม่รู้ hostname / siteverify ล่ม = `unavailable` → ปฏิเสธ · ตรวจ hostname + action — `verifyTurnstile()` ใน `src/server/track-guard.ts`
- **ลิงก์**: token สุ่ม 32 bytes ต่องาน (ไม่ใช้เลขงานเป็นกุญแจ) · เอกสารเปิดผ่าน **ticket ใช้ครั้งเดียว** อายุสั้น ผูก IP + browser
- **OTP ทาง SMS** (ดูงานทั้งหมดของเบอร์): ตอบเหมือนกันทุกเบอร์ (decoy) · cap ต่อเบอร์/ต่อเบอร์+IP/วัน, ผิดเกิน → ล็อก 24 ชม., cap SMS รวมต่อชั่วโมง — `src/server/track-otp.ts` · `SMS_PROVIDER=log` ใช้ใน production ไม่ได้
- rate limit + block ใน Postgres (`track_rate`, `track_block`) key เป็น HMAC ของ IP (IPv6 /64) · event log ไม่มี IP ดิบ
- CSP nonce + `strict-dynamic`, `no-store`, `no-referrer`, `noindex` — `src/proxy.ts` · ข้อมูลออกทางเดียว `src/server/services/tracking.ts` (mask ชื่อ/serial, ไม่มีราคา, error ทุกชนิด = "ไม่พบข้อมูล")

## Consequences

- ตั้งค่าไม่ครบ = ลูกค้าใช้หน้าไม่ได้ (เห็นข้อความว่าบริการยังไม่พร้อม) แทนที่จะรั่ว — ต้องตั้ง env ครบใน Render dashboard
- e2e ข้าม `/track` (production ปฏิเสธ Turnstile test key + SMS log) · ครอบด้วย `npm run test:track` (DB test)
- ห้าม regress: ทุก route ใหม่ใต้ `/api/track` ต้องผ่าน `trackCtx()` + `hit()` และไม่คืน error ที่บอกว่ามีงาน/เบอร์นี้อยู่จริง
