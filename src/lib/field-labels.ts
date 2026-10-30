import { MODULE_LABELS, RIGHTS } from '@/lib/modules';
import { JOB_COLUMN_LABEL } from '@/lib/validation/job';

/**
 * Column names as the audit log stores them (audit_log.changes keys) → their Thai name: the job's
 * (ประวัติการแก้ไข) plus every other entity the log records. Shared by the job history, the audit
 * log page and its Excel; a key not listed shows as it is.
 */
export const FIELD_LABEL: Record<string, string> = {
  ...JOB_COLUMN_LABEL,
  ...MODULE_LABELS, // role_permission: one key per permission row (a menu or a right)
  ...RIGHTS,
  lines: 'รายการ',
  recordStatus: 'สถานะรายการ',
  isActive: 'เปิดใช้งาน',
  deletedAt: 'ลบเมื่อ',
  updatedAt: 'แก้ไขล่าสุด',
  sortOrder: 'ลำดับ',
  code: 'รหัส',
  description: 'รายละเอียด',
  email: 'อีเมล',
  phone: 'เบอร์โทรศัพท์',
  taxId: 'เลขประจำตัวผู้เสียภาษี',
  nameTh: 'ชื่อ (ไทย)',
  nameEn: 'ชื่อ (อังกฤษ)',
  // ผู้ใช้ระบบ
  firstName: 'ชื่อ',
  lastName: 'นามสกุล',
  username: 'Username',
  emailAddress: 'อีเมล',
  userType: 'ประเภทผู้ใช้งาน / สิทธิ์',
  department: 'สาขา / หน่วยงาน',
  phoneNo: 'เบอร์โทรศัพท์',
  larkId: 'รหัสพนักงาน / Lark ID',
  title: 'ตำแหน่ง',
  avatar: 'รูปโปรไฟล์',
  // ข้อมูลหลัก
  categoryName: 'ชื่อหมวดหมู่',
  categoryDescription: 'รายละเอียด',
  colorName: 'ชื่อสี',
  jobTypeName: 'ชื่อประเภทงาน',
  jobTypeDescription: 'รายละเอียด',
  defaultDueDays: 'SLA (วัน)',
  manufacturerName: 'ชื่อยี่ห้อ', // legacy log rows (before drizzle/0006)
  brandName: 'ชื่อยี่ห้อ',
  shortCode: 'รหัสย่อ',
  productTypeName: 'ชื่อประเภทสินค้า',
  productTypeDescription: 'รายละเอียด',
  symptomName: 'อาการเสีย',
  symptomDescription: 'รายละเอียด',
  marketPrice: 'ราคาตลาด',
  // ลูกค้า
  customerName: 'ชื่อลูกค้า',
  customerAddress: 'ที่อยู่',
  customerAddress1: 'ที่อยู่ (บรรทัด 1)',
  customerAddress2: 'ที่อยู่ (บรรทัด 2)',
  subDistrictId: 'ตำบล / แขวง',
  districtId: 'อำเภอ / เขต',
  cityId: 'จังหวัด',
  postalCode: 'รหัสไปรษณีย์',
  // รุ่นสินค้า: the brand by name (its pk stays out of the log, ADR 0008)
  brand: 'ยี่ห้อ',
  // อะไหล่: the category by name (its pk stays out of the log)
  category: 'หมวดหมู่',
  phoneNumber: 'เบอร์โทรศัพท์',
  lineId: 'LINE ID',
  // ออกเอกสารในนาม / ขนส่ง
  addressLine1: 'ที่อยู่ (บรรทัด 1)',
  addressLine2: 'ที่อยู่ (บรรทัด 2)',
  bankName: 'ธนาคาร',
  bankAccountName: 'ชื่อบัญชี',
  bankAccountNo: 'เลขที่บัญชี',
  bankAccountType: 'ประเภทบัญชี',
  isDefault: 'ค่าเริ่มต้น',
  prefixJob: 'อักษรนำเลขงานซ่อม',
  prefixQuotation: 'อักษรนำเลขใบเสนอราคา',
  prefixSaleOrder: 'อักษรนำเลขใบสั่งขาย',
  trackUrl: 'ลิงก์ติดตามพัสดุ',
  // อะไหล่
  capitalPrice: 'ราคาทุน',
  retailPrice: 'ราคาขายปลีก',
  wholesalePrice: 'ราคาขายส่ง',
  productVenderCode: 'รหัสผู้ผลิต', // legacy log rows (before drizzle/0006)
  productVendorCode: 'รหัสผู้ผลิต',
  // ใบเสนอราคา / ใบสั่งขาย
  quotationStatusId: 'สถานะใบเสนอราคา',
  quotationType: 'แบบใบเสนอราคา',
  totalBaseAmount: 'ยอดก่อนภาษี',
  totalAmount: 'ยอดรวม',
  discountFormula: 'สูตรส่วนลด',
  discountAmount: 'ส่วนลด',
  afterDiscountAmount: 'ยอดหลังหักส่วนลด',
  vatAmount: 'ภาษีมูลค่าเพิ่ม',
  netAmount: 'ยอดสุทธิ',
  approveStatusId: 'สถานะอนุมัติ',
  customerPhoneNumber: 'เบอร์โทรลูกค้า',
  deliveryTrackingNo: 'เลขพัสดุ',
  paymentType: 'วิธีการชำระเงิน',
  paymentAmount: 'จำนวนเงินที่ชำระ',
  remarkHd: 'หมายเหตุ',
  saleOutBy: 'พนักงานขาย',
  customerContactName: 'ชื่อผู้ติดต่อ',
  sparePartAmount: 'รวมค่าอะไหล่',
  serviceAmount: 'ค่าบริการ',
  sumExcludeAmount: 'รวมเป็นเงิน',
  discountType: 'ประเภทส่วนลด',
  vatRate: 'อัตราภาษี (%)',
  roundingAmount: 'ปัดเศษ',
  remark: 'หมายเหตุ',
  customerApproveRemark: 'หมายเหตุการตอบรับ',
  customerCode: 'รหัสลูกค้า',
  slipFileName: 'สลิปการชำระเงิน',
  // งานซ่อม: columns outside the job form's labels
  jobClosedBy: 'ปิดงานโดย',
  jobClosedDate: 'วันที่ปิดงาน',
  jobPaymentSlipFileName: 'สลิปการชำระเงิน',
  documentProfileId: 'ออกเอกสารในนาม',
  quotationNoApproved: 'ใบเสนอราคาที่ลูกค้าตกลง',
  // อะไหล่ / รุ่น / ออกเอกสารในนาม / ขนส่ง
  productName: 'ชื่อสินค้า',
  pictrueFileName: 'รูปสินค้า', // legacy log rows (before drizzle/0006)
  pictureFileName: 'รูปสินค้า',
  modelName: 'ชื่อรุ่น',
  logoPath: 'โลโก้',
  aliases: 'ชื่ออื่นที่ใช้เรียก',
  // งานซ่อม (drizzle/0006 and after)
  jobNo: 'เลขที่งาน',
  parts: 'อะไหล่',
  jobRepairedDate: 'วันที่ซ่อมเสร็จ',
  jobRepairedBy: 'ซ่อมโดย',
  newSerialNo: 'S/N ใหม่',
  // ใบเสนอราคา / ใบสั่งขาย
  quotationNo: 'เลขที่ใบเสนอราคา',
  customerTaxId: 'เลขประจำตัวผู้เสียภาษีลูกค้า',
  customerPhone: 'เบอร์โทรลูกค้า',
  customerApproveDate: 'วันที่ลูกค้าตอบรับ',
  saleOrderNo: 'เลขที่ใบสั่งขาย',
  documentCreateDate: 'วันที่เอกสาร',
  documentCancelDate: 'วันที่ยกเลิก',
  documentCancelRemark: 'เหตุผลการยกเลิก',
  customerCardId: 'เลขบัตรประชาชน / ผู้เสียภาษี',
  customerFaxNumber: 'แฟกซ์',
  feeAmount: 'ค่าธรรมเนียม',
  approveDate: 'วันที่อนุมัติ',
  approveRemark: 'หมายเหตุการอนุมัติ',
  deliveryDate: 'วันที่จัดส่ง',
  // อะไหล่ / รุ่น / ลูกค้า
  productCode: 'รหัสสินค้า',
  productNameEn: 'ชื่อสินค้า (อังกฤษ)',
  productNameCn: 'ชื่อสินค้า (จีน)',
  productDescription: 'รายละเอียดสินค้า',
  cancelRemark: 'เหตุผลการยกเลิก',
  cancelDate: 'วันที่ยกเลิก',
  modelCode: 'รหัสรุ่น',
  faxNumber: 'แฟกซ์',
  customerType: 'ประเภทลูกค้า',
  usePriceGroup: 'กลุ่มราคา',
  isCustomerOnline: 'ลูกค้าออนไลน์',
  symptomGroupName: 'กลุ่มอาการ',
  logoName: 'โลโก้',
  stampPath: 'ตราประทับ',
  purpose: 'ใช้สำหรับ',
  createdAt: 'สร้างเมื่อ',
  createdDate: 'สร้างเมื่อ',
  lastLogin: 'เข้าสู่ระบบล่าสุด',
  // ไฟล์แนบ / สต๊อก / อะไหล่ของงาน / ส่งซ่อมภายนอก
  originalFileName: 'ชื่อไฟล์',
  systemFileName: 'ไฟล์',
  stockMoveNo: 'เลขที่เอกสารสต๊อก',
  stockMoveTypeId: 'ประเภทรายการสต๊อก',
  poNo: 'เลขที่ PO',
  referenceOutTo: 'อ้างอิง',
  sparePartUnitPrice: 'ราคาต่อหน่วย',
  sparePartTotalPrice: 'ราคารวม',
  isQuotation: 'อยู่ในใบเสนอราคา',
  isSpecial: 'รายการพิเศษ',
  requestQty: 'จำนวนที่ขอ',
  requestDate: 'วันที่ขอ',
  jobPartStatusId: 'สถานะอะไหล่',
  grantQty: 'จำนวนที่จ่าย',
  grantDate: 'วันที่จ่าย',
  returnQty: 'จำนวนที่คืน',
  returnDate: 'วันที่คืน',
  sendToName: 'ส่งซ่อมที่',
};

/** a stored column name → its Thai name, or the name itself (own keys only: "constructor" stays "constructor") */
export const fieldLabel = (k: string) => (Object.hasOwn(FIELD_LABEL, k) ? FIELD_LABEL[k]! : k);

/** a changed value as people read it: empty / the legacy 1900-01-01 "no date" → —, yes/no in Thai, a list joined, a
 *  date-only field stored as a timestamp without its 00:00:00 — the job history, the audit log page and its Excel */
export const fieldValue = (v: unknown): string =>
  v === null || v === undefined || v === '' || String(v).startsWith('1900-01-01')
    ? '—'
    : typeof v === 'boolean'
      ? v
        ? 'ใช่'
        : 'ไม่ใช่'
      : Array.isArray(v)
        ? v.map(fieldValue).join(', ')
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v).replace(/^(\d{4}-\d{2}-\d{2}) 00:00:00$/, '$1');
