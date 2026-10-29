import { MODULE_LABELS, RIGHTS } from '@/lib/modules';
import { JOB_COLUMN_LABEL } from '@/lib/validation/job';

/**
 * Column names as the audit log stores them (audit_log.changes keys) → their Thai name: the job's
 * (ประวัติการแก้ไข) plus every other entity the log records. Shared by the job history, the audit
 * log page and its Excel; a key not listed shows as it is.
 */
export const FIELD_LABEL: Record<string, string> = {
  ...JOB_COLUMN_LABEL,
  ...MODULE_LABELS, // app_config: one key per permission row (a menu or a right)
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
  manufacturerName: 'ชื่อยี่ห้อ',
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
  productVenderCode: 'รหัสผู้ผลิต',
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
};

/** a stored column name → its Thai name, or the name itself (own keys only: "constructor" stays "constructor") */
export const fieldLabel = (k: string) => (Object.hasOwn(FIELD_LABEL, k) ? FIELD_LABEL[k]! : k);
