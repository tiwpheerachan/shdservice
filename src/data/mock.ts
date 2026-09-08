// Types + static UI config for the SHD Service System.
//
// All business data now lives in Supabase and is read through the hooks in
// `@/data/db` (client components) or the getters in `@/data/queries`
// (server components). This file keeps only:
//   1. the TypeScript types used across the app (the API contract), and
//   2. static dropdown/option config that is UI-only, not database data.

export type Status = "Active" | "Inactive" | "Cancel";

export type MasterRow = {
  id: string;
  name: string;
  detail: string;
  status: Status;
  extra?: string;
};

export type User = {
  id: string;
  code: string;
  name: string;
  username: string;
  role: string;
  branch: string;
  email: string;
  phone: string;
  lastLogin: string;
  status: Status;
  avatar?: string | null;
  title?: string | null;
};

export type Permission = {
  id: string;
  role: string;
  menu: string;
  add: boolean;
  edit: boolean;
  del: boolean;
  view: boolean;
};

export type Model = {
  code: string;
  name: string;
  brand: string;
  price: number;
  updated: string;
  status: Status;
};

export type Symptom = MasterRow & { group: string };

export type Product = {
  sysCode: string;
  mfgCode: string;
  name: string;
  category: string;
  brand: string;
  onhand: number;
  price: number;
  status: Status;
};

export type Movement = {
  doc: string;
  type: string;
  ref: string;
  date: string;
  by: string;
  from: string;
  to: string;
  remark: string;
};

export type Customer = {
  code: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  line: string;
  taxId: string;
  status: Status;
};

export type Job = {
  no: string;
  openDate: string;
  customer: string;
  so: string;
  brandModel: string;
  jobType: string;
  owner: string;
  status: string;
  imei: string;
  amount: number;
};

export type Quotation = {
  no: string;
  date: string;
  type: "Type A (Normal)" | "Type B (VIP)";
  customer: string;
  jobRef: string;
  imei: string;
  brandModel: string;
  amount: number;
  status: string;
};

export type SaleOrder = {
  no: string;
  date: string;
  customer: string;
  amount: number;
  sales: string;
  approve: string;
  stockDoc: string;
  tracking: string;
};

/* ---------- Dashboard aggregate rows ---------- */

export type StatTone = "primary" | "warning" | "info" | "success" | "danger";

export type DashGroup = {
  key: string;
  label: string;
  sub: string;
  jobs: number;
  percent: number;
  tone: StatTone;
};

export type TatRow = {
  status: string;
  d13: number;
  d47: number;
  d814: number;
  d1530: number;
  over30: number;
};

export type MonthlyRow = { m: string; open: number; close: number };

export type TopSymptom = { name: string; count: number };

/* ---------- Static UI config (not database data) ---------- */

export const ROLES = [
  "System Admin",
  "Service Manager",
  "ช่างเทคนิค",
  "เจ้าหน้าที่รับงาน",
  "คลังอะไหล่",
  "พนักงานขาย",
  "รออนุมัติ",
];

/* ประเภทงาน (10) — ตรงกับระบบจริง */
export const JOB_TYPE_OPTIONS = [
  "งานซ่อม",
  "งานส่งต่อศูนย์บริการ",
  "งานเปลี่ยนสินค้าใหม่",
  "งานคืนสินค้า",
  "งานส่งสินค้าเพิ่มเติม",
  "งานคืนเงินลูกค้า",
  "ยังไม่สามารถระบุได้",
  "ข้อพิพาท",
  "ไม่มีข้อมูล",
  "ของหมด",
];

/* สถานะงานทั้งหมด (จากระบบจริง) */
export const JOB_STATUS_OPTIONS = [
  "งานใหม่",
  "ยกเลิกข้อมูล",
  "อยู่ระหว่างดำเนินการ",
  "อยู่ระหว่างการซ่อม - ส่งซ่อม Out-Source แล้ว",
  "อยู่ระหว่างการซ่อม - รับคืนจาก Out-Source แล้ว",
  "อยู่ระหว่างการซ่อม - เริ่มเบิกอะไหล่",
  "อยู่ระหว่างการซ่อม - เบิกจ่ายอะไหล่ครบแล้ว",
  "อยู่ระหว่างการซ่อม - รออะไหล่",
  "อยู่ระหว่างการซ่อม - รอเสนอราคา",
  "อยู่ระหว่างการซ่อม - เสนอราคาลูกค้า",
  "อยู่ระหว่างการซ่อม - ลูกค้าตกลงซ่อม",
  "อยู่ระหว่างการซ่อม - พ้นกำหนดเสนอราคา",
  "อยู่ระหว่างดำเนินการ - รับคืนเข้าสต๊อกแล้ว",
  "ยกเลิกซ่อม (ลูกค้าไม่ตกลงซ่อม)",
  "อยู่ระหว่างดำเนินการ - เบิกสินค้าใหม่แล้ว",
  "อยู่ระหว่างดำเนินการ - เบิกจ่ายเงินแล้ว",
  "ซ่อมเสร็จ",
  "ซ่อมเสร็จ (ชำระเงินแล้ว)",
  "ซ่อมเสร็จ (ไม่พบอาการเสีย ขอส่งคืน)",
  "ปิดงาน-ส่งคืนสินค้า (รอลงเลขที่พัสดุ)",
  "ปิดงาน-ส่งคืนสินค้า (ลงเลขที่พัสดุแล้ว)",
  "ปิดงาน-รอลูกค้ามารับที่ศูนย์บริการ",
  "ปิดงาน (Complete)",
];

/* สถานะช่วง "บันทึกงานซ่อม" (12) */
export const REPAIR_STATUS_OPTIONS = [
  "อยู่ระหว่างดำเนินการ",
  "อยู่ระหว่างการซ่อม - เริ่มเบิกอะไหล่",
  "อยู่ระหว่างการซ่อม - เบิกจ่ายอะไหล่ครบแล้ว",
  "อยู่ระหว่างการซ่อม - รออะไหล่",
  "อยู่ระหว่างการซ่อม - รอเสนอราคา",
  "อยู่ระหว่างการซ่อม - เสนอราคาลูกค้า",
  "อยู่ระหว่างการซ่อม - ลูกค้าตกลงซ่อม",
  "อยู่ระหว่างการซ่อม - พ้นกำหนดเสนอราคา",
  "ยกเลิกซ่อม (ลูกค้าไม่ตกลงซ่อม)",
  "ซ่อมเสร็จ",
  "ซ่อมเสร็จ (ชำระเงินแล้ว)",
  "ซ่อมเสร็จ (ไม่พบอาการเสีย ขอส่งคืน)",
];

/* สถานะช่วง "ปิดงาน-ส่งคืน" (4) */
export const CLOSE_STATUS_OPTIONS = [
  "ปิดงาน-ส่งคืนสินค้า (รอลงเลขที่พัสดุ)",
  "ปิดงาน-ส่งคืนสินค้า (ลงเลขที่พัสดุแล้ว)",
  "ปิดงาน-รอลูกค้ามารับที่ศูนย์บริการ",
  "ปิดงาน (Complete)",
];

/* สถานะใบเสนอราคา (8) */
export const QUOTATION_STATUS_OPTIONS = [
  "รอเสนอราคา",
  "เสนอราคาแล้ว",
  "ลูกค้าตกลงซ่อม",
  "ลูกค้าไม่ตกลงซ่อม",
  "ยกเลิกใบเสนอราคา",
  "ลูกค้าตกลงซ่อม รอชำระเงิน",
  "พ้นกำหนดเสนอราคา",
  "ลูกค้าตกลงซ่อม รออะไหล่",
];

/* สถานะอนุมัติใบสั่งขาย */
export const SALE_APPROVE_OPTIONS = [
  "รออนุมัติ",
  "อนุมัติ",
  "ไม่อนุมัติ",
  "กำลังดำเนินการจัดทำ",
];

/* Sale Channel (ช่องทางขาย) — ตรงกับระบบจริง */
export const CHANNELS = [
  "ยังไม่ระบุ",
  "ตัวแทนจำหน่าย",
  "FACEBOOK",
  "LAZADA",
  "NOC NOC",
  "LINE OA",
  "SHOPEE",
  "TIKTOK",
  "YOUTUBE",
  "WEBSITE",
];

export const WARRANTY_OPTIONS = ["IN", "OUT"];
export const RECEIVE_METHODS = ["Walk-In", "Carry-In", "Onsite", "ไม่ระบุ"];
export const COURIERS = ["Kerry Express", "Flash Express", "J&T Express", "ไปรษณีย์ไทย", "DHL", "อื่นๆ"];

/* วิธีการส่งคืนสินค้า (5) */
export const RETURN_METHODS = [
  "ลูกค้ามารับเอง",
  "ส่งไปรษณีย์",
  "บริษัทขนส่งเอกชน",
  "พนักงานจัดส่ง",
  "ไม่ต้องส่งคืน",
];

/* วิธีชำระเงิน (3) */
export const PAYMENT_METHODS = ["เงินสด", "เงินโอน", "บัตรเครดิต"];

/* ค่าบริการการซ่อม (ค่าคงที่ให้เลือก) */
export const SERVICE_FEES = [0, 98, 100, 200, 300, 350, 400, 450, 500, 550, 1000];

/* คลังสินค้า */
export const WAREHOUSES = ["คลังสินค้าดี", "คลังสินค้าเสีย"];

/* ประเภทเอกสารสต๊อก */
export const STOCK_MOVE_TYPES = [
  "รับเข้า",
  "รับคืนจากการเบิก",
  "จ่ายออกตามงานซ่อม",
  "จ่ายออกตามใบสั่งขาย",
  "จ่ายออกอื่นๆ",
];
export const STOCK_RECEIVE_TYPES = ["รับเข้า", "รับคืนจากการเบิก"];
export const STOCK_PICK_TYPES = [
  "จ่ายออกตามงานซ่อม",
  "จ่ายออกตามใบสั่งขาย",
  "จ่ายออกอื่นๆ",
];

/* หมวดหมู่อะไหล่ (ตรงกับระบบจริง) */
export const PART_CATEGORIES = [
  "จอ",
  "ด้ามจับ",
  "บอดี้",
  "แบตเตอรี่",
  "มอเตอร์ดูดฝุ่น",
  "มอเตอร์หัวแปรง",
  "เมนบอร์ด",
  "อแดปเตอร์",
  "อะไหล่เกรดบี",
  "ยังไม่ระบุ",
];

/* ลูกค้า */
export const CUSTOMER_TYPES = ["Dealer", "Corporate", "Normal"];
export const PRICE_GROUPS = [
  "ขายปลีก (Retail Price)",
  "ขายส่ง (Wholesale Price)",
  "ราคาพิเศษ (Special Price)",
];

/* ส่วนลด & ภาษี (หน้าเสนอราคา) */
export const DISCOUNT_TYPES = [
  "ไม่มีส่วนลด",
  "ส่วนลดรวม",
  "ส่วนลดค่าบริการ",
  "ส่วนลดค่าอะไหล่",
];
export const DISCOUNT_UNITS = ["บาท", "%"];
export const VAT_RATES = [0, 7];

/* Serial Control */
export const SERIAL_CONTROL = ["True", "False"];

export const TECHNICIANS = ["- - ยังไม่ระบุ - -", "Nattapong K.", "Anucha P.", "Somchai Thongdee"];
export const OUTSOURCE_VENDORS = ["Vesync Service Center", "TG Electronics Repair", "Siam Tech Service", "OEM Factory (CN)"];

/* 77 จังหวัด (สำหรับ dropdown ที่อยู่แบบ cascading) */
export const PROVINCES = [
  "กรุงเทพมหานคร", "กระบี่", "กาญจนบุรี", "กาฬสินธุ์", "กำแพงเพชร",
  "ขอนแก่น", "จันทบุรี", "ฉะเชิงเทรา", "ชลบุรี", "ชัยนาท",
  "ชัยภูมิ", "ชุมพร", "เชียงราย", "เชียงใหม่", "ตรัง",
  "ตราด", "ตาก", "นครนายก", "นครปฐม", "นครพนม",
  "นครราชสีมา", "นครศรีธรรมราช", "นครสวรรค์", "นนทบุรี", "นราธิวาส",
  "น่าน", "บึงกาฬ", "บุรีรัมย์", "ปทุมธานี", "ประจวบคีรีขันธ์",
  "ปราจีนบุรี", "ปัตตานี", "พระนครศรีอยุธยา", "พะเยา", "พังงา",
  "พัทลุง", "พิจิตร", "พิษณุโลก", "เพชรบุรี", "เพชรบูรณ์",
  "แพร่", "ภูเก็ต", "มหาสารคาม", "มุกดาหาร", "แม่ฮ่องสอน",
  "ยโสธร", "ยะลา", "ร้อยเอ็ด", "ระนอง", "ระยอง",
  "ราชบุรี", "ลพบุรี", "ลำปาง", "ลำพูน", "เลย",
  "ศรีสะเกษ", "สกลนคร", "สงขลา", "สตูล", "สมุทรปราการ",
  "สมุทรสงคราม", "สมุทรสาคร", "สระแก้ว", "สระบุรี", "สิงห์บุรี",
  "สุโขทัย", "สุพรรณบุรี", "สุราษฎร์ธานี", "สุรินทร์", "หนองคาย",
  "หนองบัวลำภู", "อ่างทอง", "อำนาจเจริญ", "อุดรธานี", "อุตรดิตถ์",
  "อุทัยธานี", "อุบลราชธานี",
];
