/**
 * Company block printed on documents (ใบรับงาน / ใบส่งคืน / ใบเสนอราคา / ใบสั่งขาย).
 * Fill in the real address / tax id when available — one place to edit.
 */
export const COMPANY = {
  nameTh: "บริษัท เอสเอชดี เทคโนโลยี จำกัด",
  nameEn: "SHD Technology Co., Ltd.",
  // as printed on the legacy quotation (setupdata/receipt/Q2600468_163754.pdf)
  address: "อาคารไอซีเอส ชั้น 7 เลขที่ 112 ถนนเจริญนคร แขวงคลองต้นไทร เขตคลองสาน กรุงเทพมหานคร 10600",
  /** same address broken the way the legacy shipping label prints it */
  addressLines: ["อาคารไอซีเอส ชั้น 7 เลขที่ 112 ถนนเจริญนคร แขวงคลองต้นไทร", "เขตคลองสาน กรุงเทพมหานคร 10600"],
  phone: "02-100-4578",
  email: "",
  taxId: "", // TODO: real 13-digit tax id (legacy printed xxxxxxxxxxxxx)
  website: "sso.shd-technology.co.th",
  logo: "/logo.png",
  /** SHD logomark only (from setupdata/logo/SHD-02-01) — documents print the name/address as text next to it */
  logoMark: "/logo-shd-mark.png",
  /** bank account printed under "รายละเอียดการโอนเงิน" on quotations */
  bank: {
    name: "ธ.ไทยพาณิชย์ จำกัด (มหาชน)",
    accountType: "บัญชีออมทรัพย์",
    accountNo: "", // TODO: real account no (legacy printed XXXXXXX)
    accountName: "",
  },
};

/** Quotation validity as printed ("กำหนดยืนยันราคา / Validity date"). */
export const QUOTATION_VALIDITY = "7 Days";

/** Standing text on the repair intake slip. */
export const REPAIR_TERMS = [
  "บริษัทฯ จะแจ้งผลการตรวจเช็คและค่าใช้จ่าย (ถ้ามี) ให้ลูกค้าทราบก่อนดำเนินการซ่อมทุกครั้ง",
  "กรณีลูกค้าไม่ตกลงซ่อม บริษัทฯ ขอสงวนสิทธิ์คิดค่าตรวจเช็คตามอัตราที่กำหนด",
  "กรุณาติดต่อรับสินค้าคืนภายใน 30 วันนับจากวันที่ได้รับแจ้ง มิฉะนั้นบริษัทฯ จะไม่รับผิดชอบต่อความเสียหายหรือสูญหาย",
  "โปรดนำใบรับงานนี้มาแสดงทุกครั้งเมื่อติดต่อรับสินค้า",
];

/** Standing text on the return note (ใบส่งคืนสินค้า). */
export const RETURN_TERMS = [
  "รับประกันงานซ่อมและอะไหล่ที่เปลี่ยน 90 วันนับจากวันที่ส่งคืน (ไม่รวมความเสียหายจากการใช้งานผิดวิธี)",
  "โปรดตรวจสอบสินค้าเมื่อได้รับ และนำใบส่งคืนนี้มาแสดงทุกครั้งเมื่อติดต่อเรื่องการรับประกันงานซ่อม",
];

/** Standing text on quotations. */
export const QUOTATION_TERMS = [
  "ราคานี้ยืนราคา 7 วันนับจากวันที่เสนอราคา",
  "ระยะเวลาดำเนินการซ่อมประมาณ 3–7 วันทำการหลังจากลูกค้ายืนยัน (ขึ้นกับอะไหล่)",
  "รับประกันงานซ่อมและอะไหล่ที่เปลี่ยน 90 วัน (ไม่รวมความเสียหายจากการใช้งานผิดวิธี)",
];
