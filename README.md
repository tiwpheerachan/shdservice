# SHD Service System — Next.js UI

ระบบบริหารงานบริการ/งานซ่อม (Service Management System) ออกแบบใหม่ทั้งหมดด้วย **Next.js 15 App Router + TypeScript + Tailwind CSS**
เน้นความเสถียร ความเร็ว และ UI แบบ Modern Enterprise พร้อม **โหมดสว่าง / มืด / ตามระบบ**

---

## เริ่มใช้งาน

```bash
npm install
npm run dev      # http://localhost:3000
```

Build production:

```bash
npm run build
npm start
```

> ต้องใช้ Node.js 18.18+ (แนะนำ 20 LTS ขึ้นไป)

---

## สิ่งที่ให้ความสำคัญเรื่องความเสถียร

| หัวข้อ | รายละเอียด |
|---|---|
| Dependency | มีเพียง `next`, `react`, `react-dom`, `lucide-react` — **ไม่มี UI library ภายนอก** จึงไม่มี breaking change จาก third-party |
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
├── lib/                        # utils (cn, baht, int), nav config, useTheme
└── data/mock.ts                # ข้อมูลตัวอย่างทั้งหมด (จุดเดียวที่ต้องเปลี่ยนเป็น API)
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

## การต่อ API จริง

ทุกหน้าอ่านข้อมูลจาก `src/data/mock.ts` เพียงไฟล์เดียว
เปลี่ยนเป็นระบบจริงได้โดย:

1. สร้าง route handlers ใน `src/app/api/**/route.ts` (หรือชี้ไป backend เดิม)
2. แทน `import { JOBS } from "@/data/mock"` ด้วย `fetch` / Server Component / React Query
3. โครงสร้าง type ทั้งหมด (`Job`, `Product`, `Customer`, `Quotation`, `SaleOrder`, …) export อยู่แล้วใน `mock.ts` — ใช้เป็น API contract ได้ทันที

---

## ปรับแต่งธีม

แก้ CSS variables ที่ `src/app/globals.css` — เปลี่ยน `--primary` เพียงบรรทัดเดียว สีทั้งระบบจะเปลี่ยนตาม
(ทั้งโหมดสว่างและมืดกำหนดแยกกันในไฟล์เดียวกัน)
# shdservice
