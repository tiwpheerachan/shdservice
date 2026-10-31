/**
 * Public tracking contract — shared by the server (serializer) and the browser
 * (display). This is the WHOLE of what an anonymous visitor can ever receive:
 * a whitelist, built field by field in services/tracking.ts `toPublic()`. A new
 * column on `job` never reaches the public API unless it is added here on purpose.
 *
 * Never here: prices / costs, phone, address, email, internal notes, technician,
 * customer id, any token. The customer's name and the serial / IMEI are shown in full.
 *
 * Documents (`docs`) are only a list of WHAT exists. The sheet itself (full name, address,
 * prices) is served one at a time by app/track/doc/[ticket] against a one-time ticket from
 * POST /api/track/doc — see drizzle/0019.
 */

export type TrackStepKey = 'received' | 'diagnosing' | 'waiting' | 'repaired' | 'returned';

export type PublicJob = {
  /** job number — printed on the customer's own receipt */
  no: string;
  /** the customer's name as on the job */
  customer: string;
  brandModel: string;
  /** serial, else IMEI, or "" */
  deviceRef: string;
  receivedDate: string;
  dueDate: string;
  /** current step; null while the job is cancelled */
  step: TrackStepKey | null;
  /** UI label of the current status, already softened for customers */
  stepLabel: string;
  cancelled: boolean;
  /** first time each step was reached (from job_log); `label` = what a passed merged step really was ("รออะไหล่") */
  history: { key: TrackStepKey; at: string; label?: string }[];
  /** filled once the job is closed and shipped back */
  shipper: string;
  trackingNo: string;
  closedDate: string;
  /** courier profile of the return leg — logo + link into the courier's own tracking page */
  courier: PublicCourier | null;
  /** the parcel the customer sent the device in with (เลขพัสดุจากลูกค้า), when there is a tracking number */
  inbound: { shipper: string; trackingNo: string; courier: PublicCourier | null } | null;
  /** documents the customer can open, each shown under its step */
  docs: PublicDoc[];
};

/** a courier profile: logo + a link into the courier's own tracking page for this parcel ("" = none) */
export type PublicCourier = { name: string; logoUrl: string; trackUrl: string };

export type TrackDocKind = 'job' | 'quotation' | 'return';

/** a document of this job — what it is, never its content */
export type PublicDoc = {
  kind: TrackDocKind;
  /** job no (ใบรับงานซ่อม / ใบส่งคืนสินค้า) or the quotation no */
  ref: string;
  label: string;
  date: string;
  /** the timeline step it belongs to */
  step: TrackStepKey;
};

/** one row of the customer's job list (phone + OTP) — the full job needs its own request */
export type PublicJobSummary = {
  no: string;
  brandModel: string;
  deviceRef: string;
  receivedDate: string;
  closedDate: string;
  step: TrackStepKey | null;
  stepLabel: string;
  cancelled: boolean;
};

export const TRACK_STEPS: { key: TrackStepKey; label: string; hint: string }[] = [
  { key: 'received', label: 'รับเครื่องแล้ว', hint: 'ศูนย์บริการได้รับเครื่องของคุณแล้ว' },
  { key: 'diagnosing', label: 'กำลังตรวจสอบ / ซ่อม', hint: 'ช่างกำลังตรวจสอบและดำเนินการซ่อม' },
  { key: 'waiting', label: 'รอยืนยัน / รออะไหล่', hint: 'รอคำตอบจากคุณ หรือรออะไหล่เข้า' },
  { key: 'repaired', label: 'ซ่อมเสร็จ', hint: 'ซ่อมเสร็จแล้ว กำลังเตรียมส่งคืน' },
  { key: 'returned', label: 'ส่งคืน / รอรับเครื่อง', hint: 'ส่งคืนแล้ว หรือพร้อมให้มารับที่ศูนย์' },
];

/** link lifetime shown to customers and staff (enforced in services/tracking.ts) */
export const LINK_RULE_TEXT =
  'ลิงก์ใช้ได้ 1 วันนับจากที่ได้รับ และ 15 นาทีหลังเปิดดูครั้งแรก (ต่อเวลาอัตโนมัติขณะใช้งาน สูงสุด 60 นาที)';

/** digits in the /track OTP — must match the ThaiBulkSMS OTP app's setting (OTP Manager) */
export const OTP_LENGTH = 4;
export const OTP_PATTERN = new RegExp(`^\\d{${OTP_LENGTH}}$`);

/** client-facing messages — one per outcome, never the reason (spec §V, §AM) */
export const TRACK_MSG = {
  sessionFail: 'ไม่สามารถยืนยันได้ กรุณาลองใหม่อีกครั้ง',
  ticketFail: 'หมดเวลา กรุณายืนยันอีกครั้ง',
  rateLimited: 'มีคำขอมากเกินไป กรุณาลองใหม่ภายหลัง',
  unavailable: 'ระบบยืนยันตัวตนไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลังหรือติดต่อศูนย์บริการ',
  /** the request never got an answer from the app (offline, proxy error page) — as src/lib/api.ts errMsg */
  network: 'เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
  linkExpired: 'ลิงก์นี้หมดอายุหรือใช้งานไม่ได้แล้ว',
  phoneInvalid: 'กรุณากรอกเบอร์มือถือ 10 หลัก เช่น 0812345678',
  otpRate: 'ขอรหัสถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
  otpFail: 'รหัสไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่ หรือกดขอรหัสใหม่',
  otpUnavailable: 'บริการส่งรหัส OTP ยังไม่เปิดใช้งาน กรุณาติดต่อศูนย์บริการ',
  sessionExpired: 'หมดเวลา กรุณายืนยันเบอร์โทรด้วย OTP อีกครั้ง',
  docFail: 'เปิดเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
  signedOut: 'ออกจากระบบแล้ว',
  notFound: 'ไม่พบรายการ',
  tooLarge: 'ข้อมูลที่ส่งมาใหญ่เกินไป',
} as const;
