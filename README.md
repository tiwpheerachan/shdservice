# SHD Service System — Next.js UI

ระบบบริหารงานบริการ/งานซ่อม (Service Management System) ออกแบบใหม่ทั้งหมดด้วย **Next.js 15 App Router + TypeScript + Tailwind CSS**
เน้นความเสถียร ความเร็ว และ UI แบบ Modern Enterprise พร้อม **โหมดสว่าง / มืด / ตามระบบ**

---

## เริ่มใช้งาน

```bash
npm install
cp .env.example .env      # ใส่ DATABASE_URL (Supabase Session pooler :5432), SSO และ Supabase Storage key
npm run db:migrate        # สร้าง/อัปเดต schema (รันซ้ำได้ ไม่ทำลายข้อมูล)
npm run dev               # http://localhost:3000
```

Build production:

```bash
npm run build
npm start
```

> ต้องใช้ Node.js 18.18+ (แนะนำ 20 LTS ขึ้นไป)

---

## ฐานข้อมูล (drizzle + migrations)

แอปอ่าน/เขียนฐานข้อมูล **SHDElectronicServiceDB เดิม** (52 ตาราง snake_case ที่แปลงมาจาก SQL Server ด้วย `../setupdata/convert.py`) ผ่าน **drizzle ORM** บน `DATABASE_URL` เท่านั้น — ไม่มีการอ่านผ่าน PostgREST/anon key จาก browser อีกต่อไป

| ที่ | หน้าที่ |
|---|---|
| `src/db/schema/legacy.ts` | drizzle schema ของ 52 ตาราง legacy (+ คอลัมน์ที่แอปเพิ่ม) |
| `src/db/client.ts` | pool + `db` (server-only, session time zone Asia/Bangkok) |
| `src/db/running-no.ts` | ออกเลขเอกสารจาก `running_no` (J/Q/SO/WHI/WHO รายปี, C/P/MD ต่อเนื่อง) |
| `drizzle/0000_baseline.sql` | schema legacy แบบ idempotent (no-op ถ้ามีอยู่แล้ว) |
| `drizzle/0001_app.sql` | คอลัมน์ SSO ใน `app_user`, ย้าย `users` เก่า → `app_user`, drop ตาราง mock, index |
| `drizzle/0002_job_symptom.sql` | ตาราง `job_symptom` (หลายอาการต่อ 1 งาน) |
| `drizzle/0004_indexes.sql` | index สำหรับ filter/รายงาน + `pg_trgm` GIN สำหรับช่องค้นหา (ILIKE) |
| `drizzle/0005_product_type_description.sql` | เพิ่ม `product_type.product_type_description` (ช่องรายละเอียดของหน้า ประเภทเครื่องซ่อม) |
| `drizzle/0006_audit_log.sql` | ตาราง `audit_log` (append-only, trigger กัน UPDATE/DELETE) — ประวัติทุกการเขียนของแอป ดูที่ ข้อมูลระบบ → ประวัติการใช้งาน |
| `drizzle/0008_job_filter_indexes.sql` | index สำหรับตัวกรองหน้ารายการงาน (ยี่ห้อ/รุ่น/งานย่อย/ผู้เปิด/วันรับเครื่อง/warranty/งานเด้ง/เลขพัสดุ) |
| `drizzle/0009_document_profile_delete.sql` | `document_profile.deleted_at/deleted_by` — soft delete โปรไฟล์ผู้ออกเอกสาร (เอกสารเก่ายังพิมพ์ได้, prefix ยังถูกจอง, กู้คืนทาง SQL) |
| `drizzle/0003_record_status.sql` | soft delete แบบเดียวทั้งระบบ: lookup `record_status` (ACTIVE/INACTIVE/DELETED) + คอลัมน์ในทุกตารางที่ลบได้ — ไม่มี hard delete, กู้คืนทาง SQL |
| `scripts/migrate.ts` | `npm run db:migrate` — ตรวจจับกรณี reload dump ใหม่แล้วรัน migration ซ้ำให้เอง |

**หลัง re-dump / reload ข้อมูลจากระบบเก่า** (`../setupdata/load_supabase.sh`) ให้รัน `npm run db:migrate` อีกครั้ง — migration ทุกไฟล์เขียนแบบรันซ้ำได้ และ script จะ reset journal ให้เมื่อพบว่าตาราง legacy ถูกสร้างใหม่

### ผู้ใช้ / สิทธิ์
- login ผ่าน Central SSO เหมือนเดิม → จับคู่กับ `app_user` ด้วยอีเมล (สร้างแถวใหม่แบบรออนุมัติถ้าไม่พบ)
- บทบาท = `app_user.user_type` · สิทธิ์เมนู = `app_config` (user_type × module × add/edit/del/view) — บังคับใช้ที่ API ทุก route ที่เขียน และซ่อนเมนู/ปุ่มใน UI
- หน้า **ข้อมูลระบบ** และ **รายงาน** ใช้ได้เฉพาะ System Admin · owner emails ใน `src/lib/access.ts` / `OWNER_EMAILS` เป็น System Admin เสมอ

รายละเอียด business rule ที่อนุมานจากข้อมูลจริง (สถานะงาน, สต๊อก, ใบเสนอราคา, ใบสั่งขาย) อยู่ใน [`docs/backend-rebase-plan.md`](docs/backend-rebase-plan.md)

---

## สิ่งที่ให้ความสำคัญเรื่องความเสถียร

| หัวข้อ | รายละเอียด |
|---|---|
| Dependency | UI: `next`, `react`, `react-dom`, `tailwindcss` v4, **shadcn/ui** (`radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`), `sonner` (toast), `cmdk` (⌘K), `lucide-react` — ดูหัวข้อ "UI kit" ด้านล่าง · ข้อมูล: `drizzle-orm` + `pg` (server เท่านั้น) · `@supabase/supabase-js` ใช้เฉพาะ Storage · `swr` (client cache ของ data hooks) · `sharp` (ย่อรูปตอนอัปโหลด) |
| Version | ตรึงเวอร์ชันแบบ exact (ไม่มี `^`) ทุกตัว — `npm install` ได้ผลลัพธ์เดิมเสมอ |
| Type Safety | TypeScript `strict: true` ผ่าน `next build` โดยไม่มี error |
| Dark mode | สคริปต์ inline ใน `<head>` ตั้ง class ก่อน paint → **ไม่มีจอกระพริบ (FOUC)** |
| Layout stability | `scrollbar-gutter: stable`, ตารางมี `overflow-x` เฉพาะตัวเอง, sidebar ใช้ CSS transition → ไม่มี layout shift |
| Accessibility | `focus-visible` ring ทุก control, `aria-*` ครบ, ปิด Modal/Palette ด้วย `Esc`, keyboard navigation |
| Print | มี `@media print` และคลาส `.no-print` สำหรับพิมพ์รายงาน/ใบส่งคืน |
| Fonts | Noto Sans Thai + Inter ผ่าน `next/font/google` — self-host ตอน build ไม่มี request ไป Google Fonts ตอนใช้งาน ไม่มี render-blocking stylesheet |

---

## Performance (สิ่งที่ทำไว้แล้ว — อย่าทำซ้ำ)

| ชั้น | กลไก | ที่ |
|---|---|---|
| Client cache | ทุก hook ใน `src/data/db.ts` อยู่บน **swr** key = URL เต็ม → component ที่ขอ list เดียวกันใช้ request เดียว, เปิดหน้าซ้ำได้ข้อมูลทันที · re-fetch เมื่อเก่ากว่า TTL (master 5 นาที / อื่น ๆ 30 วิ), เมื่อหน้าเรียก `refetch()`, และ**หลังทุกการเขียนผ่าน `api()`** (`onApiWrite` → `invalidateLists`) · ไม่ refresh ตอนสลับแท็บ (ตัดสินใจแล้ว) | `src/data/db.ts`, `src/lib/api.ts` |
| Server cache | `cached(key, ttl, load)` ใน `src/server/cache.ts` — เก็บ *promise* (request พร้อมกัน 16 ตัวได้ query เดียว) ใช้กับ master list / staff / provinces / document profiles / vendor-shipper suggestions · write path เรียก `invalidate(prefix)` เสมอ → แก้แล้วเห็นทันที | `src/server/cache.ts` + services |
| User lookup | `resolveUser` cache แถว `app_user` ต่ออีเมล **10 วิ** (จาก 1 query ต่อ API call → 1 ต่อ 10 วิ) · approve/แก้/ลบผู้ใช้ เรียก `invalidateUserCache()` จึงยังมีผลทันที | `src/server/auth.ts` |
| ที่มีอยู่ก่อน | grants (`app_config`) 60 วิ · dashboard 30 วิ · symptom_stats / job_statuses 5 นาที | `auth.ts`, `services/jobs.ts` |
| รูปอัปโหลด | `optimizeImage()` (sharp): หมุนตาม EXIF, ด้านยาวสูงสุด 1600px, คุณภาพ 82 · jpg/webp คงฟอร์แมต · PNG ที่ทึบทั้งรูป (ภาพถ่ายที่เซฟเป็น PNG) → เป็น .jpg · PNG โปร่งใสคง PNG · PDF/โลโก้โปรไฟล์ไม่แตะ · รูปเก่าใน bucket ไม่ได้ย่อย้อนหลัง | `src/server/storage.ts`, `api/upload` |
| ค้นหา | ช่องค้นหาที่ยิง DB ทุกช่อง (DataTable โหมด server, customer-select, job-search) ส่งคำค้นเมื่อ **≥ 3 ตัวอักษร** (`SEARCH_MIN_CHARS` ใน `lib/utils.ts`) — GIN trigram ต้องมี 3 ตัวติดกัน ไม่งั้น Postgres ไล่ทั้งตาราง (วัดแล้ว 2 ตัว ≈ 400 ms, 3 ตัว ≈ 7 ms) · ทุก `page*()` รัน count + rows ด้วย `Promise.all` | `components/ui/data-table.tsx`, services |
| Bundle | modal ใหญ่ (`ProductDetailModal`, `CustomerCallModal`) โหลดผ่าน `next/dynamic` ตอนเปิดครั้งแรก · รูปในตาราง `loading="lazy"` · skeleton แถวใน `DataTable` + `(app)/loading.tsx` แทน spinner | pages / `components/ui` |

### ลำดับเริ่มต้นของรายการ (default sort)

กฎเดียว: **ใหม่สุด → เก่าสุด** สำหรับทุกตารางข้อมูล (งาน, ลูกค้า, ใบเสนอราคา, ใบสั่งขาย, สต๊อก, audit, รุ่นสินค้า, master ตัวเล็กในหน้าข้อมูลระบบ, ประวัติงาน/โทร) — ผู้ใช้กดหัวคอลัมน์เรียงทับได้ทุกตาราง

ข้อยกเว้นที่ตั้งใจ:
- **รายการอะไหล่** — `product_code` ASC · **ยี่ห้อสินค้า** — ชื่อ ก-ฮ/A-Z
- **ผู้ใช้ระบบ** — รออนุมัติ (ใหม่ก่อน) → ใช้งานอยู่ (ชื่อ ก-ฮ) → ระงับ/ไม่ใช้งาน (ชื่อ) · ทำที่ `listSystemUsers`
- **dropdown ในฟอร์ม** (หมวด/สี/ประเภท/อาการ/รุ่น/พนักงาน/จังหวัด/สถานะ) — คงลำดับ id / ชื่อ / `display_order` เหมือนระบบเก่า (เป็นตัวเลือก ไม่ใช่รายการ) — hook ใน `data/db.ts` กับ getter ใน `data/queries.ts` จึงเรียงต่างกันโดยตั้งใจ
- **บรรทัดในเอกสาร** (อะไหล่ในงาน, บรรทัดใบเสนอราคา/SO, บรรทัดเอกสารสต๊อก) — ตามลำดับที่กรอก ให้ตรงกับกระดาษ

หมายเหตุ: cache ทั้งหมดเป็น in-memory ของ instance เดียว (Render 1 instance) — ถ้า scale หลาย instance ต้องย้าย rate-limit + cache ไป Redis ก่อน

---

## โครงสร้างโปรเจกต์

```
src/
├── app/
│   ├── layout.tsx              # root layout + ThemeScript + ToastProvider
│   ├── globals.css             # design tokens (light/dark) + base styles
│   ├── (app)/                  # ทุกหน้าที่อยู่ใน AppShell (sidebar + topbar)
│   │   ├── admin/              # 1. ข้อมูลระบบ
│   │   ├── stock/              # 2. ข้อมูลอะไหล่
│   │   ├── customers/          # 3. ข้อมูลลูกค้า
│   │   ├── jobs/               # 4. ข้อมูลงานบริการ
│   │   ├── quotation/          # 5. ข้อมูลเสนอราคา
│   │   ├── sale/orders/        # 6. ข้อมูลใบสั่งขาย
│   │   └── reports/            # 7. รายงาน
│   └── logout/
├── components/
│   ├── ui/                     # primitives: Button, Input, Select, Card, Badge,
│   │                           # Tabs, Modal, Toast, Field, DataTable
│   ├── layout/                 # AppShell, Sidebar, Topbar, ThemeToggle,
│   │                           # SessionTimer, CommandPalette
│   └── shared/                 # PageHeader, Section, FilterBar, StatCard,
│                               # MasterTable, JobForm, QuotationForm,
│                               # SaleOrderForm, ReportView, Attachments
├── lib/                        # utils, nav, modules (permission map), api (fetch), use-access, use-job
├── data/
│   ├── db.ts                   # React hooks → /api/data/<resource> (server paging สำหรับตารางใหญ่)
│   ├── queries.ts              # server-component getters (master data)
│   └── mock.ts                 # TYPE + option list เท่านั้น (ไม่มีข้อมูลตัวอย่างแล้ว)
├── db/                         # drizzle client / schema / running number
├── server/                     # auth + permission, services (business logic), paging
└── app/api/**                  # route handlers (ทุกการเขียนตรวจสิทธิ์จาก app_config)
```

---

## หน้าจอทั้งหมด (42 routes)

**1. ข้อมูลระบบ** — ผู้ใช้ระบบ · สิทธิการใช้งาน (matrix เพิ่ม/แก้ไข/ลบ/ดู) · หมวดหมู่สินค้า · ยี่ห้อสินค้า · รุ่นสินค้า · สีสินค้า · ประเภทงานซ่อม · ประเภทเครื่องซ่อม · อาการเสียมาตรฐาน · โปรไฟล์ผู้ออกเอกสาร · ประวัติการใช้งาน · **คู่มือการใช้งาน** (`/admin/guide` — หน้าเดียวในกลุ่มนี้ที่ทุกคนเปิดได้ ผ่าน `EVERYONE_PATHS` ใน `lib/modules.ts` + ปุ่ม ? บน topbar · เนื้อหาอยู่ที่ `components/guide/content.tsx` กลุ่มที่ติด `adminOnly` เห็นเฉพาะ System Admin)

**2. ข้อมูลอะไหล่** — รายการอะไหล่ทั้งหมด (พร้อม KPI สต๊อก) · รับเข้าอะไหล่ · ตัดจ่ายอะไหล่ · ประวัติการเคลื่อนไหว

**3. ข้อมูลลูกค้า** — ทะเบียนลูกค้า + ฟอร์มเพิ่ม/แก้ไข

**4. ข้อมูลงานบริการ** — Dashboard (สถิติ 4 กลุ่ม + ตาราง TAT + กราฟรายเดือน + อาการเสียที่พบบ่อย) · รายการงานทั้งหมด · เปิดงานใหม่ · แก้ไขข้อมูลงาน · จนท.รับมอบหมายงาน · บันทึกงานซ่อม (ตารางอะไหล่เสนอราคา A/B) · บันทึกงานส่งซ่อมต่อ · บันทึกงาน Swap/Refund · ปิดงาน-ส่งคืนสินค้า

**5. ข้อมูลเสนอราคา** — รายการใบเสนอราคา · สร้าง · แก้ไข (คำนวณส่วนลด/VAT/ยอดสุทธิอัตโนมัติ)

**6. ข้อมูลใบสั่งขาย** — รายการใบสั่งขาย · สร้าง · แก้ไข

**7. รายงาน** — ภาพรวม + 7 รายงาน (เปิดงาน · การซ่อม · ปิดงาน · เสนอราคา · การขาย · เบิกจ่ายอะไหล่ · อะไหล่คงเหลือ)

---

## ฟีเจอร์ UI ที่เพิ่มจากระบบเดิม

- **Command Palette** — กด `Ctrl/⌘ + K` ค้นหาและกระโดดไปเมนูใดก็ได้
- **Sidebar ย่อได้** — จำสถานะไว้ใน localStorage
- **DataTable กลาง** — ค้นหา, เรียงลำดับทุกคอลัมน์, เลือกจำนวนต่อหน้า, แบ่งหน้า, empty state, ซ่อนคอลัมน์อัตโนมัติบนจอเล็ก
- **Toast** — แจ้งผลทุก action แทน `alert()`
- **Session Timer** — นับถอยหลัง 30 นาที ต่ออายุอัตโนมัติเมื่อมีการใช้งาน และเตือนเมื่อเหลือ < 5 นาที
- **Responsive เต็มรูปแบบ** — ใช้งานได้ตั้งแต่มือถือถึงจอ 4K

---

## โครงสร้าง API

- อ่าน: `GET /api/data/<resource>` (`jobs`, `customers`, `products`, `movements`, `quotations`, `sale_orders`, master ทุกตัว, `staff`, `roles`, `modules`, `dash_groups`, …) — ใส่ `?paged=1&page=&pageSize=&q=&sort=&dir=` สำหรับตารางใหญ่
- เขียน: `/api/jobs`, `/api/jobs/:no/{repair,outsource,swap-refund,close,calls}`, `/api/jobs/assign`, `/api/customers`, `/api/products`, `/api/stock/{receive,issue,pick-lines}`, `/api/quotations`, `/api/sale-orders/:no/approve`, `/api/masters/:kind`, `/api/admin/{users,permissions,records}`, `/api/attachments`
- ทุก route ตรวจ session (SSO cookie) และสิทธิ์ `app_config` ก่อนเขียน — ดู `src/server/auth.ts`

---

## ปรับแต่งธีม

แก้ CSS variables ที่ `src/app/globals.css` — เปลี่ยน `--primary` เพียงบรรทัดเดียว สีทั้งระบบจะเปลี่ยนตาม
(ทั้งโหมดสว่างและมืดกำหนดแยกกันในไฟล์เดียวกัน)
# shdservice

## UI kit (Tailwind v4 + shadcn/ui)

- **Tailwind CSS v4** — ไม่มี `tailwind.config.ts` แล้ว; token ทั้งหมดอยู่ใน `src/app/globals.css` (`@theme inline` map สี `--color-*` → ตัวแปร HSL เดิม `--background/--primary/…` จึงยังสลับ light/dark และ override ใน `.auth-page` ได้เหมือนเดิม) · dark mode = `@custom-variant dark (&:where(.dark, .dark *))`
- **สองชั้น**:
  - `src/components/shadcn/*` = ไฟล์ shadcn ต้นฉบับ (เพิ่มตัวใหม่ด้วย `npx shadcn add <name>` — `components.json` ชี้ `ui` มาที่โฟลเดอร์นี้) ใช้กับงานใหม่
  - `src/components/ui/*` = **app kit** ที่ทุกหน้าเรียกอยู่ — ชื่อ/props เดิมทั้งหมด แต่ข้างในเป็น shadcn/Radix แล้ว: `Modal`→Radix Dialog (focus-trap/Esc/scroll-lock), `Toast`→Sonner (API `useToast().push({kind,title,desc})` เดิม), `Tabs`→Radix Tabs (คีย์บอร์ด ←/→), `Checkbox`→Radix Checkbox (รับ `onChange(e.target.checked)` เดิม), `Button`/`Badge`→cva variants ชื่อเดิม (`primary/outline/…`, `tone`) · `CommandPalette` (⌘K) → cmdk
  - คงไว้ตามเดิมโดยตั้งใจ: `Select` เป็น native `<select>`, `Radio` native, `DataTable`, `Field/FieldGrid`, Sidebar/Topbar, ฟอร์มงาน, หน้า print
- `cn()` = `twMerge(clsx())` — class ที่ชนกันตัวหลังชนะ (เดิมขึ้นกับลำดับใน CSS) → ค่าที่หน้าเพจส่งมา เช่น `h-8`, `w-24`, `p-0` มีผลจริงแล้ว

## Audit trail (`audit_log`)

- ทุกการเขียนผ่านแอป (เพิ่ม/แก้/ลบ/เปลี่ยนสถานะ/อนุมัติ/มอบหมาย/จ่าย-รับสต๊อก/แนบไฟล์/เข้าสู่ระบบ) เรียก `audit(tx, userId, {...})` จาก `src/server/audit.ts` **ใน transaction เดียวกับข้อมูล** — log กับข้อมูลจึงไม่มีทางไม่ตรงกัน
- เก็บ ใคร (`user_id`, `user_name` snapshot) / เมื่อไร / `action` / `module` (ชื่อตาม app_config) / `entity` (ชื่อตาราง) / `entity_key` (เลขงาน, เลขใบ, รหัส) / `summary` ภาษาไทย / `changes` = เฉพาะฟิลด์ที่เปลี่ยน `{"field": [เดิม, ใหม่]}` (คำนวณด้วย `diff(before, values)`)
- ตารางเป็น append-only (trigger `audit_log_readonly`) · การแก้ผ่าน SQL ตรง ๆ ไม่ถูกบันทึก (ตามที่ตกลง)
- ดู: `ข้อมูลระบบ → ประวัติการใช้งาน` (System Admin, กรอง วันที่/ผู้ใช้/โมดูล/การกระทำ/เลขที่ + Excel) และส่วน "ประวัติการแก้ไข" ในหน้าแก้ไขข้อมูลงาน (`JobDetail.history`)
- เพิ่มจุดเขียนใหม่เมื่อไร ต้องเรียก `audit()` ด้วยเสมอ (ดูตัวอย่างใน `services/jobs.ts`)

