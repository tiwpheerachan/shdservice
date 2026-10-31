/** fixed option lists that mirror the legacy lookup values exactly (DB-master lists are read at runtime) */
/** TAT age buckets (TatRow keys) — dashboard column headers, worded as the legacy table + the job list's
 *  "from the dashboard" note */
export const TAT_BUCKET_LABEL = {
  d13: '1-3 Days',
  d47: '4-7 Days',
  d814: '8-14 Days',
  d1530: '15-30 Days',
  over30: 'Over 30 Days',
} as const;

/* บทบาท = app_user.user_type ของระบบเดิม (รายการจริงดึงจาก role_permission ผ่าน useRoles) */
export const ROLES: [string, ...string[]] = [
  'System Admin',
  'Customer Service',
  'Engineer',
  'Head Engineer',
  'Stock',
  'Salesman',
  'Manager',
  'Account',
  'Audit',
  'Call Center',
  'รออนุมัติ',
];

export const JOB_TYPE_OPTIONS = [
  'งานซ่อม',
  'งานส่งต่อศูนย์บริการ',
  'งานเปลี่ยนสินค้าใหม่',
  'งานคืนสินค้า',
  'งานส่งสินค้าเพิ่มเติม',
  'งานคืนเงินลูกค้า',
  'ยังไม่สามารถระบุได้',
  'ข้อพิพาท',
  'ไม่มีข้อมูล',
  'ของหมด',
];

export const JOB_STATUS_OPTIONS = [
  'งานใหม่',
  'ยกเลิกข้อมูล',
  'อยู่ระหว่างดำเนินการ',
  'อยู่ระหว่างการซ่อม - ส่งซ่อม Out-Source แล้ว',
  'อยู่ระหว่างการซ่อม - รับคืนจาก Out-Source แล้ว',
  'อยู่ระหว่างการซ่อม - เริ่มเบิกอะไหล่',
  'อยู่ระหว่างการซ่อม - เบิกจ่ายอะไหล่ครบแล้ว',
  'อยู่ระหว่างการซ่อม - รออะไหล่',
  'อยู่ระหว่างการซ่อม - รอเสนอราคา',
  'อยู่ระหว่างการซ่อม - เสนอราคาลูกค้า',
  'อยู่ระหว่างการซ่อม - ลูกค้าตกลงซ่อม',
  'อยู่ระหว่างการซ่อม - พ้นกำหนดเสนอราคา',
  'อยู่ระหว่างดำเนินการ - รับคืนเข้าสต๊อกแล้ว',
  'ยกเลิกซ่อม (ลูกค้าไม่ตกลงซ่อม)',
  'อยู่ระหว่างดำเนินการ - เบิกสินค้าใหม่แล้ว',
  'อยู่ระหว่างดำเนินการ - เบิกจ่ายเงินแล้ว',
  'ซ่อมเสร็จ',
  'ซ่อมเสร็จ (ชำระเงินแล้ว)',
  'ซ่อมเสร็จ (ไม่พบอาการเสีย ขอส่งคืน)',
  'ปิดงาน-ส่งคืนสินค้า (รอลงเลขที่พัสดุ)',
  'ปิดงาน-ส่งคืนสินค้า (ลงเลขที่พัสดุแล้ว)',
  'ปิดงาน-รอลูกค้ามารับที่ศูนย์บริการ',
  'ปิดงาน (Complete)',
];

export const REPAIR_STATUS_OPTIONS = [
  'อยู่ระหว่างดำเนินการ',
  'อยู่ระหว่างการซ่อม - เริ่มเบิกอะไหล่',
  'อยู่ระหว่างการซ่อม - เบิกจ่ายอะไหล่ครบแล้ว',
  'อยู่ระหว่างการซ่อม - รออะไหล่',
  'อยู่ระหว่างการซ่อม - รอเสนอราคา',
  'อยู่ระหว่างการซ่อม - เสนอราคาลูกค้า',
  'อยู่ระหว่างการซ่อม - ลูกค้าตกลงซ่อม',
  'อยู่ระหว่างการซ่อม - พ้นกำหนดเสนอราคา',
  'ยกเลิกซ่อม (ลูกค้าไม่ตกลงซ่อม)',
  'ซ่อมเสร็จ',
  'ซ่อมเสร็จ (ชำระเงินแล้ว)',
  'ซ่อมเสร็จ (ไม่พบอาการเสีย ขอส่งคืน)',
];

export const CLOSE_STATUS_OPTIONS = [
  'ปิดงาน-ส่งคืนสินค้า (รอลงเลขที่พัสดุ)',
  'ปิดงาน-ส่งคืนสินค้า (ลงเลขที่พัสดุแล้ว)',
  'ปิดงาน-รอลูกค้ามารับที่ศูนย์บริการ',
  'ปิดงาน (Complete)',
];

export const QUOTATION_STATUS_OPTIONS: [string, ...string[]] = [
  'รอเสนอราคา',
  'เสนอราคาแล้ว',
  'ลูกค้าตกลงซ่อม',
  'ลูกค้าไม่ตกลงซ่อม',
  'ยกเลิกใบเสนอราคา',
  'ลูกค้าตกลงซ่อม รอชำระเงิน',
  'พ้นกำหนดเสนอราคา',
  'ลูกค้าตกลงซ่อม รออะไหล่',
];

export const CHANNELS = [
  'ยังไม่ระบุ',
  'หน้าร้าน', // walk-in: no sale order (WALK_IN_CHANNEL)
  'ตัวแทนจำหน่าย',
  'FACEBOOK',
  'LAZADA',
  'NOC NOC',
  'LINE OA',
  'SHOPEE',
  'TIKTOK',
  'YOUTUBE',
  'WEBSITE',
];

export const WARRANTY_OPTIONS = ['IN', 'OUT'];
export const RECEIVE_METHODS: [string, ...string[]] = ['Walk-In', 'Carry-In', 'Onsite', 'ไม่ระบุ'];

export const RETURN_METHODS = ['ลูกค้ามารับเอง', 'ส่งไปรษณีย์', 'บริษัทขนส่งเอกชน', 'พนักงานจัดส่ง', 'ไม่ต้องส่งคืน'];

/* วิธีชำระเงินของใบสั่งขาย (= sale_order.payment_type) — COD = ยังไม่มีสลิป ยอดชำระไม่บังคับ (เหมือนระบบเดิม) */
export const PAYMENT_METHODS: [string, ...string[]] = ['โอนเงิน', 'เงินสด', 'บัตรเครดิต', 'เก็บเงินปลายทาง (COD)'];
/* วิธีชำระเงินตอนปิดงาน — job.job_payment_type ของระบบเดิมใช้ "เงินโอน" / "เงินสด" */
export const JOB_PAYMENT_METHODS: [string, ...string[]] = ['เงินโอน', 'เงินสด', 'บัตรเครดิต'];

export const STOCK_MOVE_TYPES = [
  'รับเข้า',
  'รับคืนจากการเบิก',
  'จ่ายออกตามงานซ่อม',
  'จ่ายออกตามใบสั่งขาย',
  'จ่ายออกอื่นๆ',
];
export const STOCK_PICK_TYPES = [
  'จ่ายออกตามงานซ่อม',
  'จ่ายออกตามใบสั่งขาย',
  'จ่ายออกอื่นๆ',
  'รับคืนจากการเบิก', // stock_move_type 2 — คืนอะไหล่ที่จ่ายไปแล้วกลับเข้าคลัง
];

export const CUSTOMER_TYPES = ['Dealer', 'Corporate', 'Normal'];
/* ใช้กลุ่มราคา — DB เก็บ Retail / Wholesale / Special (map ใน services/customers.ts) */
export const PRICE_GROUPS: [string, ...string[]] = [
  'ขายปลีก (Retail Price)',
  'ขายส่ง (Wholesale Price)',
  'ราคาพิเศษ (Special Price)',
];
