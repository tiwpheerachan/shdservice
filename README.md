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
| Dependency | UI: `next`, `react`, `react-dom`, `lucide-react` — **ไม่มี UI library ภายนอก** · ข้อมูล: `drizzle-orm` + `pg` (server เท่านั้น) · `@supabase/supabase-js` ใช้เฉพาะ Storage |
| Version | ตรึงเวอร์ชันแบบ exact (ไม่มี `^`) ทุกตัว — `npm install` ได้ผลลัพธ์เดิมเสมอ |
| Type Safety | TypeScript `strict: true` ผ่าน `next build` โดยไม่มี error |
| Dark mode | สคริปต์ inline ใน `<head>` ตั้ง class ก่อน paint → **ไม่มีจอกระพริบ (FOUC)** |
| Layout stability | `scrollbar-gutter: stable`, ตารางมี `overflow-x` เฉพาะตัวเอง, sidebar ใช้ CSS transition → ไม่มี layout shift |
| Accessibility | `focus-visible` ring ทุก control, `aria-*` ครบ, ปิด Modal/Palette ด้วย `Esc`, keyboard navigation |
| Print | มี `@media print` และคลาส `.no-print` สำหรับพิมพ์รายงาน/ใบส่งคืน |

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

**1. ข้อมูลระบบ** — ผู้ใช้ระบบ · สิทธิการใช้งาน (matrix เพิ่ม/แก้ไข/ลบ/ดู) · หมวดหมู่สินค้า · ยี่ห้อสินค้า · รุ่นสินค้า · สีสินค้า · ประเภทงานซ่อม · ประเภทเครื่องซ่อม · อาการเสียมาตรฐาน

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
