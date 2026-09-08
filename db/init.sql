-- ==============================================================
-- OneService — สร้างฐานข้อมูลทั้งหมด (schema + ข้อมูลจริง)
-- วิธีใช้: เปิด Supabase Dashboard > SQL Editor > วางทั้งหมด > Run
-- ==============================================================

-- SHD Service System — schema
-- Column names are camelCase (quoted) to match the app's TypeScript types 1:1.
-- Read-only public app: RLS enabled, anon + authenticated may SELECT only.

create table if not exists "users" (
  "id" text primary key,
  "code" text, "name" text, "username" text, "role" text, "branch" text,
  "email" text, "phone" text, "lastLogin" text, "status" text,
  "avatar" text, "title" text
);
-- for existing installs: add the profile columns if they are missing
alter table "users" add column if not exists "avatar" text;
alter table "users" add column if not exists "title" text;

-- soft-delete flag for every list table (hidden by default, restorable from the
-- "รายการที่ลบ" view). Safe to re-run.
do $$
declare t text;
begin
  foreach t in array array[
    'users','jobs','quotations','sale_orders','customers','products','models',
    'movements','categories','manufacturers','colors','job_types',
    'product_types','symptoms','permissions'
  ] loop
    if to_regclass('"'||t||'"') is not null then
      execute format('alter table %I add column if not exists "deleted" boolean not null default false', t);
    end if;
  end loop;
end $$;

create table if not exists "permissions" (
  "id" text primary key,
  "role" text, "menu" text,
  "add" boolean, "edit" boolean, "del" boolean, "view" boolean
);

create table if not exists "categories" (
  "id" text primary key, "name" text, "detail" text, "status" text, "extra" text
);
create table if not exists "manufacturers" (
  "id" text primary key, "name" text, "detail" text, "status" text, "extra" text
);
create table if not exists "colors" (
  "id" text primary key, "name" text, "detail" text, "status" text, "extra" text
);
create table if not exists "job_types" (
  "id" text primary key, "name" text, "detail" text, "status" text, "extra" text
);
create table if not exists "product_types" (
  "id" text primary key, "name" text, "detail" text, "status" text, "extra" text
);
create table if not exists "symptoms" (
  "id" text primary key, "name" text, "detail" text, "group" text, "status" text, "extra" text
);

create table if not exists "models" (
  "code" text primary key, "name" text, "brand" text,
  "price" numeric, "updated" text, "status" text
);

create table if not exists "products" (
  "sysCode" text primary key, "mfgCode" text, "name" text,
  "category" text, "brand" text, "onhand" integer, "price" numeric, "status" text
);

create table if not exists "movements" (
  "doc" text primary key, "type" text, "ref" text, "date" text,
  "by" text, "from" text, "to" text, "remark" text
);

create table if not exists "customers" (
  "code" text primary key, "name" text, "address" text, "phone" text,
  "email" text, "line" text, "taxId" text, "status" text
);

create table if not exists "jobs" (
  "no" text primary key, "openDate" text, "customer" text, "so" text,
  "brandModel" text, "jobType" text, "owner" text, "status" text,
  "imei" text, "amount" numeric
);

create table if not exists "quotations" (
  "no" text primary key, "date" text, "type" text, "customer" text,
  "jobRef" text, "imei" text, "brandModel" text, "amount" numeric, "status" text
);

create table if not exists "sale_orders" (
  "no" text primary key, "date" text, "customer" text, "amount" numeric,
  "sales" text, "approve" text, "stockDoc" text, "tracking" text
);

-- dashboard / aggregate data (ord keeps display order stable)
create table if not exists "dash_groups" (
  "key" text primary key, "label" text, "sub" text,
  "jobs" integer, "percent" numeric, "tone" text, "ord" integer
);
create table if not exists "tat_rows" (
  "status" text primary key, "d13" integer, "d47" integer, "d814" integer,
  "d1530" integer, "over30" integer, "ord" integer
);
create table if not exists "monthly" (
  "m" text primary key, "open" integer, "close" integer, "ord" integer
);
create table if not exists "top_symptoms" (
  "name" text primary key, "count" integer, "ord" integer
);

-- ---- RLS: enable on every table, allow read-only for anon + authenticated ----
do $$
declare t text;
begin
  foreach t in array array[
    'users','permissions','categories','manufacturers','colors','job_types',
    'product_types','symptoms','models','products','movements','customers',
    'jobs','quotations','sale_orders','dash_groups','tat_rows','monthly','top_symptoms'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "public_read" on %I;', t);
    execute format(
      'create policy "public_read" on %I for select to anon, authenticated using (true);', t
    );
    -- ensure the Data API roles can reach the table (SELECT only)
    execute format('grant select on %I to anon, authenticated;', t);
  end loop;
end $$;

-- SEED DATA (mirrors src/data/mock.ts exactly)

insert into "users" ("id", "code", "name", "username", "role", "branch", "email", "phone", "lastLogin", "status") values
  ('U001', 'EMP-001', 'May - Pradit', 'may.p', 'System Admin', 'สำนักงานใหญ่', 'may@shd-technology.co.th', '081-234-5678', '2026-09-04 08:41', 'Active'),
  ('U002', 'EMP-002', 'Somchai Thongdee', 'somchai.t', 'Service Manager', 'สำนักงานใหญ่', 'somchai@shd-technology.co.th', '089-111-2233', '2026-09-04 09:02', 'Active'),
  ('U003', 'EMP-003', 'Nattapong K.', 'nattapong.k', 'ช่างเทคนิค', 'ศูนย์ซ่อม รังสิต', 'nattapong@shd-technology.co.th', '086-555-1212', '2026-09-03 17:20', 'Active'),
  ('U004', 'EMP-004', 'Kanokwan S.', 'kanokwan.s', 'เจ้าหน้าที่รับงาน', 'สำนักงานใหญ่', 'kanokwan@shd-technology.co.th', '092-777-8899', '2026-09-04 08:15', 'Active'),
  ('U005', 'EMP-005', 'Demo888', 'demo888', 'คลังอะไหล่', 'คลังกลาง', 'store@shd-technology.co.th', '094-222-3344', '2026-09-04 11:06', 'Active'),
  ('U006', 'EMP-006', 'Anucha P.', 'anucha.p', 'ช่างเทคนิค', 'ศูนย์ซ่อม บางนา', 'anucha@shd-technology.co.th', '083-909-1122', '2026-08-29 16:44', 'Inactive'),
  ('U007', 'EMP-007', 'Pimchanok W.', 'pimchanok.w', 'พนักงานขาย', 'สำนักงานใหญ่', 'pimchanok@shd-technology.co.th', '095-343-5566', '2026-09-04 10:30', 'Active')
on conflict do nothing;
insert into "permissions" ("id", "role", "menu", "add", "edit", "del", "view") values
  ('0-0', 'System Admin', 'ข้อมูลระบบ', true, true, true, true),
  ('0-1', 'System Admin', 'ข้อมูลอะไหล่', true, true, true, true),
  ('0-2', 'System Admin', 'ข้อมูลลูกค้า', true, true, true, true),
  ('0-3', 'System Admin', 'ข้อมูลงานบริการ', true, true, true, true),
  ('0-4', 'System Admin', 'ข้อมูลเสนอราคา', true, true, true, true),
  ('0-5', 'System Admin', 'ข้อมูลใบสั่งขาย', true, true, true, true),
  ('0-6', 'System Admin', 'รายงาน', true, true, true, true),
  ('1-0', 'Service Manager', 'ข้อมูลระบบ', true, true, false, true),
  ('1-1', 'Service Manager', 'ข้อมูลอะไหล่', true, false, true, true),
  ('1-2', 'Service Manager', 'ข้อมูลลูกค้า', false, false, false, true),
  ('1-3', 'Service Manager', 'ข้อมูลงานบริการ', false, true, false, true),
  ('1-4', 'Service Manager', 'ข้อมูลเสนอราคา', true, true, false, true),
  ('1-5', 'Service Manager', 'ข้อมูลใบสั่งขาย', true, true, false, true),
  ('1-6', 'Service Manager', 'รายงาน', true, false, true, true),
  ('2-0', 'ช่างเทคนิค', 'ข้อมูลระบบ', true, true, false, true),
  ('2-1', 'ช่างเทคนิค', 'ข้อมูลอะไหล่', true, true, false, true),
  ('2-2', 'ช่างเทคนิค', 'ข้อมูลลูกค้า', true, false, true, true),
  ('2-3', 'ช่างเทคนิค', 'ข้อมูลงานบริการ', false, false, false, true),
  ('2-4', 'ช่างเทคนิค', 'ข้อมูลเสนอราคา', false, true, false, true),
  ('2-5', 'ช่างเทคนิค', 'ข้อมูลใบสั่งขาย', true, true, false, true),
  ('2-6', 'ช่างเทคนิค', 'รายงาน', true, true, false, true),
  ('3-0', 'เจ้าหน้าที่รับงาน', 'ข้อมูลระบบ', false, true, false, true),
  ('3-1', 'เจ้าหน้าที่รับงาน', 'ข้อมูลอะไหล่', true, true, false, true),
  ('3-2', 'เจ้าหน้าที่รับงาน', 'ข้อมูลลูกค้า', true, true, false, true),
  ('3-3', 'เจ้าหน้าที่รับงาน', 'ข้อมูลงานบริการ', true, false, true, true),
  ('3-4', 'เจ้าหน้าที่รับงาน', 'ข้อมูลเสนอราคา', false, false, false, true),
  ('3-5', 'เจ้าหน้าที่รับงาน', 'ข้อมูลใบสั่งขาย', false, true, false, true),
  ('3-6', 'เจ้าหน้าที่รับงาน', 'รายงาน', true, true, false, true),
  ('4-0', 'คลังอะไหล่', 'ข้อมูลระบบ', false, false, false, true),
  ('4-1', 'คลังอะไหล่', 'ข้อมูลอะไหล่', false, true, false, true),
  ('4-2', 'คลังอะไหล่', 'ข้อมูลลูกค้า', true, true, false, true),
  ('4-3', 'คลังอะไหล่', 'ข้อมูลงานบริการ', true, true, false, true),
  ('4-4', 'คลังอะไหล่', 'ข้อมูลเสนอราคา', true, false, true, true),
  ('4-5', 'คลังอะไหล่', 'ข้อมูลใบสั่งขาย', false, false, false, true),
  ('4-6', 'คลังอะไหล่', 'รายงาน', false, true, false, true),
  ('5-0', 'พนักงานขาย', 'ข้อมูลระบบ', true, false, true, true),
  ('5-1', 'พนักงานขาย', 'ข้อมูลอะไหล่', false, false, false, true),
  ('5-2', 'พนักงานขาย', 'ข้อมูลลูกค้า', false, true, false, true),
  ('5-3', 'พนักงานขาย', 'ข้อมูลงานบริการ', true, true, false, true),
  ('5-4', 'พนักงานขาย', 'ข้อมูลเสนอราคา', true, true, false, true),
  ('5-5', 'พนักงานขาย', 'ข้อมูลใบสั่งขาย', true, false, true, true),
  ('5-6', 'พนักงานขาย', 'รายงาน', false, false, false, true)
on conflict do nothing;
insert into "categories" ("id", "name", "detail", "status") values
  ('CAT001', 'อะไหล่อิเล็กทรอนิกส์', 'แผงวงจร, IC, เซนเซอร์', 'Active'),
  ('CAT002', 'อะไหล่มอเตอร์', 'มอเตอร์ พัดลม ใบพัด', 'Active'),
  ('CAT003', 'รีโมทและอุปกรณ์ควบคุม', 'รีโมทคอนโทรล แผงปุ่มกด', 'Active'),
  ('CAT004', 'ไส้กรอง / Filter', 'HEPA, Carbon Filter', 'Active'),
  ('CAT005', 'อะไหล่โครงสร้าง', 'ฝาครอบ ขาตั้ง น็อต', 'Active'),
  ('CAT006', 'สายไฟและอะแดปเตอร์', 'สายไฟ AC, Adapter', 'Active'),
  ('CAT007', 'อุปกรณ์เสริม', 'กล่องบรรจุ คู่มือ', 'Inactive')
on conflict do nothing;
insert into "manufacturers" ("id", "name", "detail", "status") values
  ('BR001', 'Levoit.', '', 'Active'),
  ('BR002', 'Cosori', '', 'Active'),
  ('BR003', 'Etekcity', '', 'Active'),
  ('BR004', 'Vesync', '', 'Active'),
  ('BR005', 'Xiaomi', '', 'Active'),
  ('BR006', 'Philips', '', 'Active'),
  ('BR007', 'Sharp', '', 'Inactive')
on conflict do nothing;
insert into "models" ("code", "name", "brand", "price", "updated", "status") values
  ('LPF-R432-WEU', 'Pedestal Air Circulation Fan', 'Levoit.', 3990, '2026-08-28 14:20', 'Active'),
  ('Core300S', 'Core 300S Smart Air Purifier', 'Levoit.', 5490, '2026-08-22 10:05', 'Active'),
  ('Vital100S', 'Vital 100S Air Purifier', 'Levoit.', 6990, '2026-07-19 09:32', 'Active'),
  ('CAF-L501', 'Air Fryer Pro LE 5.5L', 'Cosori', 4290, '2026-08-30 16:48', 'Active'),
  ('CO-137-KUS', 'Air Fryer Max XL 5.5L', 'Cosori', 3890, '2026-06-11 11:11', 'Active'),
  ('ESF-00', 'Smart Body Scale', 'Etekcity', 1290, '2026-05-02 08:59', 'Inactive'),
  ('MJXFJ-300', 'Mi Air Purifier 4 Pro', 'Xiaomi', 8990, '2026-08-14 13:26', 'Active'),
  ('AC0830', 'Series 800 Air Purifier', 'Philips', 7490, '2026-08-05 15:03', 'Active')
on conflict do nothing;
insert into "colors" ("id", "name", "detail", "status") values
  ('CL001', 'ขาว (White)', '#FFFFFF', 'Active'),
  ('CL002', 'ดำ (Black)', '#111111', 'Active'),
  ('CL003', 'เทา (Gray)', '#8A8F98', 'Active'),
  ('CL004', 'เงิน (Silver)', '#C8CCD1', 'Active'),
  ('CL005', 'น้ำเงิน (Blue)', '#2563EB', 'Active'),
  ('CL006', 'แดง (Red)', '#DC2626', 'Inactive')
on conflict do nothing;
insert into "job_types" ("id", "name", "detail", "status") values
  ('JT001', 'ซ่อมในประกัน (In-Warranty)', 'ไม่มีค่าใช้จ่าย ภายใต้เงื่อนไขการรับประกัน', 'Active'),
  ('JT002', 'ซ่อมนอกประกัน (Out-Warranty)', 'คิดค่าอะไหล่และค่าบริการ', 'Active'),
  ('JT003', 'เปลี่ยนสินค้า (Swap)', 'เปลี่ยนเครื่องใหม่ให้ลูกค้า', 'Active'),
  ('JT004', 'คืนเงิน (Refund)', 'คืนเงินตามเงื่อนไข', 'Active'),
  ('JT005', 'ตรวจเช็คสภาพ', 'ตรวจสอบ / ทำความสะอาด', 'Active'),
  ('JT006', 'ส่งซ่อม Out-Source', 'ส่งซ่อมกับผู้ให้บริการภายนอก', 'Active')
on conflict do nothing;
insert into "product_types" ("id", "name", "detail", "status") values
  ('PT001', 'เครื่องฟอกอากาศ', 'Air Purifier', 'Active'),
  ('PT002', 'พัดลม', 'Fan / Air Circulator', 'Active'),
  ('PT003', 'หม้อทอดไร้น้ำมัน', 'Air Fryer', 'Active'),
  ('PT004', 'เครื่องชั่งน้ำหนัก', 'Smart Scale', 'Active'),
  ('PT005', 'เครื่องเพิ่มความชื้น', 'Humidifier', 'Active'),
  ('PT006', 'อุปกรณ์เสริม', 'Accessories', 'Inactive')
on conflict do nothing;
insert into "symptoms" ("id", "name", "detail", "group", "status") values
  ('SYM001', 'เปิดเครื่องไม่ติด', 'ไม่มีไฟเข้าเครื่อง / กดปุ่มไม่ตอบสนอง', 'ระบบไฟฟ้า', 'Active'),
  ('SYM002', 'มีเสียงดังผิดปกติ', 'เสียงจากมอเตอร์หรือใบพัด', 'มอเตอร์', 'Active'),
  ('SYM003', 'รีโมทไม่ทำงาน', 'สั่งงานผ่านรีโมทไม่ได้', 'อุปกรณ์ควบคุม', 'Active'),
  ('SYM004', 'จอแสดงผลไม่ติด', 'หน้าจอดับ / แสดงผลผิดปกติ', 'จอแสดงผล', 'Active'),
  ('SYM005', 'เชื่อมต่อ Wi-Fi ไม่ได้', 'จับคู่แอปพลิเคชันไม่สำเร็จ', 'ระบบเชื่อมต่อ', 'Active'),
  ('SYM006', 'ลมออกเบาผิดปกติ', 'แรงลมลดลงอย่างเห็นได้ชัด', 'ประสิทธิภาพ', 'Active'),
  ('SYM007', 'มีกลิ่นไหม้', 'กลิ่นไหม้จากตัวเครื่อง', 'ระบบไฟฟ้า', 'Active'),
  ('SYM008', 'ตัวเครื่องมีรอย/แตก', 'ความเสียหายทางกายภาพ', 'โครงสร้าง', 'Active')
on conflict do nothing;
insert into "products" ("sysCode", "mfgCode", "name", "category", "brand", "onhand", "price", "status") values
  ('P02534', 'HEAPCCLVNEU0001Y', 'อะไหล่-Levoit Pedestal Air Circulation Fan Remote Control-LPF-R432-WEU (รีโมทพัดลม)', 'รีโมทและอุปกรณ์ควบคุม', 'Levoit.', 3, 0, 'Active'),
  ('P02535', 'HEAPCCLVNEU0002Y', 'อะไหล่-Levoit Core300S Main Board (แผงวงจรหลัก)', 'อะไหล่อิเล็กทรอนิกส์', 'Levoit.', 12, 890, 'Active'),
  ('P02536', 'HEAPCCLVNEU0003Y', 'อะไหล่-Levoit Core300S HEPA Filter Replacement', 'ไส้กรอง / Filter', 'Levoit.', 48, 690, 'Active'),
  ('P02537', 'HEAPCCCOEU00011', 'อะไหล่-Cosori Air Fryer Heating Element 5.5L', 'อะไหล่อิเล็กทรอนิกส์', 'Cosori', 6, 1250, 'Active'),
  ('P02538', 'HEAPCCCOEU00012', 'อะไหล่-Cosori Air Fryer Basket 5.5L (ตะกร้าทอด)', 'อะไหล่โครงสร้าง', 'Cosori', 0, 950, 'Active'),
  ('P02539', 'HEAPCCLVNEU0004Y', 'อะไหล่-Levoit Fan DC Motor Assembly', 'อะไหล่มอเตอร์', 'Levoit.', 2, 1480, 'Active'),
  ('P02540', 'HEAPCCXMEU00001', 'อะไหล่-Xiaomi Air Purifier 4 Pro Filter', 'ไส้กรอง / Filter', 'Xiaomi', 24, 1090, 'Active'),
  ('P02541', 'HEAPCCPHEU00001', 'อะไหล่-Philips AC0830 Power Adapter', 'สายไฟและอะแดปเตอร์', 'Philips', 9, 420, 'Active'),
  ('P02542', 'HEAPCCETEU00001', 'อะไหล่-Etekcity Smart Scale Load Cell', 'อะไหล่อิเล็กทรอนิกส์', 'Etekcity', 1, 320, 'Inactive'),
  ('P02543', 'HEAPCCLVNEU0005Y', 'อะไหล่-Levoit Vital100S Control Panel', 'รีโมทและอุปกรณ์ควบคุม', 'Levoit.', 7, 760, 'Active')
on conflict do nothing;
insert into "movements" ("doc", "type", "ref", "date", "by", "from", "to", "remark") values
  ('WHO2602139', 'จ่ายออกตามใบสั่งขาย', 'SO2600727', '2026-09-04 11:06', 'Demo888', 'คลังกลาง', 'ลูกค้า', ''),
  ('WHI2601884', 'รับเข้าจากผู้ผลิต', 'PO2600455', '2026-09-03 15:22', 'Demo888', 'Supplier', 'คลังกลาง', 'Lot 2026-Q3'),
  ('WHO2602138', 'เบิกใช้งานซ่อม', 'JOB2604412', '2026-09-03 10:48', 'Nattapong K.', 'คลังกลาง', 'ศูนย์ซ่อม รังสิต', 'เปลี่ยนบอร์ดหลัก'),
  ('WHT2600311', 'โอนย้ายคลัง', 'TR2600088', '2026-09-02 09:15', 'Demo888', 'คลังกลาง', 'ศูนย์ซ่อม บางนา', 'เติมสต๊อกสาขา'),
  ('WHO2602137', 'เบิกใช้งานซ่อม', 'JOB2604398', '2026-09-01 14:02', 'Anucha P.', 'ศูนย์ซ่อม บางนา', 'งานซ่อม', ''),
  ('WHI2601883', 'รับคืนจากงานซ่อม', 'JOB2604370', '2026-08-31 16:40', 'Nattapong K.', 'งานซ่อม', 'คลังกลาง', 'อะไหล่ไม่ได้ใช้')
on conflict do nothing;
insert into "customers" ("code", "name", "address", "phone", "email", "line", "taxId", "status") values
  ('C0010234', 'คุณ สมหญิง ใจดี', '88/12 ถ.รัชดาภิเษก แขวงดินแดง เขตดินแดง กรุงเทพฯ 10400', '081-555-0123', 'somying@example.com', 'somying_j', '1100200334455', 'Active'),
  ('C0010235', 'บริษัท เอ็นทีวี อิเล็กทรอนิกส์ จำกัด', '199 หมู่ 5 ถ.บางนา-ตราด กม.19 ต.บางโฉลง อ.บางพลี สมุทรปราการ 10540', '02-751-8800', 'purchase@ntv-elec.co.th', '-', '0105558001234', 'Active'),
  ('C0010236', 'คุณ วีรยุทธ ศรีสุข', '45/7 ซ.ลาดพร้าว 71 แขวงลาดพร้าว เขตลาดพร้าว กรุงเทพฯ 10230', '089-234-7788', 'weerayut.s@example.com', 'wee_ss', '3100900112233', 'Active'),
  ('C0010237', 'คุณ ปวีณา ทองแท้', '12 ถ.นิมมานเหมินท์ ต.สุเทพ อ.เมือง เชียงใหม่ 50200', '086-919-2020', 'paweena.t@example.com', 'pw_gold', '1509900556677', 'Active'),
  ('C0010238', 'ห้างหุ้นส่วนจำกัด ซันไรส์ เซอร์วิส', '77/3 ถ.มิตรภาพ ต.ในเมือง อ.เมือง ขอนแก่น 40000', '043-333-111', 'info@sunrise-service.co.th', '-', '0403556009988', 'Inactive'),
  ('C0010239', 'คุณ ธนกฤต พงษ์ไพศาล', '301 คอนโด เดอะ ริเวอร์ ถ.เจริญนคร แขวงคลองต้นไทร เขตคลองสาน กรุงเทพฯ 10600', '094-808-6611', 'thanakrit.p@example.com', 'tkp88', '1102700998877', 'Active')
on conflict do nothing;
insert into "jobs" ("no", "openDate", "customer", "so", "brandModel", "jobType", "owner", "status", "imei", "amount") values
  ('JOB2604460', '2026-09-28 08:00', 'คุณ สมหญิง ใจดี', 'SO2600700', 'Levoit. LPF-R432-WEU', 'ซ่อมในประกัน (In-Warranty)', 'Nattapong K.', 'งานใหม่', '35982340000000', 0),
  ('JOB2604459', '2026-09-27 09:07', 'บริษัท เอ็นทีวี อิเล็กทรอนิกส์ จำกัด', 'SO2600701', 'Levoit. Core300S', 'ซ่อมนอกประกัน (Out-Warranty)', 'Anucha P.', 'อยู่ระหว่างดำเนินการ', '35982340000137', 690),
  ('JOB2604458', '2026-09-26 10:14', 'คุณ วีรยุทธ ศรีสุข', 'SO2600702', 'Levoit. Vital100S', 'เปลี่ยนสินค้า (Swap)', 'Somchai Thongdee', 'รออะไหล่', '35982340000274', 1250),
  ('JOB2604457', '2026-09-25 11:21', 'คุณ ปวีณา ทองแท้', 'SO2600703', 'Cosori CAF-L501', 'ตรวจเช็คสภาพ', '- ยังไม่ระบุ -', 'รอลูกค้าตอบกลับ', '35982340000411', 890),
  ('JOB2604456', '2026-09-24 12:28', 'ห้างหุ้นส่วนจำกัด ซันไรส์ เซอร์วิส', 'SO2600704', 'Cosori CO-137-KUS', 'ซ่อมในประกัน (In-Warranty)', 'Nattapong K.', 'ส่งซ่อม Out-Source', '35982340000548', 1480),
  ('JOB2604455', '2026-09-23 13:35', 'คุณ ธนกฤต พงษ์ไพศาล', 'SO2600705', 'Etekcity ESF-00', 'ซ่อมนอกประกัน (Out-Warranty)', 'Anucha P.', 'ซ่อมเสร็จ', '35982340000685', 2340),
  ('JOB2604454', '2026-09-22 14:42', 'คุณ สมหญิง ใจดี', 'SO2600706', 'Xiaomi MJXFJ-300', 'เปลี่ยนสินค้า (Swap)', 'Somchai Thongdee', 'ปิดงาน', '35982340000822', 420),
  ('JOB2604453', '2026-09-21 15:49', 'บริษัท เอ็นทีวี อิเล็กทรอนิกส์ จำกัด', 'SO2600707', 'Philips AC0830', 'ตรวจเช็คสภาพ', '- ยังไม่ระบุ -', 'งานใหม่', '35982340000959', 0),
  ('JOB2604452', '2026-09-20 16:56', 'คุณ วีรยุทธ ศรีสุข', 'SO2600708', 'Levoit. LPF-R432-WEU', 'ซ่อมในประกัน (In-Warranty)', 'Nattapong K.', 'อยู่ระหว่างดำเนินการ', '35982340001096', 690),
  ('JOB2604451', '2026-09-19 08:03', 'คุณ ปวีณา ทองแท้', 'SO2600709', 'Levoit. Core300S', 'ซ่อมนอกประกัน (Out-Warranty)', 'Anucha P.', 'รออะไหล่', '35982340001233', 1250),
  ('JOB2604450', '2026-09-18 09:10', 'ห้างหุ้นส่วนจำกัด ซันไรส์ เซอร์วิส', 'SO2600710', 'Levoit. Vital100S', 'เปลี่ยนสินค้า (Swap)', 'Somchai Thongdee', 'รอลูกค้าตอบกลับ', '35982340001370', 890),
  ('JOB2604449', '2026-09-17 10:17', 'คุณ ธนกฤต พงษ์ไพศาล', 'SO2600711', 'Cosori CAF-L501', 'ตรวจเช็คสภาพ', '- ยังไม่ระบุ -', 'ส่งซ่อม Out-Source', '35982340001507', 1480),
  ('JOB2604448', '2026-09-16 11:24', 'คุณ สมหญิง ใจดี', 'SO2600712', 'Cosori CO-137-KUS', 'ซ่อมในประกัน (In-Warranty)', 'Nattapong K.', 'ซ่อมเสร็จ', '35982340001644', 2340),
  ('JOB2604447', '2026-09-15 12:31', 'บริษัท เอ็นทีวี อิเล็กทรอนิกส์ จำกัด', 'SO2600713', 'Etekcity ESF-00', 'ซ่อมนอกประกัน (Out-Warranty)', 'Anucha P.', 'ปิดงาน', '35982340001781', 420),
  ('JOB2604446', '2026-09-14 13:38', 'คุณ วีรยุทธ ศรีสุข', 'SO2600714', 'Xiaomi MJXFJ-300', 'เปลี่ยนสินค้า (Swap)', 'Somchai Thongdee', 'งานใหม่', '35982340001918', 0),
  ('JOB2604445', '2026-09-13 14:45', 'คุณ ปวีณา ทองแท้', 'SO2600715', 'Philips AC0830', 'ตรวจเช็คสภาพ', '- ยังไม่ระบุ -', 'อยู่ระหว่างดำเนินการ', '35982340002055', 690),
  ('JOB2604444', '2026-09-12 15:52', 'ห้างหุ้นส่วนจำกัด ซันไรส์ เซอร์วิส', 'SO2600716', 'Levoit. LPF-R432-WEU', 'ซ่อมในประกัน (In-Warranty)', 'Nattapong K.', 'รออะไหล่', '35982340002192', 1250),
  ('JOB2604443', '2026-09-11 16:59', 'คุณ ธนกฤต พงษ์ไพศาล', 'SO2600717', 'Levoit. Core300S', 'ซ่อมนอกประกัน (Out-Warranty)', 'Anucha P.', 'รอลูกค้าตอบกลับ', '35982340002329', 890),
  ('JOB2604442', '2026-09-10 08:06', 'คุณ สมหญิง ใจดี', 'SO2600718', 'Levoit. Vital100S', 'เปลี่ยนสินค้า (Swap)', 'Somchai Thongdee', 'ส่งซ่อม Out-Source', '35982340002466', 1480),
  ('JOB2604441', '2026-09-09 09:13', 'บริษัท เอ็นทีวี อิเล็กทรอนิกส์ จำกัด', 'SO2600719', 'Cosori CAF-L501', 'ตรวจเช็คสภาพ', '- ยังไม่ระบุ -', 'ซ่อมเสร็จ', '35982340002603', 2340),
  ('JOB2604440', '2026-08-08 10:20', 'คุณ วีรยุทธ ศรีสุข', 'SO2600720', 'Cosori CO-137-KUS', 'ซ่อมในประกัน (In-Warranty)', 'Nattapong K.', 'ปิดงาน', '35982340002740', 420),
  ('JOB2604439', '2026-08-07 11:27', 'คุณ ปวีณา ทองแท้', 'SO2600721', 'Etekcity ESF-00', 'ซ่อมนอกประกัน (Out-Warranty)', 'Anucha P.', 'งานใหม่', '35982340002877', 0),
  ('JOB2604438', '2026-08-06 12:34', 'ห้างหุ้นส่วนจำกัด ซันไรส์ เซอร์วิส', 'SO2600722', 'Xiaomi MJXFJ-300', 'เปลี่ยนสินค้า (Swap)', 'Somchai Thongdee', 'อยู่ระหว่างดำเนินการ', '35982340003014', 690),
  ('JOB2604437', '2026-08-05 13:41', 'คุณ ธนกฤต พงษ์ไพศาล', 'SO2600723', 'Philips AC0830', 'ตรวจเช็คสภาพ', '- ยังไม่ระบุ -', 'รออะไหล่', '35982340003151', 1250),
  ('JOB2604436', '2026-08-04 14:48', 'คุณ สมหญิง ใจดี', 'SO2600724', 'Levoit. LPF-R432-WEU', 'ซ่อมในประกัน (In-Warranty)', 'Nattapong K.', 'รอลูกค้าตอบกลับ', '35982340003288', 890),
  ('JOB2604435', '2026-08-03 15:55', 'บริษัท เอ็นทีวี อิเล็กทรอนิกส์ จำกัด', 'SO2600725', 'Levoit. Core300S', 'ซ่อมนอกประกัน (Out-Warranty)', 'Anucha P.', 'ส่งซ่อม Out-Source', '35982340003425', 1480),
  ('JOB2604434', '2026-08-02 16:02', 'คุณ วีรยุทธ ศรีสุข', 'SO2600726', 'Levoit. Vital100S', 'เปลี่ยนสินค้า (Swap)', 'Somchai Thongdee', 'ซ่อมเสร็จ', '35982340003562', 2340),
  ('JOB2604433', '2026-08-01 08:09', 'คุณ ปวีณา ทองแท้', 'SO2600727', 'Cosori CAF-L501', 'ตรวจเช็คสภาพ', '- ยังไม่ระบุ -', 'ปิดงาน', '35982340003699', 420),
  ('JOB2604432', '2026-08-28 09:16', 'ห้างหุ้นส่วนจำกัด ซันไรส์ เซอร์วิส', 'SO2600728', 'Cosori CO-137-KUS', 'ซ่อมในประกัน (In-Warranty)', 'Nattapong K.', 'งานใหม่', '35982340003836', 0),
  ('JOB2604431', '2026-08-27 10:23', 'คุณ ธนกฤต พงษ์ไพศาล', 'SO2600729', 'Etekcity ESF-00', 'ซ่อมนอกประกัน (Out-Warranty)', 'Anucha P.', 'อยู่ระหว่างดำเนินการ', '35982340003973', 690),
  ('JOB2604430', '2026-08-26 11:30', 'คุณ สมหญิง ใจดี', 'SO2600730', 'Xiaomi MJXFJ-300', 'เปลี่ยนสินค้า (Swap)', 'Somchai Thongdee', 'รออะไหล่', '35982340004110', 1250),
  ('JOB2604429', '2026-08-25 12:37', 'บริษัท เอ็นทีวี อิเล็กทรอนิกส์ จำกัด', 'SO2600731', 'Philips AC0830', 'ตรวจเช็คสภาพ', '- ยังไม่ระบุ -', 'รอลูกค้าตอบกลับ', '35982340004247', 890),
  ('JOB2604428', '2026-08-24 13:44', 'คุณ วีรยุทธ ศรีสุข', 'SO2600732', 'Levoit. LPF-R432-WEU', 'ซ่อมในประกัน (In-Warranty)', 'Nattapong K.', 'ส่งซ่อม Out-Source', '35982340004384', 1480),
  ('JOB2604427', '2026-08-23 14:51', 'คุณ ปวีณา ทองแท้', 'SO2600733', 'Levoit. Core300S', 'ซ่อมนอกประกัน (Out-Warranty)', 'Anucha P.', 'ซ่อมเสร็จ', '35982340004521', 2340),
  ('JOB2604426', '2026-08-22 15:58', 'ห้างหุ้นส่วนจำกัด ซันไรส์ เซอร์วิส', 'SO2600734', 'Levoit. Vital100S', 'เปลี่ยนสินค้า (Swap)', 'Somchai Thongdee', 'ปิดงาน', '35982340004658', 420),
  ('JOB2604425', '2026-08-21 16:05', 'คุณ ธนกฤต พงษ์ไพศาล', 'SO2600735', 'Cosori CAF-L501', 'ตรวจเช็คสภาพ', '- ยังไม่ระบุ -', 'งานใหม่', '35982340004795', 0),
  ('JOB2604424', '2026-08-20 08:12', 'คุณ สมหญิง ใจดี', 'SO2600736', 'Cosori CO-137-KUS', 'ซ่อมในประกัน (In-Warranty)', 'Nattapong K.', 'อยู่ระหว่างดำเนินการ', '35982340004932', 690),
  ('JOB2604423', '2026-08-19 09:19', 'บริษัท เอ็นทีวี อิเล็กทรอนิกส์ จำกัด', 'SO2600737', 'Etekcity ESF-00', 'ซ่อมนอกประกัน (Out-Warranty)', 'Anucha P.', 'รออะไหล่', '35982340005069', 1250),
  ('JOB2604422', '2026-08-18 10:26', 'คุณ วีรยุทธ ศรีสุข', 'SO2600738', 'Xiaomi MJXFJ-300', 'เปลี่ยนสินค้า (Swap)', 'Somchai Thongdee', 'รอลูกค้าตอบกลับ', '35982340005206', 890),
  ('JOB2604421', '2026-08-17 11:33', 'คุณ ปวีณา ทองแท้', 'SO2600739', 'Philips AC0830', 'ตรวจเช็คสภาพ', '- ยังไม่ระบุ -', 'ส่งซ่อม Out-Source', '35982340005343', 1480),
  ('JOB2604420', '2026-08-16 12:40', 'ห้างหุ้นส่วนจำกัด ซันไรส์ เซอร์วิส', 'SO2600740', 'Levoit. LPF-R432-WEU', 'ซ่อมในประกัน (In-Warranty)', 'Nattapong K.', 'ซ่อมเสร็จ', '35982340005480', 2340),
  ('JOB2604419', '2026-08-15 13:47', 'คุณ ธนกฤต พงษ์ไพศาล', 'SO2600741', 'Levoit. Core300S', 'ซ่อมนอกประกัน (Out-Warranty)', 'Anucha P.', 'ปิดงาน', '35982340005617', 420),
  ('JOB2604418', '2026-08-14 14:54', 'คุณ สมหญิง ใจดี', 'SO2600742', 'Levoit. Vital100S', 'เปลี่ยนสินค้า (Swap)', 'Somchai Thongdee', 'งานใหม่', '35982340005754', 0),
  ('JOB2604417', '2026-08-13 15:01', 'บริษัท เอ็นทีวี อิเล็กทรอนิกส์ จำกัด', 'SO2600743', 'Cosori CAF-L501', 'ตรวจเช็คสภาพ', '- ยังไม่ระบุ -', 'อยู่ระหว่างดำเนินการ', '35982340005891', 690),
  ('JOB2604416', '2026-08-12 16:08', 'คุณ วีรยุทธ ศรีสุข', 'SO2600744', 'Cosori CO-137-KUS', 'ซ่อมในประกัน (In-Warranty)', 'Nattapong K.', 'รออะไหล่', '35982340006028', 1250),
  ('JOB2604415', '2026-08-11 08:15', 'คุณ ปวีณา ทองแท้', 'SO2600745', 'Etekcity ESF-00', 'ซ่อมนอกประกัน (Out-Warranty)', 'Anucha P.', 'รอลูกค้าตอบกลับ', '35982340006165', 890)
on conflict do nothing;
insert into "quotations" ("no", "date", "type", "customer", "jobRef", "imei", "brandModel", "amount", "status") values
  ('QT2601200', '2026-09-01', 'Type B (VIP)', 'คุณ สมหญิง ใจดี', 'JOB2604460', '35982340000000', 'Levoit. LPF-R432-WEU', 1290, 'รอเสนอราคา'),
  ('QT2601201', '2026-08-04', 'Type A (Normal)', 'บริษัท เอ็นทีวี อิเล็กทรอนิกส์ จำกัด', 'JOB2604459', '35982340000137', 'Levoit. Core300S', 2450, 'เสนอราคาแล้ว'),
  ('QT2601202', '2026-09-07', 'Type A (Normal)', 'คุณ วีรยุทธ ศรีสุข', 'JOB2604458', '35982340000274', 'Levoit. Vital100S', 890, 'ลูกค้าอนุมัติ'),
  ('QT2601203', '2026-08-10', 'Type B (VIP)', 'คุณ ปวีณา ทองแท้', 'JOB2604457', '35982340000411', 'Cosori CAF-L501', 3680, 'ลูกค้าไม่อนุมัติ'),
  ('QT2601204', '2026-09-13', 'Type A (Normal)', 'ห้างหุ้นส่วนจำกัด ซันไรส์ เซอร์วิส', 'JOB2604456', '35982340000548', 'Cosori CO-137-KUS', 760, 'ยกเลิก'),
  ('QT2601205', '2026-08-16', 'Type A (Normal)', 'คุณ ธนกฤต พงษ์ไพศาล', 'JOB2604455', '35982340000685', 'Etekcity ESF-00', 5420, 'รอเสนอราคา'),
  ('QT2601206', '2026-09-19', 'Type B (VIP)', 'คุณ สมหญิง ใจดี', 'JOB2604454', '35982340000822', 'Xiaomi MJXFJ-300', 1980, 'เสนอราคาแล้ว'),
  ('QT2601207', '2026-08-22', 'Type A (Normal)', 'บริษัท เอ็นทีวี อิเล็กทรอนิกส์ จำกัด', 'JOB2604453', '35982340000959', 'Philips AC0830', 1290, 'ลูกค้าอนุมัติ'),
  ('QT2601208', '2026-09-25', 'Type A (Normal)', 'คุณ วีรยุทธ ศรีสุข', 'JOB2604452', '35982340001096', 'Levoit. LPF-R432-WEU', 2450, 'ลูกค้าไม่อนุมัติ'),
  ('QT2601209', '2026-08-01', 'Type B (VIP)', 'คุณ ปวีณา ทองแท้', 'JOB2604451', '35982340001233', 'Levoit. Core300S', 890, 'ยกเลิก'),
  ('QT2601210', '2026-09-04', 'Type A (Normal)', 'ห้างหุ้นส่วนจำกัด ซันไรส์ เซอร์วิส', 'JOB2604450', '35982340001370', 'Levoit. Vital100S', 3680, 'รอเสนอราคา'),
  ('QT2601211', '2026-08-07', 'Type A (Normal)', 'คุณ ธนกฤต พงษ์ไพศาล', 'JOB2604449', '35982340001507', 'Cosori CAF-L501', 760, 'เสนอราคาแล้ว'),
  ('QT2601212', '2026-09-10', 'Type B (VIP)', 'คุณ สมหญิง ใจดี', 'JOB2604448', '35982340001644', 'Cosori CO-137-KUS', 5420, 'ลูกค้าอนุมัติ'),
  ('QT2601213', '2026-08-13', 'Type A (Normal)', 'บริษัท เอ็นทีวี อิเล็กทรอนิกส์ จำกัด', 'JOB2604447', '35982340001781', 'Etekcity ESF-00', 1980, 'ลูกค้าไม่อนุมัติ'),
  ('QT2601214', '2026-09-16', 'Type A (Normal)', 'คุณ วีรยุทธ ศรีสุข', 'JOB2604446', '35982340001918', 'Xiaomi MJXFJ-300', 1290, 'ยกเลิก'),
  ('QT2601215', '2026-08-19', 'Type B (VIP)', 'คุณ ปวีณา ทองแท้', 'JOB2604445', '35982340002055', 'Philips AC0830', 2450, 'รอเสนอราคา'),
  ('QT2601216', '2026-09-22', 'Type A (Normal)', 'ห้างหุ้นส่วนจำกัด ซันไรส์ เซอร์วิส', 'JOB2604444', '35982340002192', 'Levoit. LPF-R432-WEU', 890, 'เสนอราคาแล้ว'),
  ('QT2601217', '2026-08-25', 'Type A (Normal)', 'คุณ ธนกฤต พงษ์ไพศาล', 'JOB2604443', '35982340002329', 'Levoit. Core300S', 3680, 'ลูกค้าอนุมัติ'),
  ('QT2601218', '2026-09-01', 'Type B (VIP)', 'คุณ สมหญิง ใจดี', 'JOB2604442', '35982340002466', 'Levoit. Vital100S', 760, 'ลูกค้าไม่อนุมัติ'),
  ('QT2601219', '2026-08-04', 'Type A (Normal)', 'บริษัท เอ็นทีวี อิเล็กทรอนิกส์ จำกัด', 'JOB2604441', '35982340002603', 'Cosori CAF-L501', 5420, 'ยกเลิก'),
  ('QT2601220', '2026-09-07', 'Type A (Normal)', 'คุณ วีรยุทธ ศรีสุข', 'JOB2604440', '35982340002740', 'Cosori CO-137-KUS', 1980, 'รอเสนอราคา'),
  ('QT2601221', '2026-08-10', 'Type B (VIP)', 'คุณ ปวีณา ทองแท้', 'JOB2604439', '35982340002877', 'Etekcity ESF-00', 1290, 'เสนอราคาแล้ว')
on conflict do nothing;
insert into "sale_orders" ("no", "date", "customer", "amount", "sales", "approve", "stockDoc", "tracking") values
  ('SO2600727', '2026-09-01', 'คุณ สมหญิง ใจดี', 1290, 'Pimchanok W.', 'รออนุมัติ', '', 'TH0123456700'),
  ('SO2600726', '2026-08-06', 'บริษัท เอ็นทีวี อิเล็กทรอนิกส์ จำกัด', 690, 'May - Pradit', 'อนุมัติ', 'WHO2602138', ''),
  ('SO2600725', '2026-09-11', 'คุณ วีรยุทธ ศรีสุข', 2450, 'Somchai Thongdee', 'ไม่อนุมัติ', '', ''),
  ('SO2600724', '2026-08-16', 'คุณ ปวีณา ทองแท้', 3980, 'Pimchanok W.', 'กำลังดำเนินการจัดทำ', '', 'TH0123456703'),
  ('SO2600723', '2026-09-21', 'ห้างหุ้นส่วนจำกัด ซันไรส์ เซอร์วิส', 890, 'May - Pradit', 'รออนุมัติ', '', ''),
  ('SO2600722', '2026-08-26', 'คุณ ธนกฤต พงษ์ไพศาล', 1480, 'Somchai Thongdee', 'อนุมัติ', 'WHO2602134', ''),
  ('SO2600721', '2026-09-04', 'คุณ สมหญิง ใจดี', 5420, 'Pimchanok W.', 'ไม่อนุมัติ', '', 'TH0123456706'),
  ('SO2600720', '2026-08-09', 'บริษัท เอ็นทีวี อิเล็กทรอนิกส์ จำกัด', 1290, 'May - Pradit', 'กำลังดำเนินการจัดทำ', '', ''),
  ('SO2600719', '2026-09-14', 'คุณ วีรยุทธ ศรีสุข', 690, 'Somchai Thongdee', 'รออนุมัติ', '', ''),
  ('SO2600718', '2026-08-19', 'คุณ ปวีณา ทองแท้', 2450, 'Pimchanok W.', 'อนุมัติ', 'WHO2602130', 'TH0123456709'),
  ('SO2600717', '2026-09-24', 'ห้างหุ้นส่วนจำกัด ซันไรส์ เซอร์วิส', 3980, 'May - Pradit', 'ไม่อนุมัติ', '', ''),
  ('SO2600716', '2026-08-02', 'คุณ ธนกฤต พงษ์ไพศาล', 890, 'Somchai Thongdee', 'กำลังดำเนินการจัดทำ', '', ''),
  ('SO2600715', '2026-09-07', 'คุณ สมหญิง ใจดี', 1480, 'Pimchanok W.', 'รออนุมัติ', '', 'TH0123456712'),
  ('SO2600714', '2026-08-12', 'บริษัท เอ็นทีวี อิเล็กทรอนิกส์ จำกัด', 5420, 'May - Pradit', 'อนุมัติ', 'WHO2602126', ''),
  ('SO2600713', '2026-09-17', 'คุณ วีรยุทธ ศรีสุข', 1290, 'Somchai Thongdee', 'ไม่อนุมัติ', '', ''),
  ('SO2600712', '2026-08-22', 'คุณ ปวีณา ทองแท้', 690, 'Pimchanok W.', 'กำลังดำเนินการจัดทำ', '', 'TH0123456715'),
  ('SO2600711', '2026-09-27', 'ห้างหุ้นส่วนจำกัด ซันไรส์ เซอร์วิส', 2450, 'May - Pradit', 'รออนุมัติ', '', ''),
  ('SO2600710', '2026-08-05', 'คุณ ธนกฤต พงษ์ไพศาล', 3980, 'Somchai Thongdee', 'อนุมัติ', 'WHO2602122', '')
on conflict do nothing;
insert into "dash_groups" ("key", "label", "sub", "jobs", "percent", "tone", "ord") values
  ('pending', 'Pending Group', 'Pending Status', 777, 1.65, 'warning', 0),
  ('repaired', 'Repaired Group', 'Repaired Status', 1299, 2.76, 'info', 1),
  ('finished', 'Finished Group', 'Finished Status', 44987, 95.59, 'success', 2),
  ('total', 'Total', 'Total Status', 47063, 100, 'primary', 3)
on conflict do nothing;
insert into "tat_rows" ("status", "d13", "d47", "d814", "d1530", "over30", "ord") values
  ('งานใหม่', 84, 6, 4, 5, 52, 0),
  ('อยู่ระหว่างดำเนินการ', 4, 1, 0, 6, 1, 1),
  ('รออะไหล่', 2, 8, 12, 9, 21, 2),
  ('รอลูกค้าตอบกลับ', 11, 14, 6, 3, 18, 3),
  ('ส่งซ่อม Out-Source', 1, 5, 9, 12, 7, 4),
  ('ซ่อมเสร็จ รอส่งคืน', 43, 27, 11, 4, 2, 5)
on conflict do nothing;
insert into "monthly" ("m", "open", "close", "ord") values
  ('เม.ย.', 312, 298, 0),
  ('พ.ค.', 344, 331, 1),
  ('มิ.ย.', 289, 305, 2),
  ('ก.ค.', 401, 372, 3),
  ('ส.ค.', 378, 389, 4),
  ('ก.ย.', 151, 96, 5)
on conflict do nothing;
insert into "top_symptoms" ("name", "count", "ord") values
  ('เปิดเครื่องไม่ติด', 412, 0),
  ('รีโมทไม่ทำงาน', 287, 1),
  ('มีเสียงดังผิดปกติ', 231, 2),
  ('เชื่อมต่อ Wi-Fi ไม่ได้', 176, 3),
  ('ลมออกเบาผิดปกติ', 143, 4)
on conflict do nothing;

