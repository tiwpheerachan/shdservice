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

## สิทธิ์ / role (2026-10-15 — เจ้าของ: ให้ผู้ใช้จัดการเองในหน้าสิทธิ์ เราทำให้หน้ารองรับระบบ)

ปัญหาที่เจอ (สำเนาข้อมูลจริง): System Admin ใช้งานอยู่ 18 จาก 46 คน · สต๊อกแก้งาน/หน้าซ่อมได้ · ช่างตัดจ่ายอะไหล่เองได้ (Product Pick Stock) · ทุกตำแหน่งลบได้ · ผู้จัดการ/บัญชีไม่มีรายงาน · Call Center มีแค่ Booking ที่ไม่มีหน้า · กฎที่ผูกชื่อตำแหน่งในโค้ด (อนุมัติใบสั่งขาย = `SO_APPROVER_ROLES`, รับงาน = `ENGINEER_ROLES`, เปิดงานปิด/แก้เงินหลังปิด = System Admin, รายงาน = System Admin) ผู้ดูแลมองไม่เห็นและพังเงียบเมื่อเปลี่ยนชื่อตำแหน่ง

- [ ] **ค. ลด System Admin เหลือ 2–3 คน** (เจ้าของทำเองในหน้าผู้ใช้)
- [x] **ก. สิทธิ์พิเศษเป็นแถวใน `app_config`** (2026-10-16, `drizzle/0030`, `RIGHTS` ใน `src/lib/modules.ts` — เพิ่ม Overdue All ให้หัวหน้าช่างเห็นงานค้างทุกคน; Job Take ไม่ติดตัว System Admin อัตโนมัติ) (อนุมัติใบสั่งขาย, รับงานซ่อม, เปิดงานที่ปิด, แก้เงินหลังปิด, ดูราคาทุน, ดูรายงาน, ส่งออก Excel) แทนการเช็กชื่อตำแหน่ง — migration ตั้งค่าเริ่มต้น = กฎปัจจุบัน
- [x] **ง. ซ่อนโมดูลที่ไม่มีหน้า** (+ Job PickStock / Job ReturnStock ที่ใช้แค่เป็นป้ายในประวัติ) (Booking, Sale In, Sale Out, Warranty Extension) จากหน้าตั้งสิทธิ์
- [ ] **ข. ปรับสิทธิ์รายตำแหน่ง** (ร่างอยู่ในแชท 2026-10-15: ตัดช่างจ่ายอะไหล่เอง, ตัดสต๊อกแก้งานซ่อม, ลบได้เฉพาะผู้ดูแล, เพิ่มรายงานให้ผู้จัดการ/บัญชี, Call Center ดูงาน+ลูกค้า+บันทึกการโทร) — รอเจ้าของยืนยัน
- [ ] **จ. กติกา** — ทบทวนสิทธิ์ทุก 3 เดือน, คนลาออกถอนสิทธิ์วันนั้น

## โครงสร้าง DB (2026-10-16 — ตรวจ dev + prod แบบ `BEGIN READ ONLY`, ดึงแค่ catalog/จำนวนแถว ไม่ดึงข้อมูลลูกค้า)

ผ่าน: โครงสร้าง dev = prod ทุกคอลัมน์/index/constraint/trigger · migration 31/31 ทั้งสองที่ · schema drizzle ตรง DB ทุกคอลัมน์ (ชนิด + NOT NULL; `idempotency_key` ใช้ raw SQL) · RLS เปิดทุกตาราง, `anon`/`authenticated` ไม่มีสิทธิ์ตารางเลย, `view_customer` เป็น `security_invoker` · sequence ไม่ตามหลัง max · ไม่มี index เสีย/bloat · FK ที่มี validate ครบ · join หลัก (job→customer/job_type/status/model, job_log/spare-part log/attach→job, dt→hd ทุกเอกสาร) ไม่มีแถวกำพร้า
บริบท: prod ยังเป็นสำเนาข้อมูลระบบเก่า (งานล่าสุด 2026-09-27, ไม่มีงานใหม่ 7 วัน, `status_changed_at`/`row_version` ยังว่างทั้งตาราง) → แก้ข้อมูลบน prod ตอนนี้จะหายถ้า dump ใหม่ตอนเปิดใช้ — ทำเป็น migration/สคริปต์ที่รันซ้ำได้

- [x] **DB-1 (High) `statement_timeout` + `TimeZone` จาก `options` ไม่ถึง DB** — ✅ 2026-10-16 ทำแบบ OneLink: `drizzle/0032_database_timezone` (`ALTER DATABASE … SET timezone 'Asia/Bangkok'`, มีผลกับ session ที่เปิดหลัง deploy) · `withStatementTimeout()` (`src/db/client.ts`, `SET LOCAL` 15 วิ) ครอบรายงาน 3 ตัว + test ว่าตัดจริง/ไม่รั่ว · export ยังใช้เพดาน 2 นาทีของ server + MAX_ROWS + rate limit (ponytail note ในโค้ด) · ไม่ตั้ง statement_timeout ระดับ DB (จะตัด migration/SQL editor) · ตรวจหลัง deploy: admin เปิด `/api/health` เห็น TZ ของ DB = Asia/Bangkok
  รายละเอียดเดิม: — Supabase pooler ทิ้ง startup options ทั้ง port 6543 และ 5432 (วัดจริง: ได้ `UTC` / `2min` แทน `Asia/Bangkok` / `30000`) → ตัวกัน query ค้างของ P0-6 ใช้ไม่ได้บน prod · เวลาที่แอปเขียนยังถูกเพราะคิดใน JS, `now()` ใน SQL ใช้กับคอลัมน์ `timestamptz` (track/idempotency) — แต่ default `now()` ของ `document_profile`/`shipping_profile.created_at/updated_at` (`timestamp`) ได้เวลา UTC · แก้: `ALTER ROLE <app role> SET statement_timeout='30s'` + `SET TimeZone='Asia/Bangkok'` (มีผลทุก connection ไม่ว่า pooler แบบไหน) หรือ `SET LOCAL` ในทุก tx · `.env` ในเครื่องใช้ 6543 (transaction pooler) ขัดกับ `.env.example` — 👤 เช็ก port ใน Render dashboard
- [-] **DB-2 (Med) แอปต่อ DB ด้วย `postgres`** — 2026-10-16 เจ้าของเลือกทำแบบ OneLink (ใช้ `postgres` เหมือนกัน) · role `oneservice_app` ที่สร้างบน prod ไว้แล้วไม่ใช้ → 👤 ลบใน SQL editor: `DROP OWNED BY oneservice_app; DROP ROLE oneservice_app;` (`rolbypassrls`, เจ้าของทุกตาราง, ทำ DDL ได้) → role แยกสำหรับ runtime (DML เท่านั้น), `postgres` ใช้แค่ migrate ตอน deploy
  ~~ยกเลิก — เปลี่ยนเป็นแบบ OneLink (ดูหัวข้อ)~~ 2026-10-16 (เจ้าของรันใน SQL editor): prod มี `oneservice_app` แล้ว — LOGIN, BYPASSRLS, `TimeZone=Asia/Bangkok`, `statement_timeout=30s`, `idle_in_transaction_session_timeout=60s`, สิทธิ์ 262 แถว (66 ตาราง × 4 − audit_log UPDATE/DELETE) · เช็กแล้วสลับได้: pg_trgm อยู่ `public`, pgcrypto (`extensions`, role ไม่มี USAGE) ไม่มี trigger / default / SQL ไหนเรียก · 👤 เหลือ: (1) ตั้งรหัส `ALTER ROLE oneservice_app PASSWORD …` (2) Render `DATABASE_URL` user → `oneservice_app.<ref>` port 5432 (3) admin เปิด `/api/health` ต้องเห็น TZ `Asia/Bangkok` (4) ใส่ SQL เดียวกันเป็น `drizzle/0032_app_role.sql` ใน repo ให้ dev/test/CI ตรงกับ prod
  เดิม: ร่าง `drizzle/0032_app_role.sql` (role `oneservice_app` LOGIN ไม่มีรหัส, BYPASSRLS, DML เท่านั้น, audit_log insert/select, `ALTER ROLE … SET TimeZone/statement_timeout 30s/idle_in_transaction 60s`, default privileges) — เครื่องมือไม่อนุญาตให้ agent เขียนไฟล์ที่ GRANT สิทธิ์ → เจ้าของสร้างเอง · หลัง deploy: ตั้งรหัสใน SQL editor + เปลี่ยน user ใน Render `DATABASE_URL` · ⚠️ ทดสอบพบว่า `SET` ผ่าน 6543 รั่วไป client อื่นที่ใช้ backend เดียวกัน → ต้องใช้ 5432 หรือค่าบน role เท่านั้น ห้าม `SET` ระดับ session
- [x] **DB-3 (Med) FK มีแค่ 17 ตัว** (`record_status` + จังหวัด/อำเภอ) — ความสัมพันธ์หลักคุมด้วยโค้ดอย่างเดียว · ตอนนี้ข้อมูลสะอาด → เพิ่ม FK แบบ `NOT VALID` แล้ว `VALIDATE` ได้ถูก (job→customer/job_type/job_status/model, job_log/job_order_spare_part_log/document_attach→job, quotation_dt/sale_out_dt/inventory_dt→hd, customer→ตำบล/อำเภอ/จังหวัด, inventory→store_location/type) · ข้ามถ้าเจอแถวกำพร้า (migration ต้องรันซ้ำหลัง re-dump ได้) · กำพร้าที่เจอ: `sale_out_dt.product_id` 41 แถว, `product.manufacturer_id` 3 แถว · `mt_sub_district.city_id` FK ไม่มี index
  ✅ 2026-10-16: `drizzle/0031` 13 FK — VALIDATE 11 ตัว, `fk_sale_out_dt_product` (41) / `fk_product_manufacturer` (3) = NOT VALID (เช็กแค่ข้อมูลใหม่) · unique เลขเอกสาร 3 ตัวเปลี่ยนจาก partial เป็นธรรมดา (FK อ้างได้) · `ix_mt_sub_district_city` · ไม่ใส่ FK ที่โค้ดเขียนค่าแทน "ไม่มี" (ที่อยู่ลูกค้า -1, `job.product_model_id` 0, `engineer_id` -1, `audit_log.user_id` 0) · `handle()` 23503/23514 → 409 ข้อความไทย + log · test seed: TRUNCATE CASCADE, ลบลูกก่อนแม่, seed สถานะงานครบ 25 + `inventory_type`/`store_location` · แก้ test เดิมที่พังบน test DB ใหม่ (ไม่มี model, sequence symptom ตามหลัง) · test DB ใหม่ 3 รอบติด: test:db ผ่านหมด, migrate `--reset` ซ้ำได้
- [x] **DB-4 (Med) CHECK มีตัวเดียว** (`job_type.default_due_days`) — กฎสต๊อก/เงินอยู่ในโค้ดอย่างเดียว · `product_none_serial.quantity_remain` ติดลบ 5 แถว (ข้อมูลเก่า; `quantity_available`/`booking`/ราคา ไม่มีติดลบ) → `CHECK (quantity_available >= 0 AND quantity_booking >= 0)` + ราคา ≥ 0 แบบ `NOT VALID`
  ✅ 2026-10-16: `drizzle/0031` ใส่เฉพาะที่ข้อมูลเดิมผ่าน (NOT VALID ก็ยังบล็อก UPDATE แถวที่ผิดอยู่ เช่นแก้ราคาสินค้าที่สต๊อกติดลบ): `ck_stock_available`, `ck_stock_booking`, `ck_stock_prices` · `ck_inventory_dt_qty` = NOT VALID (แอปไม่เคย UPDATE `inventory_dt` จึงปลอดภัย; แถวเก่า `WHI2300001` P00201 −4 คงไว้) · ไม่ใส่ `ck_stock_remain`: `adjustQty(allowNegative)` ตั้งใจให้เปลี่ยนยอดจองของแถวที่ติดลบอยู่ได้ — CHECK แม้ NOT VALID จะทำให้จอง/แก้ราคา 5 สินค้านี้พัง → 👤 นับสต๊อกจริง P00036 / P00229 (จอง 550 > รับ 221) / P00330 / P00469 / P00572 แล้วแก้ยอด จากนั้นค่อยเพิ่ม CHECK
- [x] **DB-5 (Low) เงินใน `quotation_dt` เก็บเป็น varchar** — `quantity`, `unit_price`, `unit_price_discount(_percent)`, `total_price` · `total_price` 2,186/3,989 แถวมี comma (`9,999.99`) · แอปอ่านผ่าน `num()` ตัด comma แล้ว — พังเฉพาะถ้าจะ sum/sort ใน SQL → แปลงเป็น `numeric(18,2)` เมื่อไม่ต้องเขียนกลับระบบเก่าแล้ว · `quotation_hd.vat_rate` เป็น `double precision` → `numeric(5,2)`
  ✅ 2026-10-16: `drizzle/0031` แปลง 5 คอลัมน์เป็น numeric (ตัด comma, แปลงเฉพาะเมื่อทุกค่าเป็นตัวเลข ไม่งั้น NOTICE) + schema drizzle · `vat_rate` ไม่แก้: ค่ามีแค่ 0/7 ซึ่ง double เก็บได้ตรง
- [ ] **DB-6 (Low) ตาราง/คอลัมน์ไม่ใช้** — ว่างบน prod: `job_close_temp`, `job_create_temp`, `quotation_temp`, `sale_in_hd/dt`, `product_serial`, `model_color/part/tier`, `job_return_hd/dt`, `job_service_code` (`service_cost.service_code` 7 แถวชี้หาตารางนี้) · `temp_model`/`temp_spare_part` ไม่มี PK · คอลัมน์ว่าง 100%: `app_user.asc_code/asc_name`, `inventory_hd.company_id/branch_id` → ลบหลังยืนยันว่าระบบเก่าไม่เขียนแล้ว
  ⏸ 2026-10-16: ยืนยันแล้วว่าลบได้ 12 ตาราง (ว่างตั้งแต่ระบบเก่า `setupdata/out/rowcounts.txt` + ว่างบน prod + ไม่มีโค้ดอ้าง): `job_close_temp`, `job_create_temp`, `job_return_dt/hd`, `job_service_code`, `model_color/part/tier`, `quotation_temp`, `sale_in_dt/hd`, `temp_model` + `app_user.asc_code/asc_name` · ไม่ลบ `temp_spare_part` (235 แถว), `product_serial`/`service_cost` (ใช้อยู่), `inventory_hd.company_id/branch_id` (โค้ด insert) · เครื่องมือไม่อนุญาตให้ agent เขียนไฟล์ DROP → เจ้าของสร้าง `drizzle/0033_drop_unused.sql` (`DROP TABLE IF EXISTS …` ไม่ใช้ CASCADE) + ลบ 12 `pgTable` + 2 คอลัมน์ใน `src/db/schema/legacy.ts` + entry ใน `_journal.json`
- [x] **0007 รันซ้ำไม่ได้หลัง 0010** (เจอระหว่างทำ DB-4) — 0007 สร้าง unique index prefix แต่ 0010 ตั้งทุกโปรไฟล์เป็น J/Q/SO → re-dump แล้ว migrate ซ้ำ (แผนเปิดใช้) จะล้มที่ 0007 บน prod (มี 3 โปรไฟล์) · ✅ 2026-10-16: สร้าง index เฉพาะเมื่อ prefix ไม่ซ้ำ · พิสูจน์: migrate ซ้ำทั้ง 32 ไฟล์บนข้อมูล dev ผ่าน
- [ ] **DB-7 (Low) index ไม่เคยถูกใช้บน prod** (stats ตั้งแต่ 2026-08-25): `ix_job_model_name` (btree; ค้นใช้ gin), `gin_job_customer_detail_digits` 10 MB + `gin_customer_phone_digits` (prod ยังไม่มีคนค้น) → ดู `pg_stat_user_indexes` อีกครั้ง 1 เดือนหลังเปิดใช้ แล้วค่อยลบ · ทำไม่ได้จนกว่าจะเปิดใช้จริงครบ 1 เดือน
- [-] ไม่ต้องแก้ (จดไว้กันงง): `job.product_model_id` เก็บ `model.model_id` (โค้ด join `model` ถูกแล้ว แต่ชื่อคอลัมน์ชวนเข้าใจผิด และช่วง id ซ้อนกับ `product_model`) · "ไม่มีช่าง" มี 3 แบบ `NULL`/`0`/`-1` (32,145 งานเป็น -1) — โค้ดใช้ `coalesce(engineer_id,0) <= 0` ครอบแล้ว · `timestamp` (เวลาไทย) ปน `timestamptz` (track) ตาม ADR-0001

## ความครอบคลุม 7 เมนูเทียบข้อมูลจริง (2026-10-19 — ตรวจกับสำเนาข้อมูล prod ใน dev DB, อ่านอย่างเดียว)

วิธี: ต่อเมนู — ทุกตาราง/คอลัมน์ที่มีข้อมูลมีหน้าแสดง/แก้ไหม · ทุกค่าสถานะ/ประเภทที่มีจริงโค้ดรองรับไหม · รายการนับครบเท่า DB ไหม · เปิดแล้วบันทึกของเก่า (ไม่แก้) ผ่านและไม่เปลี่ยนข้อมูลไหม (รัน zod schema จริงกับทุกแถว)

| เมนู | ผล | สรุป |
|---|---|---|
| 1 ข้อมูลระบบ | ครอบคลุม มีช่องโหว่ | ทุก master รายการครบ, ทุกแถวผ่าน validation · ผู้ใช้เดิม 40 คนไม่มีอีเมล (SSO จับคู่ด้วยอีเมล) |
| 2 ข้อมูลอะไหล่ | ครอบคลุม มีช่องโหว่ | รายการครบ, ของเก่าบันทึกได้ · ยอดคงเหลือกับ Stock Card ต่างกัน 15 สินค้า, คำขอเบิกค้างของงานที่ปิดแล้ว 246 บรรทัด |
| 3 ข้อมูลลูกค้า | ครอบคลุม มีช่องโหว่ | ทุกคอลัมน์ที่มีข้อมูลแสดงครบ, รายการครบ 43k · ค้นชื่อไม่เจอ ~1,050 ราย (ช่องว่างซ้อน/อักขระล่องหน) |
| 4 ข้อมูลงานบริการ | ครอบคลุม มีช่องโหว่ | สถานะ/ประเภททุกค่ารองรับ, รายการครบ · ประวัติสถานะ 224k แถวไม่แสดงให้พนักงาน, หน้า Swap ไม่รับงาน swap เก่า |
| 5 ข้อมูลเสนอราคา | ครอบคลุม มีช่องโหว่ | โหลด+บันทึกครบ 3,048 ใบ ยอดไม่เปลี่ยนสักใบ · งานยังชี้ใบที่ลูกค้าปฏิเสธ 48 งาน |
| 6 ข้อมูลใบสั่งขาย | ครอบคลุม มีช่องโหว่ | ยอด/สถานะ/ตัดสต๊อกตรงทุกใบ · ช่องโหว่เป็นการแสดงผล (สลิปเก่า, วันจัดส่ง, รายการค่าบริการ) |
| 7 รายงาน | ครอบคลุม มีช่องโหว่ | ตัวเลขทุกรายงาน = SQL จากตารางดิบ (2024, 2025, 2025-06), query < 0.5 วิ · รายงานการซ่อมรวมงานเปลี่ยนเครื่องครึ่งหนึ่ง, มูลค่าสต๊อกไม่รวม 241 สินค้าที่ไม่มีราคา |

- [x] **แก้แล้วรอบนี้** (2026-10-19, ข้อที่ไม่ต้องตัดสินใจ) — test DB ใหม่ test:db ผ่าน 2 รอบ, migrate `--reset` ซ้ำได้
  - งาน: ประวัติสถานะ (job_log) แสดงในหน้างาน · แสดงอะไหล่ที่เปลี่ยน/New S/N, ผู้ซ่อม/ผู้ปิดงาน/วันปิด · สลิปเก่าเปิดได้ (ชี้ path ในที่เก็บไฟล์) · อาการเสียชื่อซ้ำไม่สลับ id ตอนบันทึก · อาการช่างที่มีช่องว่างท้ายชื่อบันทึกได้ · ตัวกรอง "ยกเลิกข้อมูล" เจองานที่ถูกยกเลิก · ปุ่มสร้างใบเสนอราคาจากหน้างาน · ฟิลด์ใหม่ปิดในเอกสารลูกค้า
  - ใบเสนอราคา: เปลี่ยนจากตกลงเป็นปฏิเสธ/ยกเลิกแล้วล้าง `job.quotation_no_approved` · ป้าย "หมดอายุ" ในรายการ (`src/lib/quote-expiry.ts` ใช้กติกาเดียวกับ /track) · ช่องเลขงานกรองร่วมกับช่องอื่นได้ · บันทึกไม่ประทับสถานะระเบียนถ้าสถานะไม่เปลี่ยน
  - ใบสั่งขาย: สลิประบบเก่าบอกว่าอยู่ระบบเก่า (ไม่ใช่ "จะอัปโหลด") · ตัวกรองพนักงานขายรวมคนที่ออกแล้ว · รายการ SV0001 มีชื่อ · แสดงวันจัดส่ง + Excel · แสดงหมายเหตุอนุมัติ
  - อะไหล่: Excel ประวัติเคลื่อนไหว = หน้าจอ · ลบตัวกรองคลังที่ไม่ทำงาน · สร้างแถวสต๊อกเมื่อไม่มี (P02357) · ตัวกรองยี่ห้อรวมยี่ห้อที่ไม่ใช้งาน · ป้าย "จอง (งานซ่อม)"
  - รายงาน: รายงานการซ่อมกรองประเภทงานได้ · คอลัมน์วันปิดงาน/วันซ่อม · อะไหล่คงเหลือบอกจำนวนที่มีสต๊อกแต่ไม่มีราคา + Excel มีมูลค่า + ป้าย KPI ไม่นับติดลบ · คำอธิบายรายงานเบิกจ่ายรวมจ่ายออกอื่นๆ
  - ลูกค้า: ค้นชื่อไม่สนช่องว่างซ้อน/อักขระล่องหน + `drizzle/0034` index (90 → 4 ms) · ค้นเลขภาษีแบบตัวเลขล้วน · ที่อยู่เก่ายาวเกิน 100 บันทึกได้ถ้าไม่แก้ · `docs/data-cleanup.sql` ครอบชื่อช่องว่างซ้อน
  - ข้อมูลระบบ: บันทึกผู้ใช้ไม่ย้ายคำจากชื่อไปนามสกุล · ตัวกรองยี่ห้อในหน้ารุ่นรวมยี่ห้อที่ไม่ใช้งาน
  - ความปลอดภัย: `drizzle/0033` ล้าง `track_token` ดิบทุกงาน (ลิงก์ยังใช้ได้ผ่าน hash) — คอลัมน์ยังอยู่ (ลบ schema line ไม่ได้รอบนี้) ลบทีหลังพร้อมบรรทัดใน `legacy.ts`

ข้อที่ต้องให้เจ้าของตัดสินใจ:
- [ ] **ผู้ใช้เดิม 40 คนไม่มีอีเมล** (24 คนเปิดงานตั้งแต่ ส.ค.) — ถ้าล็อกอิน SSO ก่อนผูกอีเมล จะได้บัญชีใหม่ไม่มีสิทธิ์ และย้ายอีเมลกลับบัญชีเดิมไม่ได้ (unique index) → 👤 ผูกอีเมลให้ทั้ง 40 คนด้วยปุ่มค้นรายชื่อ Lark ในหน้าผู้ใช้ **ก่อนเปิดใช้**
- [ ] **ประเภทเครื่องซ่อม** id 3–11 เป็นชื่อคน (ใช้กับ 7,237 งานตั้งแต่ เม.ย.) — ช่องนี้หมายถึงอะไร เปลี่ยนชื่อหรือแยกช่อง
- [ ] **สต๊อก**: ยอดคงเหลือ ≠ Stock Card 15 สินค้า (ลงเอกสารปรับยอดครั้งเดียว) · รับคืนจากงานเก่าเพิ่มยอดรับเข้า แต่โค้ดใหม่ลดยอดจ่ายออก (เลือกกติกาเดียว) · คำขอเบิกค้างของงานปิด/ยกเลิก 246 บรรทัด (ยกเลิกทิ้ง + คำนวณยอดจองใหม่) · หน้ารายการอะไหล่ซ่อนตัวที่ไม่ใช้งาน 71 รายการแต่ป้ายเขียน "ทั้งหมด"
- [ ] **งาน**: คิว "รับมอบหมายงาน" มี 1,703 งาน ส่วนใหญ่เลยขั้นมอบหมายแล้ว (สถานะ 18/14/17/5) — สถานะไหนนับว่า "รอมอบหมาย" · หน้า Swap ต้องกรอก Serial ใหม่ทุกครั้ง งาน swap เก่า 1,080 งานบันทึกไม่ได้ — ยืนยันกติกา · งานปิดแล้ว 1,630 งานยังมีส่งซ่อมนอกที่ไม่ได้บันทึกรับคืน (เติมวันรับคืน = วันปิดงานไหม) · ไฟล์แนบเก่า ~1,478 ไฟล์ไม่มีไฟล์จริง (กู้จากระบบเก่าได้ไหม)
- [ ] **ใบเสนอราคา**: ให้เปลี่ยนเป็น "หมดอายุ" อัตโนมัติไหม และนับ 7 วันจากวันส่งหรือวันสร้าง · 48 งานที่ชี้ใบที่ปฏิเสธ/ยกเลิก ล้างไหม · ต้องการส่วนลดเฉพาะอะไหล่/ค่าบริการในใบใหม่ไหม
- [ ] **ใบสั่งขาย**: ต้องเพิ่มรายการค่าบริการ/ค่าส่ง (SV0001) ในใบใหม่ได้ไหม · ย้ายไฟล์สลิปเก่า 3,808 ไฟล์ไหม
- [ ] **รายงาน**: รายงานการซ่อมควรรวมงานเปลี่ยนเครื่องไหม, "อัตราซ่อมสำเร็จ" หมายถึงอะไร · มูลค่าสต๊อกใช้ราคาขายหรือราคาทุน · รายงานเบิกจ่ายควรรวมจ่ายออกอื่นๆ ไหม · ผู้มีสิทธิ์ "ดูรายงาน" แต่ไม่มีสิทธิ์ดูงาน/ใบเสนอราคา/ใบสั่งขาย จะเห็นตัวเลขแต่ตาราง/Excel ถูกปฏิเสธ — ให้สิทธิ์คู่กันหรือให้ Report อ่านตารางได้
- [ ] **ลูกค้า**: Excel ส่งออกได้สูงสุด 20,000 จาก 43,540 ราย (เพิ่มเพดานหรือ CSV) · ประวัติลูกค้ามีแค่งาน ไม่มีใบเสนอราคา/ใบสั่งขาย
- [x] ⚠️ ความปลอดภัย: ทุกงานยังเก็บ `track_token` ดิบ → ล้างแล้วด้วย `drizzle/0033` (ดูด้านบน)

## คุณภาพโค้ด: hard code / ไม่มีประสิทธิภาพ (2026-10-19 — ตรวจทั้งโปรเจกต์ 3 ส่วน แล้วแก้ หนัก → กลาง → เล็ก)

ตรวจแล้ว: tsc · eslint · npm test · test:db บน test DB ใหม่ 3 รอบติด (166/205/84) · migrate `--reset` · e2e 5/5 (build ใหม่, `/login` `/track` เป็น dynamic) · prod `jit=off` อยู่แล้ว (ข้อ JIT ช้าเฉพาะ dev ไม่ต้องแก้)

- [x] **หนัก** — Excel export เป็น stream (20k แถวเดิม OOM ใต้ heap 400 MB → ~88 MB) + ส่งออกได้ทีละไฟล์ต่อ server (429) · ป้ายสถานะงานสีตามกลุ่ม (เดิมเทา 20/23 สถานะ) · หน้า master ไม่กลืน error เป็นตารางว่าง · Dashboard มีโหลด/error · มอบหมายงานเป็นชุด (เดิม ~2,000 query ต่อ 500 งาน)
- [x] **กลาง** — รหัสสถานะรวมที่ `src/lib/status-ids.ts` (แทนเลขเปล่าใน reports/stock/sale-orders/quote-expiry/quote-job/tracking) · หน้าติดตามงาน/login ใช้โปรไฟล์ผู้ออกเอกสาร (company.ts เหลือแค่ค่าสำรอง) · ตัวกรองต่อหมวดสร้างที่เดียว (แก้ KPI ใบเสนอราคา error 500 เมื่อกรองยี่ห้อ, list/summary ที่ทิ้งตัวกรอง) · บันทึก+audit ใน transaction เดียว (master, ผู้ใช้, กู้คืนข้อมูล) + อัปโหลดสลิป/รูปมี audit · กู้คืนงานล็อกแถว · ตัวกรองกลุ่มสถานะใช้ index (17 → 0.65 ms) · สต๊อกล็อก+อัปเดตทุกบรรทัดในคำสั่งเดียว · หน้ารายละเอียดใบสั่งขาย/ใบเสนอราคา/อะไหล่ query ขนาน · OTP เวลาตอบเท่ากันทั้งเบอร์ลูกค้า/ไม่ใช่ · GET ลิงก์ติดตามออกลิงก์ใหม่เฉพาะผู้มีสิทธิ์แก้ไข + audit · ตัวเลือกสถานะมาจาก DB
- [x] **เล็ก** — ลบโค้ด/ไฟล์ที่ไม่ใช้ (shadcn ชุดซ้ำ, export ใน mock.ts 11 ตัว, hook 6 ตัว, approveUser, logo-source.png ฯลฯ) · ค่าคงที่ที่ซ้ำ (เพดาน export `src/lib/export-limit.ts`, ชื่อคลัง, สถานะส่งซ่อมนอก `src/lib/outsource-status.ts`, ข้อความ "ไม่พบหมายเลขงาน", ขนาดหน้า, ป้าย TAT) · log แทน console/catch เงียบ · cache ล้างหลัง commit · ตัวจับเวลา session หน้าลูกค้าใช้ hook เดียว + ไม่ re-render ทุกวินาที · poll หยุดเมื่อซ่อนแท็บ · ปีใน footer · a11y ปุ่มย่อเมนู · owner อ่านจาก `OWNER_EMAILS` อย่างเดียว (dev ตั้งใน `.env.development.local`)
- [x] **รื้อโครงสร้าง (2026-10-19, ทำตามลำดับไม่ให้แก้ซ้ำ)**
  1. `src/data/mock.ts` → `src/data/types.ts` (type) + `src/data/options.ts` (รายการตัวเลือก) — codemod import 46 ไฟล์
  2. ชนิด input ของ service = `z.output<typeof op.body>` ทุก route (ไม่มี cast เหลือ) · contract แม่นขึ้น (`version` เป็นตัวเลข, ช่องที่ UI ไม่เคยส่ง null เป็น optional, repair parts ต้องมี a/b → 400 แทน 500) · แยก `saveRepair` (190 → 59 บรรทัด: `syncPartLines`, `repairValues`, `repairStatus`), `saveOutsource` (170 → 81: `outsourceChanges`, `writeSendRow`), `getJob` (`toJobDetail`)
  3. `useServerTable` (16 หน้า) + `useFilterDraft` (หน้าที่กรองในเบราว์เซอร์) · dropdown ที่โหลดรายการไม่สำเร็จแสดง error+ลองใหม่ที่ `<Field lookup>` ทุกตัว · ProductPicker ค้นฝั่ง server (ไม่โหลดอะไหล่ทั้งหมดเข้าเบราว์เซอร์) + server ค้นยี่ห้อ/หมวดได้
  4. แยก component (บรรทัดของฟังก์ชันหลัก): RepairForm 605→181 · CloseForm 596→204 · ProductSection 395→126 · QuotationForm 572→274 · SaleOrderForm 438→320 (แยกตารางรายการ) · ProductDetailModal 615→204 · JobListPage 476→95 · UsersPage 617→144 · TrackOtp 503→102
  - ไม่ทำ: แคบ cache อาการเสีย (ของเดิมถูก) · หน้ารับเข้า/ตัดจ่ายอะไหล่ยังโหลดแคตตาล็อก (หน้าจอเป็นตารางของแคตตาล็อกเอง)

## QA หลังรื้อโครงสร้าง + ความปลอดภัยรอบใหม่ (2026-10-19 — OWASP ASVS L2, agent-browser บน dev + SSO ปลอม)

ผล: ไม่มี Critical/High ทั้งสองฝั่ง · ทุก flow หลักทำงานบนข้อมูลจริง (รายการ flow ที่ผ่านอยู่ในรายงาน QA) · ตรวจแล้ว: tsc · eslint · npm test · test:db test DB ใหม่ 2 รอบ (166/214/87) · migrate `--reset` (36) · e2e

- [x] **ความปลอดภัย กลาง** — เปลี่ยนสลิปงานที่ปิดแล้วต้องมีสิทธิ์แก้เงินหลังปิดงาน + ไม่ลบสลิปเดิมของงานที่ปิด · `/api/data` แบบไม่แบ่งหน้าจำกัด 200 (สูงสุด 1000; Excel ยัง 20k ผ่านสิทธิ์ Export)
- [x] **ความปลอดภัย เล็ก** — OTP: เบอร์ที่ไม่ใช่ลูกค้าได้แถว decoy + verify ใช้เวลาอย่างน้อย 800 ms (บอกไม่ได้ว่าเบอร์ไหนเป็นลูกค้า) · กู้คืนข้อมูลที่ถูกลบต้องมีสิทธิ์ลบ · ลบไฟล์แนบต้องมีสิทธิ์ลบ + ไม่ลบไฟล์จริง (ปุ่มลบซ่อนจากคนไม่มีสิทธิ์) · `/api/files` เช็กสิทธิ์ตามโมดูลของไฟล์ + ชื่อไฟล์สุ่มด้วย UUID · cookie `__Host-` ใน production (**ทุกคนต้อง login ใหม่ 1 ครั้งหลัง deploy**) · `/api/track/*` ปฏิเสธ body เกิน 8 KB ก่อนอ่าน · audit สิทธิ์แยกรายตำแหน่ง · `drizzle/0035` กัน TRUNCATE audit_log
- [x] **บั๊กที่เจอระหว่างแก้** — งานลบข้อมูลเก่าลบตัวนับ OTP รายวันทุก 2 ชม. (เพดาน/ล็อก OTP รีเซ็ตหลายรอบต่อวันบน prod) → เก็บ 25 ชม. · seed e2e ไม่เลื่อน sequence (test "ชื่อรุ่นซ้ำ" พังเป็นครั้งคราว)
- [x] **QA** — ติ๊กเบิก/เสนอแผน A/B แล้วจำนวนว่าง: หน้าจอตั้งเป็น 1 + server ปฏิเสธ 400 ใต้ช่อง (เดิมทิ้งเงียบ) · ตารางที่จอ 1280px ไม่ซ่อนคอลัมน์สถานะ/จัดการ (คอลัมน์ `xl` อิงความกว้างตาราง) · Dashboard: จุดสียกเลิก, เลข TAT ชนป้าย · "Failed to fetch" → ข้อความไทย (toast + หน้าโหลด) · ช่องเลือกไฟล์ภาษาไทย · "View" → "ดู", radio ที่ disabled เห็นค่าที่เลือก · ปุ่มโทร (link ซ้อน button) · ใบส่งคืนพิมพ์ New S/N · dialog โฟกัสช่องแรก
- [-] **OTP 6 หลัก (ASVS 2.7.6)** — เจ้าของตัดสินใจคง 4 หลัก (2026-10-19) · ชดเชยด้วยเพดานกรอกผิด: 5 ครั้ง/เบอร์+IP (IP นั้นถูกล็อกออกจากเบอร์) และ 10 ครั้ง/เบอร์/วันทุก IP แล้วล็อกเบอร์ 24 ชม. (~0.1%/วัน จากเดิม 30 = 0.3%) · ทุกรอบที่เดาส่ง SMS ถึงเจ้าของเบอร์ · ตัวนับรายวันไม่ถูกล้างระหว่างวันแล้ว · test ครอบทั้งสองเพดาน
- [ ] 👤 **ต้องตั้งค่าเอง** — `SSO_SESSION_CHECK=enforce` หลังดู log ว่า session กลางตรวจได้ · เช็ก Render ว่ามี `TRACK_LOG_SECRET` และ `DB_SSL_CA` (ไม่มีแค่เตือน ไม่ล่ม) · ย้าย `@hrefcl/apidoc` ออกจาก build ของ production (dependency ของ dev มีช่องโหว่ระดับ high ที่ build ใช้)

## e2e flow เงิน + ความเร็วหน้าเว็บ + WCAG 2.1 AA (2026-10-19)

- [x] **e2e flow เงิน** — 10 test ใหม่ (รวม 15): ปิดงานรับเงิน (ยอดที่ต้องชำระ, บันทึกเงิน, job_log, ใบส่งคืน, อะไหล่ยังไม่จ่ายปิดไม่ได้, งานปิดแล้วแก้เงินไม่ได้) · อนุมัติใบสั่งขายตัดสต๊อกครั้งเดียว (กดซ้อน, อนุมัติของตัวเองไม่ได้, ปฏิเสธ/ส่งกลับต้องมีเหตุผล) · เบิก/คืน/เบิกเกินสต๊อก — ตรวจเงิน/สต๊อกใน DB ตรง ๆ · ไม่เจอบั๊ก
- [x] **ความเร็ว** (Lighthouse + Playwright, build production, ข้อมูลขนาดจริง) — ก่อน → หลัง: CLS หน้าติดตามงาน 0.380 → 0.000 (คะแนนมือถือ 81 → 95) · CLS หน้ารายการเดสก์ท็อป 0.15–0.17 → ~0.001 · JS หน้าฟอร์ม 344–358 → 288–306 KB gzip (zod 88.7 → 32.2 KB) · login มือถือวัด FCP ได้แล้ว · ตัด models 141 KB ออกจากหน้ารายการ, ดึงงานซ้ำ/`/me` ซ้ำเหลือครั้งเดียว · ข้อมูลขึ้นจอบน 4G: รายการงาน 6.7 → 5.8 วิ, หน้าซ่อม 7.5 → 7.2 วิ · Dashboard skeleton สูงคงที่ + การแจ้งเตือนรอ 3 วิหลังหน้าโหลดเสร็จ (แก้หลังวัดซ้ำ ยังไม่วัดอีกรอบ)
- [x] **WCAG** (axe 148 รอบ + keyboard/contrast เอง) — โฟกัสกลับที่เดิมหลังปิด dialog · dialog ดูอย่างเดียวรับโฟกัส · เมนูที่ซ่อนไม่อยู่ในลำดับ Tab · ลิงก์ข้ามไปเนื้อหาหลัก · สี contrast ทุกคู่ผ่าน + ขอบช่องกรอก ≥ 3:1 · เตือนก่อน session หมดทุกขนาดจอ (พนักงาน 5 นาที, ลูกค้า 2 นาที) · picker มีชื่อ/ปุ่มล้างกดด้วยคีย์บอร์ดได้ · tabs มี panel · ตารางเลื่อนแนวนอนโฟกัสได้ · title ทุกหน้า · กราฟมีตารางให้ screen reader · หน้าติดตามงาน: ข้อความผิดพลาดประกาศ, โฟกัสหัวข้อเมื่อเปลี่ยนหน้า, ปุ่ม ≥ 44 px
- [x] **ข้อมูลหน้าแรกมากับ HTML (2026-10-20)** — `src/server/prefetch.ts` เรียก route handler เดิม (สิทธิ์/ตัวกรอง/contract ชุดเดียวกับ API, ผู้ไม่มีสิทธิ์ไม่ได้ข้อมูล, เพดาน 1.5 วิ) → `<Prefetched>` ใส่ลง SWR cache · key จาก `src/data/keys.ts` ที่เดียวทั้ง server/client · 8 หน้า: หน้าซ่อม, รายการงาน, Dashboard, แก้ใบเสนอราคา, อะไหล่, ลูกค้า, ใบสั่งขาย, รายงานเปิดงาน · หน้าซ่อมสร้างค่าในฟอร์มจากข้อมูลตั้งแต่ render แรก · skeleton ระหว่างโหลดสูงเต็มจอ · ผลวัด (มือถือ 4G): ข้อมูลขึ้นจอ 5.6–7.2 → **1.62–1.65 วิ** ทั้ง 8 หน้า (= เวลาที่หน้าแรกปรากฏ), ไม่มี API ซ้ำหลังโหลด, CLS หน้าซ่อม 0.000 / เดสก์ท็อปทุกหน้า 0.001 · e2e พิสูจน์ด้วยการบล็อก API แล้วข้อมูลยังขึ้น + ผู้ไม่มีสิทธิ์ไม่ได้ข้อมูลใน HTML · แก้ระหว่างทาง: ฟอร์มใบเสนอราคากับหน้าซ่อมใช้ cache key เดียวกันแต่คนละรูปแบบ, เลขงานใน e2e ซ้ำกับเอกสารสต๊อกเก่า
- [x] **จุดเล็กที่เหลือ (2026-10-20)** — หน้าซ่อม: ตารางอะไหล่/ไฟล์แนบ/คำใบ้ผู้รับงานอยู่ใน HTML ตั้งแต่ render แรก (prefetch staff + ยี่ห้อด้วย) · รายการอาการเสีย 81 KB โหลดเมื่อเริ่มใช้ช่องอาการเสีย ไม่ใช่พร้อมหน้า · คูลดาวน์ขอ OTP เป็นแบบนับจากครั้งล่าสุด (`claimCooldown` upsert อะตอมมิก — ยิงพร้อมกัน 3 ครั้งผ่าน 1, ครั้งที่ถูกปฏิเสธไม่เริ่มนับใหม่) · ปุ่ม SSO หน้า login/รออนุมัติใช้สีแบรนด์เข้ม `bg-brand-ink` (contrast 5.5–5.7:1) · ตารางในคู่มือครอบ TableScroll · checkbox ของ Radix มี input ซ่อนตามดีไซน์ ไม่กระทบ layout/hydration → คงไว้ · e2e seed เพิ่ม `approve_status` (DB ใหม่เอี่ยมป้ายสถานะใบสั่งขายขึ้น "—") และไฟล์แนบใน e2e ใช้ id จาก sequence (เดิม max+1 ทำ test:db ชน)
- [x] **ลบ comment ที่ไม่มีประโยชน์ (2026-10-20)** — 81 ไฟล์ใน src/scripts/tests: ตัดประวัติการแก้ ("เดิม…/CLS เคยเป็น…"), คำอธิบายที่ซ้ำกับโค้ด, comment ที่ล้าสมัย · คงไว้เฉพาะเหตุผล/ข้อจำกัดที่อ่านจากโค้ดไม่ได้ · พิสูจน์ด้วยสคริปต์เทียบ token ของ TypeScript (ไม่นับ comment): โค้ดเปลี่ยน 0 จุด

## ความปลอดภัย: ช่องที่ยังไม่มี (2026-10-20 — เทียบ OWASP Top 10 / ASVS L2 / PDPA ม.37 กับโค้ดจริง)

- [x] **บันทึกการ export** — ทุกไฟล์ Excel ลง audit_log (`EXPORT`: ใคร, ข้อมูลอะไร, กี่แถว, ตัวกรอง, IP) ก่อนส่งไฟล์ — บันทึกไม่ได้ = ไม่ส่งไฟล์ · หน้าประวัติการใช้งานมีป้าย "ส่งออก Excel" · test: export สำเร็จมีบันทึก, ถูกปฏิเสธไม่มี
- [x] **คู่มือรับมือเหตุ** [ops/security-incident.md](../ops/security-incident.md) — เก็บหลักฐาน, ปิดทางตามประเภทเหตุ, หมุน secret 10 ตัว (ผลข้างเคียงตรวจกับโค้ด), ประเมินแจ้ง สคส. 72 ชม., แบบบันทึกเหตุ · 👤 เติมชื่อผู้รับผิดชอบ 3 ตำแหน่ง
- [x] **SAST (Semgrep 228 กฎ, 347 ไฟล์)** — 17 จุด ไม่มีช่องโหว่จริง (ชื่อตัวแปร secret/password, regex ที่จำกัดความยาวแล้ว, Math.random ที่ไม่ใช่งานความปลอดภัย) · จุดเดียวที่มีน้ำหนัก: DB TLS ไม่ตรวจใบรับรองเมื่อไม่มี `DB_SSL_CA` → 👤 ตั้งใน Render (อยู่ในรายการเดิม)
- [x] **DAST (OWASP ZAP baseline + active scan, ไม่ล็อกอิน + ล็อกอินเป็น owner, ~17 นาที, สำเนาแอปไม่มี .env + DB ทดสอบ)** — ไม่มี critical/high · SQLi/XSS/open redirect/cookie ที่ ZAP แจ้งตรวจด้วยมือแล้วเป็น false positive · แก้: ค่าที่ DB รับไม่ได้ (NUL byte, ไม่ใช่ตัวเลข, ยาวเกิน, %-escape เสีย) เดิมเป็น 500 "unhandled" + log ยาว (สแกนครั้งเดียว ~2,500 บรรทัด) → `handle()` ตอบ 400 `BAD_INPUT` + warn บรรทัดเดียว (contract ยอมรับเป็น 400 ของทุก operation เหมือน 500) · `?id=1.2` ของ DELETE profile → 400 id required · `/api/attachments/<ไม่ใช่ตัวเลข>` → 404
- [x] **CSP หน้าพนักงานไม่มี `'unsafe-inline'` แล้ว** — nonce ต่อ request แบบเดียวกับ `/track` ทุกหน้า (login, หน้าพนักงาน, 404) จาก `src/proxy.ts` ที่เดียว (`withCsp`) · root layout `connection()` ให้ทุกหน้า render ต่อ request (เดิม static 4 หน้า: pending, logout, not-found, global-error — global-error ยัง static: แสดงข้อความได้แต่ปุ่มลองใหม่ไม่ทำงาน ใช้เฉพาะตอน root layout พัง) · zod ฝั่งเบราว์เซอร์ `jitless` — เดิมการลอง `new Function` ของ zod ถูกรายงานเป็น CSP violation ทุกหน้าที่มีฟอร์ม (มีมาตั้งแต่ CSP เดิม) · e2e: ทุกหน้ามี nonce, ไม่มี unsafe-inline, ไม่มี violation, Turnstile เฉพาะ `/track`
- [x] **`/api-docs` DOMPurify 3.3.0 → 3.4.16** — `@hrefcl/apidoc` 5.1.0 (ล่าสุด) ฝังมากับ jsPDF · `scripts/build-api-docs.ts` แทนทั้งโมดูลด้วย devDependency ที่ pin ไว้ (เช็ก anchor, template เปลี่ยน = build ล้ม) · ตรวจ: syntax ผ่าน, หน้าเปิดได้ไม่มี error
- [ ] **ยังเปิดอยู่ (เกี่ยวกับภายนอก — เลื่อนไว้)** — แจ้งเตือนเหตุผิดปกติ (👤 เลือกช่องทาง) · CodeQL (repo องค์กรต้องใช้ GitHub Advanced Security) · `security.txt` (👤 อีเมลติดต่อสาธารณะ) · ยืนยันตัวตนซ้ำก่อนแก้สิทธิ์ (ผ่าน SSO) · ซ้อมกู้ backup · ค้นลูกค้าด้วยอีเมล/ชื่อผู้ใช้ส่งทาง query string (log ของแอปไม่เก็บ query; log ของ Render/Cloudflare อาจเก็บ — ยอมรับ: GET ค้นหาแบบนี้เป็นมาตรฐาน, ระบบภายใน)

## Audit รอบใหญ่ (2026-10-20 — 6 ด้านขนาน: โค้ดทั้งโปรเจกต์, PDPA, dependency, เบราว์เซอร์/มือถือ, โหลด, กระทบยอดข้อมูลเก่า)

**ผ่าน:** ข้อมูลเก่า 420,113 แถว / 52 ตาราง ย้ายครบ, migration 0000–0035 ไม่ลบแถวไหน, ยอดเงิน/สถานะ/สต๊อกตรงทุกเดือน (ต่าง 0.00), เลขเอกสารไม่ชน, ไม่มีแถวกำพร้า · โหลด (0.5 CPU / 512 MB เท่า Render Starter): ~70 req/s (ใช้จริง ~26), ไม่มี 5xx, RSS สูงสุด 382 MB, คอขวด = CPU · Safari/iPhone/iPad/Android ผ่าน e2e (Firefox รันในเครื่องนี้ไม่ได้) · license ไม่มี copyleft ในของที่ขึ้น production

- [x] **แก้แล้ว — โค้ด:** OTP จับคู่เบอร์ข้ามลูกค้า (ช่องที่มีสองเบอร์ — dev 553 ราย: เลขช่วงรอยต่อเปิดงานลูกค้าคนอื่นได้) → จับคู่ทีละเบอร์ตรงตัว · กด Back แล้ว prefetch เก่าทับข้อมูลใหม่ (หน้าซ่อม 409 + งานที่กรอกหาย) → prefetch มี id, เล่นซ้ำไม่ seed · เปลี่ยน `?no=` บนหน้าเดิมไม่เปลี่ยนเอกสาร → key ตามเลข · รายการซ้ำในคำขอเดียว (เบิก/คืน/บันทึกอะไหล่ นับ 2 เท่า) → 400 · แก้ระเบียนที่ลบแล้ว (งาน/ใบเสนอราคา/ลูกค้า/อะไหล่ — บางทางกลับมาใช้งานโดยไม่มีสิทธิ์ลบ) + แนบไฟล์เข้างานที่ลบ → 409 · ปิดงานไม่เช็ก version → 409 stale · ล็อก OTP ไม่ตรวจตอนกรอกรหัส → ปลดรหัสที่ใช้อยู่ทันที · decode URL ซ้ำ (หน้าพิมพ์ 500) · `PUBLIC_PATH` รูปภาพทุกระดับ path ข้าม login gate → เฉพาะไฟล์ระดับบนสุด · นับจำนวนหน้ารายการงานไม่ join ที่ไม่ใช้ (seq scan ทั้งตาราง)
- [x] **แก้แล้ว — PDPA / ความปลอดภัย:** เพดาน SMS ทั้งบริษัท 500/วัน (เดิมแค่ 200/ชม. = แย่สุด 4,800/วัน) · `track_otp` ลบเมื่อหมดอายุเกิน 1 วัน (เดิมเก็บตลอด) · comment/runbook บอกตรงว่า IP จริงอยู่ใน `issued_ip` ช่วงสั้น · `?deleted=only|all` เฉพาะ System Admin · ลิงก์ไฟล์แนบ 10 → 2 นาที · รูปที่มี EXIF (GPS) re-encode เสมอ + ไฟล์แนบงานผ่าน `optimizeImage` (เดิมเก็บรูปเต็ม 10 MB พร้อม GPS)
- [x] **แก้แล้ว — มือถือ:** `/track` เลขพัสดุทับปุ่ม, ช่องกรอง 14px (iPhone ซูม) → 16px/44px, ปุ่ม < 44px ทั้งหมด, หน้ายืนยันลิงก์วนยิงซ้ำเมื่อ error → รอกด "ลองอีกครั้ง", Turnstile โหลดไม่ขึ้นวนเช็กตลอด → หยุดที่ 15 วิ · ช่องกรอกหน้าพนักงาน 16px บนมือถือ (`text-base md:text-sm`)
- [x] **แก้แล้ว — dependency / deploy:** `overrides` 3 ตัว → production 0 ช่องโหว่ (dev เหลือ 8 จาก `braces` ที่ยังไม่มีเวอร์ชันแก้ — ไม่ถูกเรียกจาก input ภายนอก) · `.npmrc ignore-scripts=true` · CI `persist-credentials: false` + `npm audit --audit-level=moderate` · heap cap ย้ายจาก `NODE_OPTIONS` ไป `startCommand` (build บน Render หน่วยความจำไม่พอ) → 👤 ลบ `NODE_OPTIONS` ใน Render dashboard ด้วย
- [x] **ทดสอบจริงในเบราว์เซอร์ (dev DB ข้อมูลขนาดจริง, อัดวิดีโอทุก flow)** — ผ่านทุก flow หลัก + ทุกจุดที่แก้ · เจอ 9 ข้อ แก้ 8: `/track` เน็ตหลุดขึ้น "Failed to fetch" อังกฤษ → ข้อความไทย · เช็กเบอร์ซ้ำไม่เจอเบอร์ในช่องสองเบอร์ (สร้างลูกค้าซ้ำ → ได้ OTP ของเบอร์นั้น) → แยกทีละเบอร์ (`phonesIn`) · สร้างเอกสารให้ลูกค้าที่ลบแล้ว → 409 (`customerForDocument`; เอกสารเดิมยังแก้ได้) · ฟอร์มค้างของระเบียนที่ลบขึ้นข้อความ stale → "ถูกลบแล้ว" · ช่องกรอก ~20 ช่องยังทำ iPhone ซูม → 16px บนมือถือ · เพิ่มอะไหล่ซ้ำในหน้าซ่อม → ไฮไลต์แถวเดิม · favicon · คู่มือพูดถึงปุ่มลบลูกค้าที่ไม่มี · ไม่แก้: URL อักขระเสียได้ 400 อังกฤษจาก Next.js เอง (ก่อนโค้ดเราทำงาน), ค้นลูกค้าฝั่งพนักงานด้วยเลขบางส่วนยังเจอเลขรอยต่อของช่องสองเบอร์ (ค้นบางส่วนตั้งใจให้ได้, พนักงานเห็นลูกค้าทุกคนอยู่แล้ว) · ยังไม่ได้ทดสอบ: อัปโหลดสำเร็จผ่าน Supabase Storage จริง, Firefox
- [x] **Responsive (50 หน้า × 20 ขนาดจอ: มือถือ 360–430, แท็บเล็ต 768–1366 ทั้งแนวตั้ง/นอน, PC 1280–3840)** — ไม่มีหน้าพัง, dialog พอดีทุกจอรวม 1366×768 · แก้ 17 ข้อ: แถบบนล้น 15px ที่ 1024 (iPad Pro) ทุกหน้า → 0 · ตารางที่ 1024–1279 ใช้ container query (คอลัมน์ตามความกว้างตาราง ไม่ใช่จอ) — 1280–1920 คอลัมน์เท่าเดิม · ใบรับงานซ่อม A4 2 หน้า → 1 (`@page` margin 10mm, ทุกเอกสารพิมพ์ยัง 1 หน้า) · ตารางบนมือถือเห็นคอลัมน์หลักไม่ต้องเลื่อน (งาน: เลขที่+สถานะ+จัดการ, ใบสั่งขาย: เลขที่+สถานะอนุมัติ) · ปุ่มบนจอสัมผัส 44px (`pointer-coarse:` — desktop ขนาดเดิม) · ตัวกรองรายการงานพับบนมือถือ · ค้นหาด่วนเปิดได้บนมือถือ · ช่องค้นเลขเอกสาร / ตัวเลือกอะไหล่ / ประเภทลูกค้า / ช่วงวันที่ dashboard / ตัวกรอง `/track` ไม่ล้น · คู่มือกว้างไม่เกิน 80ch · ไม่แก้: จอ 3440/3840 ที่ 100% เหลือที่ว่างข้าง (เนื้อหากว้างสูงสุด 1600px) · ยังไม่ได้ตรวจ: เครื่องจริง, ปฏิทินเลือกวันของมือถือ, แป้นพิมพ์บนจอ, โหมดมืด
- [x] **โหมดมืด (2026-10-21)** — 52 หน้า × 1366/390 + dialog/popover/toast: contrast ข้อความผ่านอยู่แล้ว · แก้ที่ token ใน `globals.css`: พิมพ์จากโหมดมืดเคยได้ตัวอักษรสีอ่อนบนกระดาษขาว → พิมพ์สีสว่างเสมอ, ปุ่ม/ปฏิทิน/scrollbar ของเบราว์เซอร์ตามธีม (`color-scheme`), popover แยกสีจากการ์ด, เส้นขอบชัดขึ้น · ตัวเลขเมนู sidebar 3.9 → 5.7:1, ขีดศูนย์ใน dashboard, แถบสีเบราว์เซอร์ตามธีมที่เลือก, โลโก้ `/track` ขอบมน · โหมดสว่าง computed style เหมือนเดิม 12 หน้า
- [x] **session หมดระหว่างกรอก (2026-10-21)** — พิมพ์อยู่ต่ออายุเองอยู่แล้ว (ไม่นับ scroll แล้ว: แท็บที่ไม่มีใครแตะไม่ต่ออายุเอง) · บันทึกตอน session หมด → หน้าไม่หาย, dialog ให้ login ในแท็บใหม่ แล้ว "บันทึกอีกครั้ง" ส่งคำขอเดิม (Idempotency-Key เดิม → ไม่ซ้ำ) · ฟอร์มลูกค้าที่เคยหายเมื่อหมดเวลา → เก็บไว้ · ครบ 12 ชม. บอกตรง ๆ ว่าต่ออายุไม่ได้
- [x] **อัปโหลดบนเน็ตช้า (2026-10-21)** — ย่อรูปในเครื่องก่อนส่ง (1600px JPEG 0.82): 7.2 MB บน 400 kbps 145.6 → 10.7 วิ · แถบความคืบหน้า, ปุ่มเลือกไฟล์ปิดระหว่างอัป, ล้มแล้ว "ลองอีกครั้ง" ไฟล์เดิม, เตือนก่อนปิดหน้า · ไฟล์แนบงานมี Idempotency-Key (ลองซ้ำหลังคำตอบหาย = ไม่เกิดไฟล์ซ้ำ)
- [x] **หน้าปิดปรับปรุง (2026-10-21)** — `MAINTENANCE_MODE=1` (+ `MAINTENANCE_UNTIL`, `MAINTENANCE_BYPASS_SECRET`) → ทุกหน้า 503 หน้าไทย (ธีมตามผู้ใช้, มือถือ), API 503 JSON, `/api/health` 200 + `maintenance:true`, ลิงก์ลับให้ทีมเข้าแอปจริง 12 ชม. · ใช้แทน Suspend ใน `ops/cutover.md` · ต้อง redeploy ตอนเปิด/ปิด
- [x] **e2e 3 ขนาดจอ (2026-10-21)** — จอคอม + Pixel 7 + iPad: 84/84 (28 × 3) ทั้ง DB ใหม่และเก่า, อยู่ใน CI · WebKit ยังไม่ใส่: ต้องให้ e2e รันผ่าน https ก่อน (ตัวช่วยแทน cookie จะซ่อนปัญหาจริงของการ login)
- [x] **ทดสอบแบบใช้งานจริงหลายคนพร้อมกัน (2026-10-21)** — server กลาง (production build, dev DB ข้อมูลจริง, pool 5, Supabase Storage จำลองในเครื่อง) · 6 agent ตามเมนู × role ละ 2 คน (120 บัญชี) · ตรวจทั้งหน้าจอและ DB, อัดวิดีโอทุกสถานการณ์ · **ที่แข็งแรงอยู่แล้ว:** อนุมัติใบสั่งขายตัดสต๊อกครั้งเดียว, ชิ้นสุดท้ายจ่ายได้คนเดียว, สต๊อกไม่ติดลบ, Stock Card ตรง, เลขเอกสารไม่ซ้ำ, ฟอร์มหลักกันเขียนทับ, รายงานตรง SQL · **แก้ (ทุกข้อมี test ที่ล้มก่อนแก้, 81 test ใหม่ใน `scripts/test-qa-*.mts` อยู่ใน `test:db`):** ลูกค้าเบอร์/เลขภาษี/อีเมลซ้ำเมื่อกดพร้อมกัน (advisory lock + เช็กใน transaction — ทดสอบซ้ำ 40/40) · หน้าซ่อมที่เปิดค้างทำสถานะงานย้อน (จ่ายอะไหล่ bump version ใน transaction เดียว) · แก้/ลบอะไหล่ที่จ่ายแล้วบอก "บันทึกแล้ว" แต่ไม่เปลี่ยน → 409 บอกชื่ออะไหล่ · อะไหล่จ่ายบางส่วนติดตาย → ลดเหลือเท่าที่จ่าย/รับคืนบางส่วนได้ · ส่งซ่อมนอก/เปลี่ยนเครื่อง/ปิดงาน/เลขพัสดุ/ผู้ใช้/สิทธิ์ role/ข้อมูลหลัก/รุ่นสินค้า เขียนทับกันเงียบ → 409 · หน้าซ่อม/ปิดงาน/ส่งซ่อมนอก/เปลี่ยนเครื่องบันทึกเป็นคำขอเดียวใน transaction เดียว (ถูกปฏิเสธ = ไม่มีอะไรถูกบันทึก) · สลิปเปลี่ยนหลังอนุมัติ (ล็อกแถว, 28 รอบไม่หลุด) · ใบเสนอราคา: ส่วนลดติดลบ/เกิน, 2 ใบอนุมัติงานเดียว, ย้ายใบที่อนุมัติ, รายการอะไหล่เก่า, ปัดเศษ %, อนุมัติหลังงานถูกปฏิเสธ · ราคาอะไหล่จาก API ไม่เชื่อ client · มอบหมาย/ปิดงานผิดสถานะ · ลบงาน/ใบเสนอราคา/อะไหล่/ใบสั่งขายที่ยังถูกอ้างถึง · ลูกค้าที่ลบ/ปิดใช้งานในฟอร์ม · ค้นด้วยเลขไทย/เบอร์ใหม่ของลูกค้า · สถานะงาน 11⇄10 ตามอะไหล่ · ชื่อตำแหน่งซ้ำต่างตัวพิมพ์ · export ถึงเพดานมีคำเตือน · กู้คืนข้อมูลหลัก + เพิ่ม/ลบตำแหน่งในหน้าจอ · ข้อความ 403 เป็นชื่อเมนูไทย · **ยังไม่ได้แก้:** จ่ายอะไหล่บางส่วน/รับคืนไม่ bump row_version (trigger 0027 ข้ามเมื่อไม่มีคอลัมน์ job เปลี่ยน — ผลคือหน้าค้างที่แก้บรรทัดนั้นได้ 409 บอกชื่ออะไหล่ ไม่เสียข้อมูล) · 👤 ตัดสินใจ: ใครลบลูกค้าได้, ลูกค้า/สินค้า Inactive ในเอกสารใหม่, อายุใบเสนอราคานับจากวันสร้างหรือวันส่ง, Manager ไม่มีสิทธิ์ใบเสนอราคา/Salesman ไม่มีสิทธิ์ใบสั่งขาย, ปุ่มยกเลิกใบสั่งขาย + สลิปหลังอนุมัติ + พิมพ์ใบที่ยกเลิก
- [x] **ตัดสินใจของเจ้าของ (2026-10-21)** — ลบลูกค้า: CS + Manager (0037 เอาสิทธิ์ลบออกจาก Head Engineer) + ปุ่ม "ลบ" ในหน้าลูกค้า · ลูกค้า/สินค้า Inactive ใส่ในเอกสารใหม่ไม่ได้ (ตัวเลือกเป็นสีเทา, เอกสารเดิมยังแก้ได้) · Manager: ใบเสนอราคา ดู/สร้าง/แก้ · Salesman: ใบสั่งขาย ดู/สร้าง/แก้ + ลูกค้า ดู/เพิ่ม (0037 — แถวเดิมที่ปิดทุกช่องก็ได้สิทธิ์) · ช่องพนักงานขายเฉพาะ role ที่สร้างใบสั่งขายได้ · ใบสั่งขาย: ปุ่มยกเลิก (ผู้สร้าง / SO Approve / admin, ใบอนุมัติแล้วยกเลิกไม่ได้, เก็บเหตุผล) + ตัวเลือกแสดงใบที่ยกเลิก, แนบสลิป + ยอดชำระหลังอนุมัติได้เมื่อยังไม่มีสลิป (สลิปเดิมเปลี่ยนไม่ได้), พิมพ์ใบที่ยกเลิกไม่ได้ (เช็กฝั่ง server) · จ่ายอะไหล่บางส่วน/รับคืน bump row_version ของงานแล้ว (0036 ให้ trigger เก็บการเพิ่ม version ที่สั่งเอง) · ยังพักไว้: อายุใบเสนอราคา 7 วันนับจากวันสร้างหรือวันส่ง
- [x] **ตรวจ race condition ทั้งระบบ (2026-10-21)** — บัญชีทุก operation ที่เขียน (~50, รวม GET ที่เขียน: SSO callback, export audit, track) × 6 แบบ (2 คนพร้อมกัน, กดซ้ำ, เช็กแล้วค่อยเขียน, หลายขั้นไม่อยู่ใน tx เดียว, นับใน JS, ลำดับล็อก) · พิสูจน์ยิงพร้อมกันจริง → 15 จุด (กลาง 2, ต่ำ 13) แก้ครบ: login ทับ role ที่ admin เพิ่งเปลี่ยน (UPDATE เดียวตัดสินใน SQL) · สร้างอะไหล่/บันทึกการโทรกดซ้ำ (idempotent) · ลบไฟล์แนบซ้ำ (UPDATE มีเงื่อนไข) · โปรไฟล์ค่าเริ่มต้นซ้ำ (advisory lock + 0038 unique index สำรอง) · โปรไฟล์เอกสาร/ขนส่งเขียนทับ (expect → 409) · ไฟล์ค้างตอนอัปโลโก้/รูปพร้อมกัน (อ่าน path เดิมใต้ล็อก) · ลิงก์ติดตามออกซ้ำ (tx เดียว) · ช่อง export ถูกปล่อยผิดคน (token) · ลูกค้า/งาน/อะไหล่/ช่างถูกลบระหว่างบันทึกเอกสาร (อ่าน FOR SHARE ใน tx) · username ซ้ำต่างตัวพิมพ์ · ตั้งผู้ใช้ให้ตำแหน่งที่กำลังถูกลบ · cache สิทธิ์เติมค่าเก่า (generation) · login ครั้งแรกพร้อมกัน 2 แท็บล้ม · test ยิงพร้อมกัน 26 ตัว (`test-qa-race-*.mts`) ล้มก่อนแก้ทุกตัว · stress 7 คนเขียนพร้อมกัน: 0 deadlock, สต๊อกไม่เพี้ยน
- [x] **ทดสอบ race ในเบราว์เซอร์จริง (2026-10-21)** — production build + dev DB, 2 agent: งาน/สต๊อก/เอกสาร ~230 รอบ (รวมโหลดผสม 7 สถานการณ์ 14 เบราว์เซอร์: 0 5xx, 0 deadlock) และ admin/login/ไฟล์ 116 วิดีโอ · **แก้:** อัปโลโก้โปรไฟล์ทับค่าที่อีกคนเพิ่งแก้ (หน้าเอา path ใหม่มาใส่ฟอร์ม) · ลิงก์ติดตามที่ถูกแทนที่ยังคัดลอกได้ (ขีดฆ่า + "คัดลอกลิงก์" ตรวจสถานะก่อนคัดลอกทุกครั้ง) · export: ถูกปฏิเสธเพราะมีคนส่งออกอยู่ไม่นับโควตา 5 ครั้ง/นาที และคนที่เกินโควตาไม่จองช่อง export ให้คนอื่นได้ "มีการส่งออกอยู่" ผิด ๆ · กดบันทึกการโทร/สร้างอะไหล่ซ้ำ (ไม่มี "บันทึกไม่สำเร็จ" ซ้อน) · ลบไฟล์แนบซ้ำบอก "ไฟล์นี้ถูกลบไปแล้ว" · ใบเสนอราคาที่ถูกลบบอกชื่อสถานะ · ช่างที่ถูกปิดใช้งาน · ปุ่ม Call Log บนมือถือ · test: `test-qa-race-routes.mts` + `e2e/track-link.spec.ts` ล้มก่อนแก้ · **ยังเหลือ (ต่ำมาก, ไม่แก้):** คลิก 2 ครั้งใน tick เดียว (สคริปต์เท่านั้น) toast สำเร็จขึ้น 2 ครั้ง ข้อมูลไม่ซ้ำ · ช่างที่ถูกปิดใช้งานกดรับงานเองเห็น "เลือกช่างคนอื่น"
- [x] **บทสอนการใช้งานทีละขั้น — ตัวอย่างหน้าเปิดงานใหม่ (2026-10-26)** — ปุ่ม ? = บทสอนของหน้านั้น (หน้าที่ยังไม่มี → คู่มือเดิม), เข้าหน้าครั้งแรกถามครั้งเดียว · 14 ขั้นเรียงตามที่ตาอ่าน สว่างทีละช่อง (SVG mask), ช่องที่สว่างลองพิมพ์/ติ๊ก/เลือกได้ ส่วนอื่นกดไม่ได้ (บันทึก แนบไฟล์ ลิงก์ ⌘K) → ไม่บันทึกจริง · จบแล้วทุกส่วนของฟอร์มกลับเป็นเหมือนก่อนเริ่ม (`useTourRestore` ต่อส่วน: ฟอร์มงาน + ช่องเลือกลูกค้า) · ข้อความตามสิทธิ์/ข้อมูล (เพิ่มลูกค้า, ออกเอกสารในนาม, มอบหมาย) · การ์ดไม่ทับช่อง/dropdown, จอเตี้ยเป็นแถวเดียว, Tab วนในบทสอน, aria-live · QA เบราว์เซอร์ 4 รอบ (dev DB, 5 ขนาดจอ × สว่าง/มืด × 5 role) · e2e `tour.spec.ts` ตรวจทุกขั้น: ลำดับ, ไม่มีช่องอื่นสว่าง, การ์ดไม่ทับ, ไม่บันทึก, ฟอร์มกลับ — ล้มก่อนแก้ · ฟอร์มงาน: ช่องว่างหลัง "โดยบริษัทขนส่ง"/"รุ่นย่อย" ตั้งแต่ sm (iPad: อุปกรณ์ขึ้นแถวใหม่) · ~~ยังไม่ทำ~~ → ทำแล้วด้านล่าง
- [x] **บทสอนครบทุกหน้า (2026-10-27)** — 40 หน้า (`src/components/tour/pages/*.ts`): หน้าที่ต้องเปิดเรคคอร์ดก่อนสอน 2 ช่วง (ว่าง → เปิดแล้ว), สอนต่อเข้าไปใน dialog เพิ่ม/แก้ (`dialog: { open, close }` — เปิด/ปิดให้เอง การ์ดอยู่ใน dialog) · ถามครั้งแรกต่อหน้า + "ไม่ต้องถามอีก (ทุกหน้า)" เก็บต่อบัญชี (`app_user_tour`, migration 0039, `POST /api/me/tour`) · ระหว่างบทสอน fetch/XHR ที่ไม่ใช่ GET ถูกปฏิเสธทั้งแอป (ยกเว้น `/api/me/tour`) — ช่องที่บันทึกทันที (เลือกโปรไฟล์เอกสาร, ปุ่มบันทึกลูกค้าใหม่) `data-tour-block` · ช่องที่ readonly/อ่านอย่างเดียว ไม่นับว่ากดได้, ฟิลเตอร์ที่พับอยู่ (inert) ไม่สว่าง, ตารางกว้าง/dialog เลื่อนให้ช่องเข้าจอ · e2e `tour.spec.ts` วนทุกบทสอน × 3 ขนาดจอ: ทุกขั้นตรวจลำดับ/ช่องอื่นไม่สว่าง/การ์ดไม่ทับ/อยู่ในจอ, ไม่มี request เขียน, ไม่เหลือ dialog เปิด, ไม่ออกจากหน้า
- [x] **QA บทสอนรอบ 2 + บั๊กที่เจอ (2026-10-27)** — QA เบราว์เซอร์ 3 ทีม (40 หน้า × 5–7 ขนาดจอ × หลาย role, นับแถว DB ก่อน/หลัง: ไม่มีอะไรถูกบันทึก) · ตัวบทสอน: ระหว่างบทสอนไม่ถาม "ออกโดยไม่บันทึก?", หน้าต่างยืนยันของหน้าเว็บตอบได้, Enter ในช่องที่สว่างไม่ทำงาน (เคยทำให้ /admin/permissions ค้าง), หน้าต่างถูกปิดโดยหน้าเว็บ = จบบทสอน, ขั้นดูอย่างเดียวบอกในการ์ด, การ์ด ≤ 220 ตัวอักษร (`test:tours`), เปิดแท็บที่ต้องสอนให้เอง (`prepare`), ตาราง TAT ล็อกคอลัมน์สถานะ, ข้อความถามครั้งแรกย้ายลงล่าง · ข้อความในการ์ดแก้ให้ตรงโค้ด · บั๊กแอป: สถานะ Out-Source 14/15 ไม่เปลี่ยนเอง, "รับจาก" แก้ได้แต่ไม่บันทึก (→ แสดงอย่างเดียว), ส่วนข้อมูลเครื่อง/อื่นๆ ล็อกเมื่อไม่มีสิทธิ์แก้ไขข้อมูลงาน, ค้นหาใบเสนอราคาทุกช่อง (AND), ล้างค่าในรายงานคืนวันที่เริ่มต้น, รายงานปิดงานเรียง TAT/ยอดรับชำระ/วิธีส่งคืน, ส่งออกผู้ใช้ตามตัวกรอง, จ่ายออกอื่นๆ แบ่งหน้า, วันที่ Dashboard ไม่ยิงค้นหาจนพิมพ์ครบ, "Please Select" → "เลือก"
- [ ] **โลโก้บริษัทขนส่ง + รองรับ SVG (2026-10-27)** — อัปโหลดโลโก้ (โปรไฟล์ผู้ออกเอกสาร / บริษัทขนส่ง) รับ SVG ได้ เฉพาะภาพวาดล้วน: มี script / on…= / javascript: / foreignObject / ENTITY / ลิงก์ไฟล์ภายนอก → ปฏิเสธ (`svgProblem`; ไฟล์จริงของ 5 บริษัทใน `tests/fixtures/logos` ผ่าน, test-schemas) · รูปอะไหล่และสลิปยังไม่รับ SVG · โลโก้เก็บใน bucket ที่เดียว (`shippers/{id}/…`) · **หลัง deploy:** System Admin อัปโหลดโลโก้ Flash / J&T / SPX / Kerry (ใช้ `Kerry_Express_cropped.svg` — ต้นฉบับมีขอบว่างขนาด A4) / ไปรษณีย์ไทย ที่ /admin/shipping-profiles แล้วติ๊กข้อนี้
- [x] **แผนวันเปิดระบบ** [ops/cutover.md](../ops/cutover.md) — เกณฑ์ go/no-go, `recon.sql`, ลำดับวันเปิด, แผนถอยกลับ
- [ ] 👤 **ต้องตัดสินใจ:** โหลดข้อมูลวันเปิดลงโปรเจกต์ Supabase ใหม่ (แนะนำ) หรือ dump ทับ (ข้อมูลในระบบใหม่หาย + deploy ล้ม) · Supabase **Pro** (ไฟล์เดิม 1.8 GB เกินแพ็กเกจฟรี) · ล้างรหัสผ่านระบบเก่า 106 บัญชีที่เก็บเป็นข้อความธรรมดา (ระบบใช้ SSO ไม่ได้ใช้แล้ว — migration ย้อนไม่ได้) · ไฟล์แนบที่หายจากเซิร์ฟเวอร์เก่า 1,453 + สลิป 980 จะตามกู้ไหม · export: ลดเพดาน 20,000 แถว หรือบังคับช่วงวันที่ (export เต็มทำให้ทั้งระบบช้าลง ~5 เท่า 5–20 วิ) · PDPA: ประกาศความเป็นส่วนตัว (`/track`, ใบรับเครื่อง, พนักงาน), ระยะเก็บข้อมูล, นโยบายลบ/ทำให้ระบุตัวไม่ได้ (เอกสารการเงินเก็บ 5–7 ปีตามกฎหมาย), ใครควร export / เห็นเลขบัตร (ตอนนี้ทุก role export ได้, System Admin 35 คน), audit_log เก็บค่าก่อน-หลังที่มีเบอร์/ที่อยู่ลูกค้า, บันทึกการอ่านข้อมูลลูกค้า, ดึงรายชื่อลูกค้าทั้งหมดผ่าน API ได้ไม่มีบันทึก, DPA กับ Render (สิงคโปร์)/Supabase/Cloudflare/ThaiBulkSMS/Lark · Dependabot ไม่ทำงานจนกว่าไฟล์จะอยู่บน `main`

## id ภายนอกเป็น uuid v7 แบบ OneLink (2026-10-28 — [ADR 0008](../adr/0008-bigint-pk-uuid7-id.md), เริ่มหลัง cutover)

ทำหลังโหลดข้อมูลจริงรอบสุดท้ายและระบบเก่าหยุดรับงาน — ก่อนนั้นทุกการโหลด dump สร้างตารางใหม่หมด

- [ ] **ID-1 สำรวจ** · M — ทุกตาราง: PK เดิม, คอลัมน์ที่อ้างถึง (FK จริง 31 + join ด้วยข้อความ เช่น `job_no`, `sale_out_hd_no`,
  `customer_code`), จุดที่ id ออกนอกฐาน (contract ~50 จุด, URL ของหน้า, export, audit_log.record_id) → ตาราง mapping
- [ ] **ID-2 migration สร้างตารางใหม่** · L — `uuid_generate_v7()` (จาก OneLink 0027), ทุกตาราง `pk` + `id` หน้าสุด, FK `<table>_pk` /
  `<บทบาท>_<table>_pk`, backfill uuid ตามวันที่สร้างแถว, ทั้งไฟล์ใน transaction เดียว · ซ้อมกับสำเนา prod ใน dev ก่อน
- [ ] **ID-3 แอป** · L — drizzle schema, service/route รับ-ส่ง `id` (uuid) แทน int, หน้าเว็บ/URL, export, `seed-export.mts`;
  แบ่ง agent ตามกลุ่ม API (ผู้ใช้/สิทธิ์ · งาน/ไฟล์แนบ · ขาย/เสนอราคา · คลัง · ข้อมูลหลัก/โปรไฟล์)
- [ ] **ID-4 เทสต์บังคับกติกา** · S — ทุกตารางมี `pk` + `id`; ไม่มีคำตอบ API ไหนมี `pk` / `*_pk` (แบบ OL `public-ids.test.ts`)
- [ ] **ID-5 ตรวจครบ** · M — `test:db`, e2e ทุก project, OpenAPI snapshot, QA เบราว์เซอร์ · เลิกใช้ `load_supabase.sh` / `db:dev:load`

## วิดีโอแนบงาน (2026-10-28 — คลิปอาการเสียจากลูกค้า)

- [x] **แนบวิดีโอ** — MP4 / MOV / WebM ≤ 3 นาที ที่ "เอกสารแนบ" · เบราว์เซอร์แปลงเป็น MP4 H.264 + AAC ≤ 1080p ≤ 30fps คุณภาพคงที่ (quantizer 26, สำรอง VBR 2.5 Mbps; ใหญ่เกิน 120 MB → แปลงใหม่ VBR 5 Mbps), เสียง 96 kbps, คีย์เฟรมทุก 2 วิ, faststart — คลิป 3 นาที ~35–60 MB ไม่เกิน ~115 MB
  (mediabunny, โหลดเมื่อเลือกวิดีโอเท่านั้น) แล้ว PUT ตรงเข้า **Cloudflare R2** ด้วย presigned URL (2 ชม., Content-Type
  และ `If-None-Match: *` อยู่ในลายเซ็น — เขียนทับไฟล์ที่มีอยู่ไม่ได้ R2 ตอบ 412) — ไม่ผ่าน Render · `POST /api/attachments/video` → `…/confirm` ตรวจไฟล์ใน R2 (ranged GET ที่ลงชื่อ:
  มีจริง ≤ 200 MB ไบต์แรกเป็น ftyp / EBML) ก่อนเพิ่มแถว ไม่ผ่าน → ลบออกจาก R2 · ภาพตัวอย่าง `{file}.jpg` ข้างวิดีโอ (R2 เช่นกัน) ·
  พนักงานเท่านั้น (`/track` ไม่เห็น) · `scripts/test-qa-video.mts` (R2 ปลอม), `tests/e2e/video-attachment.spec.ts`
- [x] **แยกที่เก็บ** (`src/server/storage.ts` `onR2`) — R2 เก็บเฉพาะชื่อที่ route วิดีโอออกให้: `jobs/{no}/attachments/v{14 หลัก}{20 hex}.mp4|mov|webm`
  และ `….jpg` ของมัน · อย่างอื่นทั้งหมดอยู่ Supabase เหมือนเดิม (รูป PDF สลิป โลโก้ และ .mp4 2 ไฟล์จากระบบเก่า — ชื่อไม่มี `v`
  จึงยังเปิดจาก Supabase) · `/api/files` → presigned GET 15 นาที (`download=1` → `response-content-disposition=attachment`) ·
  ไม่ได้ตั้ง R2 → API วิดีโอตอบ 503 "ยังไม่ได้ตั้งค่าที่เก็บวิดีโอ — ติดต่อผู้ดูแลระบบ", ช่องแนบไม่รับวิดีโอ, env check เตือน (รูป / PDF ใช้ได้ปกติ)
- [ ] 👤 **ก่อนใช้จริง — ตั้งค่า Cloudflare R2:**
  1. R2 → Create bucket `shd-oneservice-videos` · Location hint **Asia-Pacific (APAC)** · Storage class **Standard** · ไม่เปิด public access / custom domain
  2. bucket → Settings → **CORS policy**:
     ```json
     [
       {
         "AllowedOrigins": ["https://oneservice.shd-technology.co.th"],
         "AllowedMethods": ["GET", "HEAD", "PUT"],
         "AllowedHeaders": ["content-type", "range", "if-none-match"],
         "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
         "MaxAgeSeconds": 3600
       }
     ]
     ```
  3. R2 → Manage API tokens → Create **Account API token** · permission **Object Read & Write** · _Apply to specific buckets only_ →
     `shd-oneservice-videos` เท่านั้น · จด Access Key ID / Secret Access Key (แสดงครั้งเดียว) และ Account ID
  4. bucket → Settings → **Object lifecycle rules**: ย้ายเป็น Infrequent Access หลัง 30 วัน · Abort incomplete multipart uploads หลัง 7 วัน
  5. Render → Environment: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=shd-oneservice-videos` → deploy
     (CSP `media-src` / `connect-src` เพิ่ม `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com` เองจาก env)
  6. ทดสอบแนบคลิปจริง 1 ไฟล์ เปิดเล่น + ดาวน์โหลด แล้วลบแถวทดสอบ
  - ขีดจำกัด 50 MB ของ Supabase Storage ไม่เกี่ยวกับวิดีโอแล้ว (วิดีโอไม่เข้า Supabase) — ไม่ต้องปรับ
  - ทดสอบคลิป iPhone HEVC/HDR จริงบน Chrome / Safari / Firefox (ความเร็วแปลง, สี HDR)
- [ ] **ระยะเก็บ** — ตอนนี้เก็บตลอด (R2 → IA หลัง 30 วัน) · อาจเพิ่มกฎลบวิดีโอ N วันหลังปิดงาน (~35–60 MB/คลิป 3 นาที)

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
