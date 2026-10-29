/**
 * Fallback company identity for the customer-facing pages (login, /track) when no default
 * document profile can be read — the real identity is the default profile admins edit
 * (ข้อมูลผู้ออกเอกสาร). Documents print their own profile.
 */
export const COMPANY = {
  nameTh: 'บริษัท เอสเอชดี เทคโนโลยี จำกัด',
  nameEn: 'SHD Technology Co., Ltd.',
  // as printed on the legacy quotation (setupdata/receipt/Q2600468_163754.pdf)
  address: 'อาคารไอซีเอส ชั้น 7 เลขที่ 112 ถนนเจริญนคร แขวงคลองต้นไทร เขตคลองสาน กรุงเทพมหานคร 10600',
  phone: '02-100-4578',
  /** SHD logomark only (from setupdata/logo/SHD-02-01) — the built-in profile logo */
  logoUrl: '/logo-shd-mark.png',
};

/** Quotation validity in days ("กำหนดยืนยันราคา / Validity date" on the print; the expiry rule). */
export const QUOTE_VALID_DAYS = 7;

/** Standing text on the repair intake slip (`strong` = printed bold: the customer must see it before signing). */
export const REPAIR_TERMS: { text: string; strong?: boolean }[] = [
  { text: 'บริษัทฯ จะแจ้งผลการตรวจเช็คและค่าใช้จ่าย (ถ้ามี) ให้ลูกค้าทราบก่อนดำเนินการซ่อมทุกครั้ง' },
  { text: 'กรณีลูกค้าไม่ตกลงซ่อม บริษัทฯ ขอสงวนสิทธิ์คิดค่าตรวจเช็คตามอัตราที่กำหนด' },
  {
    text: 'กรุณาติดต่อรับสินค้าคืนภายใน 30 วันนับจากวันที่ได้รับแจ้ง มิฉะนั้นบริษัทฯ จะไม่รับผิดชอบต่อความเสียหายหรือสูญหาย',
  },
  { text: 'โปรดนำใบรับงานนี้มาแสดงทุกครั้งเมื่อติดต่อรับสินค้า' },
  // owner 2026-10-28
  {
    text: 'ก่อนส่งเครื่องเข้ารับบริการ กรุณาสำรองข้อมูลสำคัญไว้ทุกครั้ง เนื่องจากการซ่อมแซมหรือรีเซ็ตเครื่องอาจทำให้ข้อมูลสูญหาย โดยบริษัทฯ ขอสงวนสิทธิ์ไม่รับผิดชอบต่อการสูญหายของข้อมูลดังกล่าว',
    strong: true,
  },
];

/** Standing text on the return note (ใบส่งคืนสินค้า). */
export const RETURN_TERMS = [
  'รับประกันงานซ่อมและอะไหล่ที่เปลี่ยน 90 วันนับจากวันที่ส่งคืน (ไม่รวมความเสียหายจากการใช้งานผิดวิธี)',
  'โปรดตรวจสอบสินค้าเมื่อได้รับ และนำใบส่งคืนนี้มาแสดงทุกครั้งเมื่อติดต่อเรื่องการรับประกันงานซ่อม',
];
