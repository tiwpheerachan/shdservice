# 0007 — API แบบ contract-first: zod → OpenAPI → /api-docs, คำตอบถูกตรวจกับสัญญา

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

ทีมพัฒนาภายในต้องรู้ว่า API (`src/app/api/**`, 56 route) รับ/ตอบอะไร · ไม่มีเอกสาร มีแค่โค้ดและ type ของ service
ซึ่งไม่รับประกันว่าตรงกับ JSON ที่ส่งจริง · OneLink แก้ปัญหาเดียวกันด้วย contract-first (OneLink ADR 0008)

## Decision

- ทุก operation ประกาศครั้งเดียวด้วย `defineOperation` ใน `src/server/contract/<family>.ts`: params, query, headers, body และ**ทุก** response รวม error
  (`{error, details?: {fields | stale | retryAfter | conflicts}, ref?}` ของ `handle()`) · `GET /api/data/{resource}` ประกาศแยกต่อ resource เพราะแต่ละอันตอบคนละรูป
- **สัญญาคือสิ่งที่ route อ่าน input จริง** (เจ้าของ: "เอกสารกับของจริงเป็นสิ่งเดียวกัน", แบบ OneLink ADR 0008): ทุก route อ่าน
  params / query / headers / body / form ผ่าน `parseParams` / `parseQuery` / `parseHeaders` / `parseBody` / `parseForm` /
  `parseTrackBody` (`src/server/auth.ts`) ด้วย schema ของ operation ตัวเองเท่านั้น — `scripts/test-routes-input.mts` (npm test)
  ล้มถ้า route อ่าน `req.json()` / `readJson` / `searchParams.get` / `await ctx.params` / `headers.get` เอง (ยกเว้น header ระดับ
  transport: content-length, host, sec-fetch-site, user-agent) · `Idempotency-Key` อ่านใน `idempotent()` ด้วย schema เดียวกันใน `common.ts`
- input ที่ไม่ผ่าน schema ตอบแบบเดิมของ route นั้นทุกตัวอักษร: ค่าเริ่มต้น = 400 "กรอกข้อมูลไม่ครบ N ช่อง" + `details.fields`
  (assertValid) · `invalid: { part: status }` = status นั้นกับข้อความของ route เอง ("id required", "unknown export: x") ·
  ค่าที่ route เคยมองข้าม (choice นอกรายการ, ชื่อ query อื่น = filter, field ที่ไม่รู้จัก) ยังรับ (`choice()` / `flag` / loose object)
- body ที่ตรวจด้วย form schema คงที่ใช้ schema ตัวนั้นเลย · body ที่ service ตรวจเทียบข้อมูลเดิม (`customerSchema(prev)`,
  `jobSchema(keep, check)`, `saleOrderSchema(prev)` …) ประกาศเป็น**ส่วนคงที่**ของชุดกฎเดียวกัน (`customerFields`, `quotationFields`,
  `userFields` หรือ `.shape` ของชุดกฎ โดยช่องที่ขึ้นกับค่าเดิมเหลือแค่ชนิด) + ชนิดของช่องที่กฎไม่ได้ประกาศ — route parse ส่วนนี้,
  service รันชุดกฎเต็มเหมือนเดิม (กฎ "never worse" อยู่ที่ service)
- `src/server/contract/openapi.ts` สร้าง OpenAPI 3.0 → `/api/openapi.json` (ผู้ใช้ที่อนุมัติแล้ว) และ `npm run docs:api` → `/api-docs` (APIDoc v5 แบบ OneLink,
  ผู้ใช้ที่อนุมัติแล้วทุกคน, CSP nonce ต่อ response, Try it ยิง host เดียวกันด้วย session ของผู้ดู, คู่มือไทย/อังกฤษใน `docs/api/guides`)
- **คำตอบถูกตรวจกับสัญญา** นอก production: `checked()` ใน `src/server/auth.ts` (รวมอยู่ใน `handle()`) → `src/server/contract/check.ts` ·
  `next dev` = log `API contract drift` · test (`API_CONTRACT_STRICT=1`) = throw · production ไม่ตรวจเลย (`checked` คืน handler เดิม)
- `scripts/test-openapi.mts` (npm test): ทุก route file มีในสัญญาด้วย verb ตรงกัน และกลับกัน, ชื่อ resource ของ `/data` ตรงกับ `resources.ts`,
  endpoint สาธารณะ = `/health`, `/sso/*`, `/track/*` และ snapshot `tests/fixtures/openapi.snapshot.json` · `scripts/test-api.mts` (test:db) เรียกทุก operation กับ DB ทดสอบ
  และตรึงคำตอบเมื่อ input ไม่ผ่าน (ข้อความเดิมของ route)
- **type parity**: `scripts/test-response-types.ts` — `z.input` ของ response schema ต้อง**เท่ากับ** type ของ service (Date → string)
  ทุกตัวใน `shapes.ts` + คำตอบที่ประกาศกับ operation · `tsc --noEmit` ล้มเมื่อฝั่งใดฝั่งหนึ่งเปลี่ยน

## Consequences

- ช่องในเอกสาร = ช่องที่ API ส่งจริง (ทดสอบแล้ว) · เพิ่ม endpoint มีขั้นตอนตายตัว (AGENTS.md § Adding an API endpoint) และพิธีมากกว่า route เปล่า
- เพดาน: type ของ input ใน service (`CustomerInput`, `JobInput` …) เก่ากว่าสัญญา — route ส่ง body ที่ parse แล้วด้วย cast แบบ
  `readJson<T>` เดิม (service อ่าน null เป็น "ไม่มี") · คำขอที่ผิดหลายจุดพร้อมกันโดยตรง (ไม่ผ่านหน้าเว็บ) อาจได้ 400 ของส่วนคงที่ก่อน
  404 / ข้อผิดพลาดของช่องที่ขึ้นกับค่าเดิม · response ที่ test ไม่ได้ยิงถึง (อัปโหลดสำเร็จ, directory search สำเร็จ) ตรวจเฉพาะตอนมีคนใช้ใน dev
