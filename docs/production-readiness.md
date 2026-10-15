# OneService → Production-ready (เทียบ OneLink)

ที่มา: agent 5 ตัววิเคราะห์เทียบ OneLink (`../shd_onelink`) กับ OneService เมื่อ 2026-10-14 (branch `yuu`)
ทุกข้อตรวจกับโค้ดจริงแล้ว · path อ้างอิงจาก `shdservice/` · OL = `shd_onelink/shortlink_shd_io/`

สถานะ: `[ ]` ยังไม่ทำ · `[x]` เสร็จ · `[~]` ทำบางส่วน/รอ verify · `[-]` ตัดสินใจไม่ทำ

> **Render ไม่ได้ sync กับ `render.yaml`** — dashboard คือของจริง ทุกค่าที่แก้ใน render.yaml ต้องตั้งใน dashboard ด้วยมือ
Effort: S < 2 ชม. · M ครึ่ง–1 วัน · L > 1 วัน

> กฎ: ทำทีละข้อ, typecheck + lint ผ่านก่อน, อัปเดต checkbox ในไฟล์นี้ทันทีที่เสร็จ
> ห้ามรัน `setupdata/load_supabase.sh`, `db:migrate:reset`, `test:track` กับ DB production

---

## สถานะปัจจุบัน (วัดจริง)

| เรื่อง | ค่า |
|---|---|
| `tsc --noEmit` | ผ่าน 0 error (strict) · ถ้าเปิด `noUncheckedIndexedAccess` = 157 error |
| `eslint .` | 0 error / 0 warning (263 ไฟล์) |
| tests | `test:schemas` 33 ผ่าน · `test:track` 72 เคส แต่ยิง DB จริง · ไม่มี `npm test` |
| `npm audit --omit=dev` | 3 high / 2 moderate (next 16.3.6, sharp 0.35.4, source-map-js, uuid) |
| CI | ไม่มี `.github/` |
| E2E | ไม่มี |

---

## P0 — ช่องโหว่ / prod พัง / ข้อมูลเสีย (ทำก่อน)

- [x] **P0-1 Open redirect หลัง login** · S
  `safeNext` (`src/lib/sso.ts:21-25`) เช็กแค่ string → `/%09/evil.example` (tab) ผ่าน แล้ว `new URL()` พาออกไป `https://evil.example`
  ใช้ได้ทั้ง `/api/sso/login?next=` และ `continueIfSignedIn` ใน callback (ไม่ต้องมี code)
  ✅ 2026-10-14: `safeNext` parse ด้วย URL parser · `npm run test:auth` (13 เคส)

- [x] **P0-2 API อ่านข้อมูลไม่เช็กสิทธิ์ view ตาม role** · M
  ✅ 2026-10-14: review: ไม่มี role ที่ใช้งานจริงโดน 403 (ตรวจทุก hook/route/print) · เพิ่ม guard ให้ print `/job/[no]/return` + `/label` ผ่าน `print/job/[no]/layout.tsx`
  `readResource` (`src/server/resources.ts:45`) ใช้แค่ `requireUser` → user ที่ approve แล้วทุก role ดึง `customers?limit=5000`, `quotations`, `sale_orders`, report summary ได้หมด
  detail GET ก็เหมือนกัน: `jobs/[no]`, `quotations/[no]`, `sale-orders/[no]`, `products/[code]`, `stock/movements/[no]`, `stock/pick-lines`, `customers/lookup`, `jobs/[no]/calls`, `attachments/[id]`, print pages (`src/app/print/layout.tsx`)
  แต่ export (`src/server/export.ts:278`) เช็ก `requireCan(module,"view")` ถูกแล้ว → JSON กับ xlsx ไม่ตรงกัน
  แก้: map `resource → module | "any" | null` (ใช้ `SPECS[*].module` ของ export), `requireCan` สำหรับ resource ที่มีข้อมูลลูกค้า/เอกสาร, `requireAdmin` สำหรับ `*_summary`, lookup (status/province/staff/model/symptom) คง `requireUser`
  ✅ 2026-10-14: `READ_ACCESS` ใน `resources.ts` + `requireView`/`canViewAny`/`JOB_MODULES` ใน `auth.ts` · detail GET 8 route · print 3 หน้า
  ⏳ ยังต้องทดสอบมือ: login ด้วย role ที่ไม่ใช่ admin (เช่น ช่าง/คลัง) เปิดทุกหน้าที่ role นั้นมีสิทธิ์ ต้องไม่เจอ 403 · products/staff/masters ยังเปิดให้ทุก user (catalog ไม่มี PII)

- [x] **P0-3 dependency มี advisory ระดับ high** · S
  `next@16.3.6` (SSRF image optimizer, cache poisoning) → 16.3.8 · `sharp@0.35.4` (librsvg CVE — SVG ที่ส่งมาเป็น `image/png` ไปถึง librsvg ผ่าน `/api/upload`) → 0.35.5
  `next.config.mjs`: `poweredByHeader: false`, `images: { unoptimized: true }` (ไม่มีใครใช้ `next/image`)
  ✅ 2026-10-14: next/eslint-config-next 16.3.8, sharp 0.35.5, source-map-js fix · เหลือ 2 moderate (uuid ผ่าน exceljs — ต้อง override, ดู P2) · `next build` ผ่าน

- [x] **P0-4 แก้ SO ระหว่างอนุมัติ → ตัดสต็อกซ้ำ** · S
  `sale-orders.ts:293` อ่าน `prev` ใน tx โดยไม่ lock → edit ทับ approval, ลบ line ที่ stamp `pickInventoryNo` แล้ว → อนุมัติใหม่ตัดสต็อกอีกรอบ
  แก้: `.for("update")` ที่ `sale-orders.ts:293` และ `quotations.ts:349`
  ✅ 2026-10-14

- [x] **P0-5 เลขเอกสารซ้ำตอนขึ้นปีใหม่ (1 ม.ค. 2570)** · S
  `running-no.ts:62-101` แถวของปีใหม่ยังไม่มี → `FOR UPDATE` ไม่ล็อกอะไร → 2 tx insert แถวใหม่ทั้งคู่ ได้ `…00001` ซ้ำ
  `running_no` ไม่มี unique · `quotation_no`, `sale_out_hd_no`, `inventory_no` ไม่ unique → บันทึกเลขซ้ำเงียบ
  ✅ 2026-10-14: ใช้ `pg_advisory_xact_lock(hashtext(type:year))` ก่อน select (ไม่ต้อง migration) · `npm run test:running-no` (ต้องมี Postgres local) — โค้ดเก่าได้ WHI2600001 ซ้ำ 20/20, โค้ดใหม่ unique 20/20
  หมายเหตุ: `pyear` เก็บปี ค.ศ. (2026) ไม่ใช่ พ.ศ. · unique index บนเลขเอกสาร ย้ายไป P1-DATA-5

- [x] **P0-6 DB pool: connection หลุดทำ process ตาย / request ค้างไม่มีกำหนด** · S
  `src/db/client.ts:19-30` ไม่มี `pool.on("error")` (idle socket หลุด = uncaught exception), ไม่มี `connectionTimeoutMillis` (default รอตลอดไป), ไม่มี `statement_timeout`, `max: 5`
  ✅ 2026-10-14: error listener, connection timeout 10s, idle 30s, statement_timeout 30s · `DB_POOL_MAX` ยังเป็น 5 — ปรับใน Render หลังเช็ก pool size ของ Supabase

- [x] **P0-7 Deploy pipeline** · S (+ ต้องเช็ก Render dashboard)
  `render.yaml:10` รัน `db:migrate` ใน `buildCommand` ก่อน `next build` → build พังแต่ schema เปลี่ยนไปแล้ว
  `render.yaml:7` เขียน `main` แต่ prod deploy จาก `yuu` จริง (`main` ตามหลัง 95 commits)
  แก้: `buildCommand: npm ci --include=dev && npm run build`, `preDeployCommand: npm run db:migrate`, `startCommand: node node_modules/next/dist/bin/next start` (SIGTERM ถึง Next), `TZ: Asia/Bangkok`
  `healthCheckPath` ใส่หลัง P1-OPS-3 (health ต้องตอบ 200 เสมอ ไม่งั้น Supabase สะดุดแล้ว Render restart instance)
  ✅ 2026-10-14: buildCommand ไม่มี migrate, `preDeployCommand: npm run db:migrate`, start Next ตรง, `TZ=Asia/Bangkok`
  ✅ prod deploy จาก `yuu` (ยืนยันแล้ว) → `render.yaml` แก้ `branch: yuu` ให้ตรง · ถ้า service ไม่ได้ sync กับ blueprint ต้องตั้ง preDeploy/start/TZ ใน dashboard เอง

- [x] **P0-8 กันสคริปต์ลบ DB production** · S
  `setupdata/load_supabase.sh` รัน `DROP TABLE … CASCADE` 52 ตาราง ไม่มีถาม · README บอกให้รันซ้ำได้
  `scripts/migrate.ts:46-64` reset journal เองอัตโนมัติถ้าไม่เจอ `app_user.lark_id`
  dev ใช้ `.env` ที่ชี้ Supabase pooler — `next dev`/`db:migrate:reset`/`test:track` ยิง DB จริงได้ทันที
  ✅ 2026-10-14: `load_supabase.sh` ปฏิเสธ project prod (`bnntps…`) เว้นแต่ `I_UNDERSTAND_THIS_DROPS_PRODUCTION=1` + ต้องพิมพ์ DROP ยืนยันทุกครั้ง · `migrate.ts --reset` กับ prod ต้อง `ALLOW_PROD_DB=1`, บน Render ไม่ reset journal เอง · `next dev` กับ DB prod ต้อง `ALLOW_PROD_DB=1` (dev ใช้ Docker dev DB แล้ว — `.env` = production `bnntps…`) · README เตือนแล้ว

---

## P1 — ต้องมีก่อนเรียกว่า production-ready

### Auth / Session
- [-] **P1-AUTH-1 ระบุตัวผู้ใช้ด้วย `sub` แทนอีเมล** · M–L
  ✅ 2026-10-14: **ไม่ทำ** — บัญชีที่เคย error login ได้แล้วหลังอ่าน `identity.email` ชั้นบนแบบ OneLink (YAGNI) · เก็บ `sub` ใน cookie แล้วสำหรับ AUTH-8
  ปัจจุบัน key ด้วยอีเมล → บัญชี Lark ไม่มีอีเมล login ไม่ได้, เปลี่ยนอีเมล = ได้ user ใหม่ (pending) role เก่าค้าง, อีเมลถูก reuse = คนใหม่ได้ role เดิม
  แก้: migration `app_user.sso_sub` + unique partial index · callback ต้องมี `sub` · หา `sso_sub` → fallback อีเมลแล้ว stamp sub → insert ใหม่ (อีเมล NULL ได้) · `SessionUser.sub`, `resolveUser`/cache key ด้วย sub (fallback อีเมลสำหรับ cookie เก่า)
  ก่อนทำ: เปิด shape debug (P1-AUTH-7) ดู verify response จริง 1 ครั้ง
- [x] **P1-AUTH-2 DB สะดุดแล้ว user โดนเด้ง logout** · S
  `api/sso/me/route.ts:12`, `api/sso/refresh/route.ts:27-31` กลืน `HttpError(503)` เป็น 401 + ลบ cookie → ตอบ 503 ไม่แตะ cookie
  ✅ 2026-10-14: 503 ไม่ลบ cookie (client ถือว่า non-401 = ชั่วคราวอยู่แล้ว)
- [x] **P1-AUTH-3 timeout ขาออก SSO/directory** · S
  verify (`callback/route.ts:77`) 10s · `searchDirectory` 10s · `lookupByEmail` 3–5s (คืน null อยู่แล้ว)
  ✅ 2026-10-14: verify 10s, search 10s, lookupByEmail 4s
- [x] **P1-AUTH-4 CSRF origin check** · S
  copy `isCrossSite` (OL `lib/api/same-origin.ts`) → `src/proxy.ts` ตอบ 403 ให้ non-GET `/api/*` ที่ cross-site · `readJson` บังคับ `application/json`
  ✅ 2026-10-14: proxy ตอบ 403 `cross_site_write_refused` + `readJson` บังคับ `application/json` (415) และ cap 1MB (413) — ทดสอบ curl แล้ว
- [x] **P1-AUTH-5 first login ชน unique index → "DB unavailable"** · S
  `ix_username_and_password (username,password)` + username = local part ของอีเมล, password `''` → `somchai@a` ชน `somchai@b` · 2 tab login พร้อมกันชน `ux_app_user_email`
  แก้: จับ `23505` ใน `provisionSsoUser` — email ชน → re-read, username ชน → เติม suffix
  ✅ 2026-10-14: จับ 23505: `ux_app_user_email` → อ่านแถวเดิม, `ix_username_and_password` → เติม suffix
- [x] **P1-AUTH-6 owner hard-code ลบไม่ได้** · S
  `DEFAULT_OWNERS` ใน `src/lib/access.ts:13-25` ถูก force เป็น admin + ACTIVE + undelete ทุก login → prod ใช้ `OWNER_EMAILS` อย่างเดียว, ไม่ force ACTIVE ถ้า admin ปิดไว้
  ✅ 2026-10-14: production ใช้ `OWNER_EMAILS` อย่างเดียว · owner = bootstrap เฉพาะแถวที่ยังไม่มี role · admin เปลี่ยน role/ปิดได้
- [x] **P1-AUTH-7 PII ใน log ของ SSO + shape debug** · S
  ✅ 2026-10-14: redact อีเมล + `SSO_DEBUG=shape` (log `sso verify shape`: ชื่อฟิลด์/ชนิด/ความยาว ไม่มีค่า)
  `callback/route.ts:91` log body 300 ตัวอักษร (มีอีเมล) → regex redact แบบ OL · copy `sso-debug.ts` (`SSO_DEBUG=shape`)
- [x] **P1-AUTH-8 เช็ก session กลาง (`/sso/session`)** · M (หลัง AUTH-1)
  ✅ 2026-10-14: `centralSessionActive()` ใน `sso.ts` · `/api/sso/refresh` ถามทุก 5 นาที · `SSO_SESSION_CHECK=log` (default, ไม่ sign out ใคร) → `enforce` เมื่อ log ขึ้น "sso central session active" · ไม่ตอบ = คง session · log "skipped: no sub" ให้เห็นถ้าไม่มี sub
  คนลาออก/ถูกปิดที่ SSO ยังใช้ได้ถึง 12 ชม. → ใน `/api/sso/refresh` เช็กทุก 5 นาที (copy OneBridge `lib/auth/sso.ts:76-98`, grace 30 นาทีถ้า unavailable) · ลบ `sid` ที่ไม่มีใครใช้

### Security
- [x] **P1-SEC-1 Origin auth ยังเป็น `log`** · S · 👤 งานของคุณ: ดู log `origin_auth_failed` แล้วสลับใน dashboard (ตอนนี้ env check log เตือนทุกครั้งที่ start) — `render.yaml:58` → ดู log `origin_auth_failed` แล้วเปลี่ยนเป็น `enforce` (ตอนนี้ยิงตรง `onrender.com` ข้าม WAF + ปลอม `X-Forwarded-For` reset rate limit ได้)
  ✅ 2026-10-14: prod เป็น `enforce` แล้ว (dashboard ไม่มี ORIGIN_AUTH_MODE → default production) · ผู้ใช้ผ่าน Cloudflare ใช้ได้ (ยืนยันกับผู้ใช้)
- [x] **P1-SEC-2 ตรวจไฟล์อัปโหลด** · M — type ว่างผ่าน, นามสกุลจากชื่อไฟล์ user, ไม่เช็ก magic bytes, `/api/attachments` ไม่มี rate limit/Content-Length/เช็ก jobNo → `assertFile()` ใน `storage.ts` (copy `SIGNATURES` จาก OL `validate.ts:302-343`), นามสกุลจาก MIME
  ✅ 2026-10-14: `fileProblem()` ใน storage.ts: ไม่ว่าง, ≤10MB, type ใน allowlist (type ว่าง = ปฏิเสธ), magic bytes ตรง type · นามสกุลจาก MIME ไม่ใช่ชื่อไฟล์ · รูป/โลโก้รับแค่ภาพ · `/api/attachments`: rate limit + Content-Length ก่อน buffer + jobNo ต้องมีจริง · test 8 เคสใน test:schemas
- [x] **P1-SEC-3 Route เขียนข้อมูลที่ไม่มี schema** · M — `stock/issue`, `stock/receive`, `jobs/assign`, `sale-orders/[no]/approve|tracking`, `jobs/[no]/calls`, `admin/permissions` · `qty` ทศนิยม/ใหญ่ผ่าน → zod `int().positive().max()`, `.max()` ให้ text ตาม varchar
  ✅ 2026-10-14: `src/lib/validation/stock.ts`: receive, issue, assign, SO approve (enum — เดิมพิมพ์ผิด = reject), tracking, call log · qty จำนวนเต็ม 0–100,000, ≤500 บรรทัด · admin/permissions sanitize อยู่แล้ว · test 4 กลุ่มใน test:schemas · `.max()` ให้ text ทุก schema เดิม + strictObject = ยังไม่ทำ (P2)
- [x] **P1-SEC-4 OTP เดาได้** · S — 4 หลัก × 5 ครั้ง × 3 code/ชม. ไม่มี cap รายวัน → `otp_phone_day` 10/วัน, ล็อก phone 24 ชม. หลังผิด 15 ครั้ง, cap SMS รวมต่อชั่วโมง, ขอ OTP 6 หลัก
  ✅ 2026-10-14: cap 8 ครั้ง/วัน/เบอร์, ผิด 15 ครั้ง/วัน → ล็อกเบอร์ 24 ชม., cap SMS รวม 200/ชม. (เกินแล้วตอบเหมือนเดิมแต่ไม่ส่ง) · OTP 6 หลักยังไม่ทำ (ต้องตั้งที่ ThaiBulkSMS)
- [x] **P1-SEC-5 CSP หน้า staff + API** · S — มีแค่ `/track` · เพิ่ม `PAGE_CSP` (OL `lib/security-headers.ts`) ให้ `/:path((?!api/|track).*)` + `API_CSP` ให้ `/api` · ทดสอบกับ production build

  ✅ 2026-10-14: `PAGE_CSP` ทุกหน้ายกเว้น `/track` + `API_CSP` · เช็กแล้ว `/track` มี CSP เดียว
### Ops / Observability
- [x] **P1-OPS-1 `src/lib/log.ts` + scrub PII** · M — 31 `console.*` กระจาย · drizzle error มี `params:` (ชื่อ/เบอร์/ที่อยู่ลูกค้า, track token) → `logError(err, msg, fields, req?)` JSON บรรทัดเดียว, reqId จาก `cf-ray`/`rndr-id`, scrub `\nparams:`, log stack · ใช้ reqId เป็น ref ใน `handle()`
  ✅ 2026-10-14: `src/lib/log.ts` (JSON/บรรทัด, reqId = cf-ray, scrub `params:` + อีเมล) · `handle()` ใช้ reqId เป็นรหัสอ้างอิง + log stack · แทน console.* ทั้งหมดที่มี PII
- [x] **P1-OPS-2 `src/instrumentation.ts` + env check ตอน boot** · S–M — `src/server/env.ts` (REQUIRED vs OPTIONAL), required ใน prod (DATABASE_URL, SESSION_SECRET≥32, SSO_*, CENTRAL_API_KEY, SUPABASE_*, APP_BASE_URL, TURNSTILE_*, ORIGIN_AUTH_SECRET, TRACK_LOG_SECRET, TZ) · `ORIGIN_AUTH_MODE=enforce`, `SMS_PROVIDER≠log` · `process.exit(1)` · export `onRequestError` → `logError`
  ✅ 2026-10-14: `src/instrumentation.ts` + `src/server/env.ts` · production log รายการที่ขาด (ไม่ล้ม) · `ENV_STRICT=1` = ไม่ start · `onRequestError` → `logError`
- [x] **P1-OPS-3 Health endpoint** · S — anonymous ตอบ 200 `{ok:false}` แทน 503 · log ใน catch · admin เห็น TZ ของ DB/process + clock skew · แล้วใส่ `healthCheckPath` ใน render.yaml
  ✅ 2026-10-14: ตอบ 200 เสมอ (`{ok:false}`), log ใน catch, admin เห็น TZ ของ DB/process + clock skew · `healthCheckPath: /api/health` ใน render.yaml
- [x] **P1-OPS-4 timeout Storage** · S — `storage.ts:90` ใส่ fetch timeout 15s ให้ supabase client · `createBucket` ทุก upload → ครั้งเดียวต่อ process
  ✅ 2026-10-14: fetch timeout 15s ให้ supabase client · `createBucket` ครั้งเดียวต่อ process
- [x] **P1-OPS-5 TZ ของ process** · S — `storage.ts:96-98` ใช้ `getHours()` (UTC บน Render) → ใช้ `@/lib/dates`
  ✅ 2026-10-14: ชื่อไฟล์ใช้ `isoDateTime` (Bangkok)
- [x] **P1-OPS-6 Error boundaries** · S — `src/app/(app)/error.tsx` (ข้อความไทย + digest + ปุ่มลองใหม่), `src/app/global-error.tsx`, (ออปชัน) `src/app/track/(site)/error.tsx` · `(app)/layout.tsx:38-43` grants โหลดพลาด → ไม่ใช่ส่งไป `/pending`
  ✅ 2026-10-14: `(app)/error.tsx`, `app/error.tsx` (error จาก layout), `global-error.tsx` · grants โหลดพลาด → error page แทน `/pending`
- [ ] **P1-OPS-7 Uptime monitor + error tracking** · S · 👤 สมัคร UptimeRobot/Better Stack ชี้ `/api/health` เช็ก body `"ok":true` — UptimeRobot/Better Stack เช็ก `/api/health` body `"ok":true` · (ออปชัน) Sentry ผ่าน `onRequestError`
- [ ] **P1-OPS-8 `ops/runbook.md` + `ops/risks.md`** · M — deploy, rollback (forward-only, expand/contract), หมุน `SESSION_SECRET`, SSO/DB/SMS/Turnstile ล่ม, restore backup, ห้ามรัน `load_supabase.sh` · เช็ก backup/PITR ของ Supabase + bucket ไฟล์ไม่อยู่ใน backup

### Data / API
- [x] **P1-DATA-1 Job ไม่ lock แถว** · S–M — `jobs.ts` updateJob/saveRepair/saveOutsource/swap/closeJob อ่าน status นอก tx → `lockJob(tx,no)` `FOR UPDATE` ทุก tx แล้วส่ง status ให้ `setStatus`
  ✅ 2026-10-14: `lockJob(tx)` FOR UPDATE ใน saveRepair/saveOutsource/closeJob + `.for("update")` ใน updateJob/saveSwapRefund/markPartsIssued + assignJobs lock เรียงตาม job_no · setStatus เทียบกับ status ที่ lock แล้ว
- [x] **P1-DATA-2 Export ตัดแถวเงียบ + OOM** · M — customers cap 5,000 (มี 43k) · in-memory workbook บน 512MB → cap ชัด + แจ้ง "ตัดที่ N แถว" หรือ stream writer
  ✅ 2026-10-14: cap เดียว 20,000 ทุก list (customers/movements จาก 5k) · ถึง cap = แถวเตือนท้ายไฟล์ + ชื่อไฟล์ `-partial` · ยังสร้างใน memory (stream = P2 ถ้าต้องการเกิน 20k)
- [x] **P1-DATA-3 แปลง Postgres error** · S — `handle()` 23505 → 409 "ข้อมูลซ้ำ", 57014 → 503 · `resources.ts:151` ใช้ `HttpError(404)`
  ✅ 2026-10-14: `handle()`: 23505 → 409, 57014 → 503, 08006/57P01 → 503 · unknown resource → 404
- [x] **P1-DATA-5 Unique index เลขเอกสาร** · S — เช็กเลขซ้ำใน prod (`quotation_no`, `sale_out_hd_no`, `inventory_no`, `running_no(type,company,pyear)`) แล้วสร้าง unique (partial ถ้า legacy ซ้ำ) เป็นตาข่ายชั้นสุดท้าย
  ✅ 2026-10-14: `drizzle/0022` unique index `quotation_no` / `sale_out_hd_no` / `inventory_no` — ข้ามพร้อม NOTICE ถ้ามีเลขซ้ำ (dev copy ไม่มีซ้ำ) · running_no ไม่ต้องใช้ (advisory lock แล้ว)
- [x] **P1-DATA-4 list โหลดพลาดแสดง "ไม่พบข้อมูล"** · S — `DataTable` รับ `error` + `onRetry` แล้วส่งจาก 14 หน้า list

  ✅ 2026-10-14: `DataTable`/`ReportView` รับ `error` + `onRetry` · ต่อครบ 16 หน้า list/report
### Testing / CI
- [x] **P1-CI-1 test DB local + guard** · M — `tests/docker-compose.yml` (postgres:17, tmpfs), guard host localhost, seed ขั้นต่ำ, ย้าย `test-track` มาใช้ seed
  ✅ 2026-10-14: `tests/docker-compose.yml` (port 55442), `tests/prepare-db.mts` (pgcrypto + migrate), `tests/db-url.mts` guard localhost, `tests/seed.mts` · `test-track` ไม่อ่าน `.env` แล้ว — 81/81 ผ่าน
- [x] **P1-CI-2 `npm test`** · S — `tsx --test` (node:test, ไม่ต้องเพิ่ม dep) · เริ่มจาก test pure: session, origin-auth, dates, thai-baht, paging, safeNext
  ✅ 2026-10-14: `npm test` (schemas + auth) · `npm run test:db` (running-no + track)
- [x] **P1-CI-3 Test สำคัญที่ต้องมี DB** · M — running-no (20 tx พร้อมกัน, ข้ามปี), api-guard (ทุก route เรียก require*), auth/permission matrix, stock ห้ามติดลบ, SO approve ซ้ำ
  ✅ 2026-10-14: `scripts/test-domain.mts` 25 เคส: permission matrix (can/canViewAny/requireView + `/api/data` ตาม role, pending, INACTIVE, session_version), สต็อกห้ามติดลบ (409, rollback ทั้งเอกสาร), SO อนุมัติซ้ำ/เบิกก่อนอนุมัติ/แก้หลังอนุมัติ = 409, deadlock 20 movement, job race (1 job_log) · พิสูจน์ว่า test ล้มจริงเมื่อถอด lockStock/lockJob/เช็ก
  ✅ 2026-10-14: บางส่วน: api-guard (static, ทุก handler ใน `test:auth`), running-no, track 81 เคส · ยังขาด: permission matrix, stock ห้ามติดลบ, SO approve ซ้ำ
- [x] **P1-CI-4 GitHub Actions** · M — postgres service, `npm ci` → lint → tsc → migrate ×2 (idempotent) → test → build → `npm audit --audit-level=high` → gitleaks · pin action ด้วย SHA (copy OL `.github/workflows/ci.yml`) · แล้วใส่ `autoDeployTrigger: checksPass`
  ✅ 2026-10-14: `.github/workflows/ci.yml` (lint, tsc, test, migrate ×2, test:db, audit high, build, gitleaks — action pin SHA) · gitleaks ทั้ง 133 commit สะอาด · `autoDeployTrigger: checksPass` อยู่ใน render.yaml — **ต้องตั้งใน dashboard** (Auto-Deploy → After CI Checks Pass) เพราะ blueprint ไม่ sync · migrate รอบสองใช้ `--reset` (รันซ้ำทุกไฟล์จริง)
- [ ] **P1-CI-5 Branch flow** · S — ตัดสินใจ flow (`yuu`→PR→`main` หรือ `develop`→`release` แบบ OL), เขียน `CONTRIBUTING.md`, protect branch
- [x] **P1-CI-6 Dependabot + CODEOWNERS + gitleaks config** · S
  ✅ 2026-10-14: `.github/dependabot.yml` (target-branch yuu — มีผลเมื่อไฟล์อยู่บน default branch `main` หรือเปลี่ยน default เป็น yuu) · CODEOWNERS (บังคับได้เมื่อเปิด branch protection — P1-CI-5) · gitleaks ใน CI
- [x] **P1-CI-7 `.nvmrc` 24 + `engines`, README อัปเดต (Next 16, Node 24)** · S

  ✅ 2026-10-14: `.nvmrc` 24, `engines >=24`, README อัปเดต Next 16 / Node 24 + ส่วน Tests
---

## P2 — ดีถ้ามี

- [x] E2E Playwright + fake SSO (ต้องทำ `SSO_ORIGIN` env ก่อน — ตอนนี้ hard-code ใน `sso.ts:5-7`, `directory.ts:12`) · L
  ✅ 2026-10-14: `SSO_ORIGIN` env (prod ต้อง https — env check) · fake SSO (`tests/e2e/support/fake-sso.ts`) · 5 spec: owner login→dashboard, unknown→/pending, role ไม่มี Customer view → เมนูซ่อน + API 403, เปิดงานได้เลข, open redirect · ทุก spec ล้มถ้ามี CSP violation · CI job `e2e` · `/track` ข้าม (production ปฏิเสธ Turnstile test key + SMS log)
- [x] `noUncheckedIndexedAccess` ทีละโฟลเดอร์ (เริ่ม `src/db`, `src/server`) · M
  ✅ 2026-10-14: เปิดทั้งโปรเจกต์ แก้ 168 จุดตามความหมาย (throw ชัดเจนเมื่อ query ต้องได้แถว, `totalOf()`, รายการคงที่ type `[string, ...string[]]`) · ไม่มี @ts-ignore / as any · `!` 1 จุด (thai-baht, มี comment) · `npm run typecheck` ใน CI · masters update id ที่ไม่มี → 404
- [x] Prettier + `.git-blame-ignore-revs` · S
  ✅ 2026-10-14: config เดียวกับ OneLink (single quote, 120) · `npm run format` / `format:check` (ขั้นแรกใน CI) · eslint-config-prettier · ลบ comment ไร้ประโยชน์/แก้ comment ล้าสมัย ~15 จุดก่อนจัดรูปแบบ
- [x] ADR (`adr/`) ย้ายการตัดสินใจจาก `backend-rebase-plan.md`: timestamp ไทยไม่มี TZ, soft delete `record_status`, single instance cache, track fail-closed · M
  ✅ 2026-10-14: `adr/` 0001–0006 (+ DB production safety, แบ่งงาน agent) · plan §0/§13/§31/§35 ลิงก์ไป ADR แทนข้อความเดิม · README ลิงก์
- [x] Logout เป็น POST + cross-site check · S
  ✅ 2026-10-14: GET แต่ปฏิเสธ `Sec-Fetch-Site` cross-site/same-site (ลิงก์จากเว็บอื่น logout ไม่ได้)
- [x] ข้อความ login error แยกตาม `verify_400/401/403/unreachable` + แก้ข้อความ `server_not_configured` · S
  ✅ 2026-10-14: `verify_400/401/403/5xx` + ข้อความ `server_not_configured` ถูกต้อง
- [x] บัญชีถูกปิด/ลบแสดง "บัญชีถูกปิด" แทน "รออนุมัติ" · S
  ✅ 2026-10-14: `/api/sso/me` ส่ง `disabled` · `/pending` แสดง "บัญชีถูกปิดการใช้งาน"
- [x] N+1: `assignJobs`, `savePermissions`, `productsByCode` ใน loop · S
  ✅ 2026-10-14: assignJobs (UPDATE เดียว + audit batch), savePermissions (UPSERT เดียว), productsByCode ก่อน loop
- [x] Stock lock เรียงตาม productId กัน deadlock · S
  ✅ 2026-10-14: `lockStock()` lock ทุกแถวที่จะแตะครั้งเดียวเรียง product_id (ลำดับบรรทัดเอกสารคงเดิม) · ทดสอบ 40 movement สลับลำดับ ผ่าน
- [x] `listProductsLite` cache + index (`job_call_log.job_no`, `job.product_model_id`, partial spare part) · S
  ✅ 2026-10-14: cache + invalidate หลัง commit · `drizzle/0023` 3 index
- [x] clamp `limit` query (NaN → 500) · `Object.hasOwn` ใน sort · validate date · S
  ✅ 2026-10-14: `clampInt`, `ymd()` (วันที่ผิด = ไม่กรอง), `Object.hasOwn` · JSON customers/movements cap 5k
- [x] cache `jobStats`, `Promise.all` ใน `computeDashboard` · S
  ✅ 2026-10-14: jobStats cache 30s · dashboard Promise.all
- [x] proxy matcher ไม่รันกับ `_next/static`, cache logo, ลด font (Inter ซ้ำกับ Noto) · S
  ✅ 2026-10-14: matcher ข้าม `_next/static`, `_next/image`, favicon/robots, รูประดับบนสุด (= public/) — ตรวจกับ build ที่ `enforce`: หน้า/`/api/*`/`/api/files/x.png`/`/track` ยัง 403 ไม่มี header, `/track` ยังได้ nonce · รูปใน public/ `max-age=86400, stale-while-revalidate=604800` (เดิม 0) · Logo โหลดเฉพาะสีที่เห็น (`loading=lazy`) · ตัด Inter: font 10 ไฟล์ 292 KB → 3 ไฟล์ 74 KB, preload 106 → 58 KB
- [x] Rate limiter: cap ขนาด map + IPv6 /64 · S
  ✅ 2026-10-14: เพดาน 20,000 bucket (ทิ้ง 1/10 ที่เก่าสุด) · `ipBucket()` ใน `client-ip.ts` ใช้กับ key ของ `rate-limit.ts` + `trackCtx().ipKey` + 3 หน้า `/track` (IP เต็มยังใช้ผูก ticket/Turnstile) · `npm run test:rate-limit` · ยังไม่ทำ: key `phone-ip` ใน `track-otp.ts`
- [x] `proxyClientMaxBodySize: "11mb"` (ตอนนี้ไฟล์ ~10MB ถูกตัดเงียบ) + cap JSON 1MB · S
  ✅ 2026-10-14: `12mb` + readJson cap 1MB นับเป็น byte
- [x] DB TLS verify cert (`rejectUnauthorized: false`) · S · 👤 ใส่ `DB_SSL_CA` ใน Render
  ✅ 2026-10-14: `src/db/ssl.ts` (app + `db:migrate`) — ตั้ง `DB_SSL_CA` = verify (`rejectUnauthorized: true`), ไม่ตั้ง = เหมือนเดิม · pooler ใช้ CA ของ Supabase เอง ("Supabase Root 2021 CA", `prod-ca-2021.crt`, หมดอายุ 2031-04-26) — เช็กแล้วด้วย TLS handshake อย่างเดียว (ไม่ login): verify ผ่านกับ CA นี้, CA store ปกติของ Node ไม่ผ่าน · วิธีใส่ดู `.env.example`
- [x] hash `track_token` ใน DB · rate limit `/api/files` public · M
  ✅ 2026-10-14: `drizzle/0025` เพิ่ม `job.track_token_hash` (sha256 hex) + backfill + trigger ระหว่าง deploy ทับกัน — โค้ดใหม่เขียน/ค้นด้วย hash อย่างเดียว ลิงก์แสดงครั้งเดียวตอนสร้าง (UI: "สร้างลิงก์ใหม่") · `/api/files` path public 120/นาที/IP · test:track +3 เคส
  - [ ] **ต่อ (contract) หลัง deploy นี้ live แล้วเท่านั้น:** migration ใหม่ `UPDATE job SET track_token = NULL` + drop trigger/function `job_track_token_hash_sync` + drop index `ux_job_track_token` + drop column `track_token` · ลบ `trackToken` ใน schema + `trackToken: null` ใน `tracking.ts` (รายละเอียดหัวไฟล์ `drizzle/0025`)
- [x] Idempotency-Key สำหรับ create (เริ่ม stock receive/issue) · optimistic locking (updated_at) · M
  ✅ 2026-10-14: `drizzle/0026` · `idempotent()` (`src/server/idempotency.ts`) ครอบ POST jobs / quotations / sale-orders / customers / stock receive / issue — key เดิม + user เดิม + route เดิม = ตอบผลเดิม, ซ้อนกันระหว่างทำ = 409, ไม่มี header = เหมือนเดิม, ลบ > 24 ชม. · `postJson` ส่ง key ต่อ submit (body เดิม = key เดิม, สำเร็จแล้วออกใหม่) · ไม่มี `updated_at` ใน legacy → `row_version` + trigger bump ทุก UPDATE (รวมระบบเก่า; ไม่นับคอลัมน์ที่บันทึกทันทีที่อื่น: profile, slip, track link) · edit job / ใบเสนอราคา / SO / ลูกค้า ส่ง version → 409 "มีผู้อื่นแก้ไขเอกสารนี้ไปแล้ว กรุณาโหลดใหม่" + toast ปุ่มโหลดใหม่ · ไม่ส่ง version = เหมือนเดิม · test:domain 11 เคส
- [x] aria-sort, ข้อความ error ภาษาไทยทั้งหมด, create ตอบ 201 · S
  ✅ 2026-10-14: create ตอบ 201 (jobs, quotations/sale-orders/customers เมื่อสร้างใหม่, stock receive/issue) · aria-sort + ข้อความไทยทั้งหมด ยังไม่ทำ
  ✅ 2026-10-14: aria-sort ใน `data-table.tsx` แล้ว (ที่เหลือ: error ไทย, 201)

---

## Dogfood QA (2026-10-14 — agent-browser บน dev + fake SSO, ~60 หน้า, ไม่มี Critical)

ไม่มี crash / CSP violation / 403 ผิดที่ · ปัญหาทั้งหมดมีมาก่อนงานวันนี้ · หลักฐาน: screenshot 136 ไฟล์ใน scratchpad ของ session

- [x] **DF-002 (High) ค้นเบอร์โทรไม่เจอเมื่อเก็บแบบมีขีด** (~30% ลูกค้า) — เทียบเฉพาะตัวเลขทั้งสองฝั่ง + `drizzle/0024` trigram index บน expression (0.1 ms)
- [x] **DF-005 ฟอร์มลูกค้ารับตัวอักษรในเบอร์/รหัสไปรษณีย์/เลขภาษี** — เบอร์ ≥9 หลัก (รูปแบบเดิมที่มีขีด/สองเบอร์ยังผ่าน), รหัสไปรษณีย์ 5 หลัก, เลขภาษี 13 หลัก · ⚠️ ลูกค้าเก่าที่ข้อมูลผิดรูปแบบต้องแก้ช่องนั้นก่อนบันทึก
- [x] **DF-007 อัปโหลดตอน Storage ไม่ได้ตั้งค่า = 500** → 503 ข้อความไทย (`HttpError` แยกเป็น `src/server/http-error.ts`)
- [x] **DF-008 audit ไม่บันทึกการปิด/เปิดบัญชี** → `recordStatus` อยู่ใน diff แล้ว
- [x] บัญชีถูกปิดเรียก API ได้ "รอการอนุมัติ" → "บัญชีนี้ถูกปิดการใช้งาน"
- [x] **DF-001 (High) ปุ่ม "อนุมัติ" ให้ role Customer Service ทันที** — dialog เลือก role (ไม่มี default, ยืนยันได้เมื่อเลือกแล้ว)
- [x] **DF-003 role ดูอย่างเดียวเปิดงานไม่ได้** — `jobLink()` ไปใบรับงาน `/print/job/<no>?auto=0` เมื่อเปิดหน้าซ่อมไม่ได้ (รายการงาน + กระดิ่งงานเกินกำหนด)
- [x] **DF-004 ดูอย่างเดียวเห็นเมนู/ปุ่มบันทึก** — เมนู/command palette กรองตาม add/edit (`canLink`), หน้าเปิดตรง ๆ แสดง "ไม่มีสิทธิ์แก้ไข" แทนปุ่มบันทึก, 403 เป็นภาษาไทย · quotation/SO เปิดตรงแสดง notice เดียวกันแล้ว (2026-10-14)
- [x] **DF-006 การ์ด KPI** — ลิงก์ `?src=kpi&group=…` ตัวเลขการ์ด = ยอดในรายการ
- [x] DF-009 toast บังปุ่มบันทึก + ไม่บอกช่องที่ผิด · DF-010/015 ตาราง users/หัวเพจล้นที่ 1280px · DF-011 หน้าไม่มีสิทธิ์เด้งไป /admin/guide เงียบ ๆ · DF-012 print 404 console error · DF-013 ป้ายพัสดุพิมพ์ "ต. อ. จ." ว่าง · DF-014 ใบเสนอราคาพิมพ์ "xxxxxxxx" แทนเลขภาษี/บัญชีที่ไม่มี
  ✅ 2026-10-14: ทั้งหมด — toast อยู่เหนือ save bar + บอกชื่อช่อง, ตาราง/หัวเพจพอดี 1280px, หน้าไม่มีสิทธิ์ = toast "ไม่มีสิทธิ์เข้าหน้า …" และไม่ render/ยิง API ก่อน redirect, theme script ผ่าน `useServerInsertedHTML` (ครั้งเดียว, hash CSP /track ยังตรง — ตรวจกับ production build), print ซ่อนช่องว่าง/xxx (รวม return note)
- [x] **QA 2026-10-15 (งาน/สต๊อก)** — ยอดที่ต้องชำระ = `job_total_cost` − มัดจำ (`jobAmountDue`: ใบส่งคืน grand total + ตัวอักษร, ค่าเริ่มต้นจำนวนเงินที่ชำระตอนปิดงาน, CostSummary) · รับคืนจากการเบิกคิดราคาบรรทัดใหม่ (จ่าย − คืน) + คำนวณ `spare_part_total_cost`/`job_total_cost` ใน transaction เดียวกัน · สถานะ 8 "ลงเลขที่พัสดุแล้ว" ต้องมีเลขพัสดุ · วันที่รับ Out-Source ≥ วันที่ส่ง (schema + แถวที่ส่งไว้) · 409 สต๊อกบอกรหัส + คงเหลือ · export รายงานเบิกจ่ายใช้ `issuedWhere` เดียวกับหน้าจอ · อะไหล่ใช้มากสุด tie → รหัสน้อยสุด · กรองผู้สร้าง/ช่างเทียบชื่อแบบ `fullName()` (+ id) · audit ค่าเดิมของ assign / Out-Source
- [x] **QA 2026-10-15 (รายงาน/ลูกค้า/ใบเสนอราคา/a11y)** — รายงานการซ่อมกรองช่างด้วย id (เหมือนรายงานการขาย) + dropdown รายงานรวมคนที่ออกแล้วแต่ยังมีในข้อมูล "(ไม่ใช้งานแล้ว)" (`/api/data/staff?usedAs=engineer|sales`) · เบอร์โทรลูกค้า: ตัดอักขระล่องหน (U+200B–200F, 202A–202E, 2060, FEFF) + –/— → `-` ก่อนตรวจและก่อนบันทึก (`normalizePhone`) — 256 → 152 รายที่ยังมีข้อความในช่องเบอร์ ข้อเสนอแก้ข้อมูล `docs/data-cleanup.sql` (ยังไม่รัน, รอตัดสินใจ: ใช้ `fax_number` ที่ว่างทุกแถวหรือเพิ่มคอลัมน์ remark) · ใบเสนอราคาเก็บส่วนลดตามที่บันทึก (บาท/%, ฐานรวม/อะไหล่/บริการ) — ฟอร์มเดิมแปลงเป็น % ของยอดรวมทำให้ส่วนลด 8 ใบหาย · `drizzle/0027` บันทึกโดยไม่แก้อะไรไม่ขยับ `row_version` (`status_changed_at/by` ไม่นับเป็นการแก้) · drawer เมนูมือถือ Esc ปิด / focus เข้า-ออก · checkbox/จำนวนในตารางอะไหล่หน้าซ่อมมี aria-label · `npm run db:dev:migrate`

### Dogfood round 2 (2026-10-15 — กฎจากเจ้าของระบบ)

- [x] **งานส่ง Out-Source ต้องกลับมาก่อนปิดงาน** — ถ้ายังมีแถว `job_send_forward_dt` สถานะ "ส่งเครื่องซ่อมแล้ว" (ยังไม่บันทึกรับคืน) เปลี่ยนเข้าสถานะกลุ่ม Finished ไม่ได้ (400 ใต้ช่องสถานะ; หน้า ปิดงาน เตือนทันทีที่โหลดงาน) — งานที่ปิดไปแล้ว (7 → 8) ไม่ถูกบล็อก · บันทึกรับคืนแล้วงานที่ยังไม่มีวันที่ซ่อมเสร็จได้ `job_repaired_date` = วันที่รับคืน (ผู้บันทึก) และตอนปิดงานถ้ายังเป็น 1900 ใช้เวลาปิดงาน — งานไม่หลุดจากรายงานการซ่อม · ⚠️ ข้อมูลเดิมบน dev: งานสถานะ 5 ที่ยังมีแถวส่งค้าง 161 งาน ต้องบันทึกรับคืนก่อนปิด

## รูปแบบข้อมูลทุกช่องกรอก (2026-10-15 — ตรวจเทียบข้อมูลจริงใน dev DB)

- [x] **ฟังก์ชันกลาง** `src/lib/validation/index.ts`: `clean` / `cleanText` / `cleanCode` (ลบอักขระมองไม่เห็น, ช่องว่างแปลก, สระ/วรรณยุกต์ไทยที่พิมพ์เกินหน้าคำอังกฤษ, ตัวอักษรกรีก/รัสเซียที่หน้าตาเหมือนอังกฤษ), `maxText` / `maxNote`, `codeField(re, msg, prev)` (ค่าเก่าที่ไม่ได้แก้ผ่าน), `moneyField`, `trackingField` — service บันทึกค่าที่ล้างแล้ว ไม่ตัดข้อความเงียบ ๆ อีก (schema max = ความยาวคอลัมน์, input มี maxLength)
- [x] **รหัสอะไหล่ (ผู้ผลิต)** — A-Z 0-9 . _ / - ตัวพิมพ์ใหญ่ ไม่บังคับ (เจ้าของระบบเลือก) · 474 แถวเก่าไม่ผ่านแต่ยังบันทึกได้ถ้าไม่แก้ช่องนี้ · รหัสซ้ำกับสินค้าอื่น = เตือน
- [x] **งานซ่อม** — SO No., Serial (+ ช่องติ๊ก "ไม่มี S/N / S/N เสียหาย" เก็บเป็น `-`), IMEI 15 หลัก, เลขพัสดุรับเข้า/ส่งคืน, ช่องทาง/ประกัน/วิธีรับเข้า/บริษัทขนส่ง/ประเภทสินค้าต้องอยู่ในรายการ, ประกัน 0–60 เดือน, ช่วงวันที่, เงินทุกช่อง, New Serial ไม่ทับรายการอะไหล่เดิม, บันทึกการโทร ≤200 (เดิมตัด 800 ตัวทิ้ง)
- [x] **ข้อมูลหลัก** — ชื่อห้ามซ้ำ (ไม่สนตัวเล็ก/ใหญ่/ช่องว่าง) → 409, รุ่นซ้ำ → 409 (เดิม 500), รายละเอียดหมวดหมู่ 51+ ตัว → 400 (เดิม 500)
- [x] **ลูกค้า** — ชื่อห้ามเป็นตัวเลขล้วน, เบอร์ตรวจเฉพาะเมื่อแก้ / ลูกค้าใหม่ต้องมีเบอร์มือถือ (ใช้ OTP ได้), เลขผู้เสียภาษี 13 หลัก + check digit, รหัสไปรษณีย์ต้องตรงตำบล, อีเมล ≤50, Line ID
- [x] **ใบเสนอราคา / ใบสั่งขาย / สต็อก / ผู้ใช้ / ผู้ออกเอกสาร** — เลขงาน `J`+7 หลัก, จำนวนเต็ม, VAT 0/7, เงินไม่เกินคอลัมน์ (เดิม 500), เลขพัสดุ, PO ref, จ่ายให้ต้องอยู่ในรายการ, อีเมล/ชื่อผู้ใช้ซ้ำ → 409 (เดิมแก้ทับผู้ใช้อื่นเงียบ ๆ), check digit เลขภาษี
- [x] **บั๊กที่เจอระหว่างทำ** — ปิดงานเติมคำนำหน้าซ้ำทุกครั้งจนถูกตัด, แก้งานแล้วสีสินค้าหาย, แก้หมวดหมู่แล้วรหัสย่อหาย, บันทึกสินค้าที่ไม่ส่งราคาแล้ว error
- [ ] **ทำความสะอาดข้อมูลเก่า** — `docs/data-cleanup.sql` + `docs/data-cleanup-jobs.sql` (ยังไม่รัน — นับใหม่บน production ก่อน, ระวัง 32 รหัสผู้ผลิตที่ตัด `Cancel_` แล้วชนกัน)

## จุดแข็งที่มีอยู่แล้ว (ห้าม regress)

- Session: HMAC cookie, idle 30 นาที + absolute 12 ชม., `session_version` logout ทุกเครื่อง, role/status อ่านจาก DB ทุก request (DB ล่ม = 503 ไม่ trust cookie)
- Authz fail-closed เมื่อไม่ได้ตั้งค่า (OL ให้สิทธิ์เต็ม — อย่า copy)
- `/track` public: Turnstile fail-closed, ticket ใช้ครั้งเดียว, rate limit ใน Postgres, HMAC IP, CSP nonce + strict-dynamic — ดีกว่า OL
- ไม่ auto-redirect anonymous ไป SSO (บทเรียน Google Web Risk)
- `handle()` ตอบ 500 แค่ ref id · audit log append-only (trigger) · export เขียน string เป็น text
- pg_trgm index, server paging, sort whitelist, LRU cache + single-flight, SWR invalidation
- dates ใน Bangkok + ESLint rule ห้าม `toISOString().slice`
- migrations idempotent, dependency pin exact, lint/tsc สะอาด

---

## ลำดับที่แนะนำ

1. P0-1 → P0-3 → P0-4 → P0-6 → P0-8 → P0-7 → P0-5 → P0-2
2. P1-OPS-1 + OPS-2 (log + instrumentation ครอบหลายข้อ) → AUTH-2/3/4/5 → SEC-1/4/5 → OPS-3/4/5/6
3. CI-1 → CI-2 → CI-4 (CI ก่อนงานใหญ่) → DATA-1/3/4 → SEC-2/3 → AUTH-1 → AUTH-8
4. ops runbook, P2
