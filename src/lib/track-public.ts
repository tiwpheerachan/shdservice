/**
 * Public tracking contract — shared by the server (serializer) and the browser
 * (display). This is the WHOLE of what an anonymous visitor can ever receive:
 * a whitelist, built field by field in services/tracking.ts `toPublic()`. A new
 * column on `job` never reaches the public API unless it is added here on purpose.
 *
 * Never here: prices / costs, phone, address, email, internal notes, technician,
 * customer id, full serial / IMEI, any token.
 */

export type TrackStepKey = "received" | "diagnosing" | "waiting" | "repaired" | "returned";

export type PublicJob = {
  /** job number — printed on the customer's own receipt */
  no: string;
  /** "คุณ สม…" — never the full name */
  customerMasked: string;
  brandModel: string;
  /** •••• + last 4 of serial/IMEI, or "" */
  deviceRef: string;
  receivedDate: string;
  dueDate: string;
  /** current step; null while the job is cancelled */
  step: TrackStepKey | null;
  /** UI label of the current status, already softened for customers */
  stepLabel: string;
  cancelled: boolean;
  /** first time each step was reached (from job_log) */
  history: { key: TrackStepKey; at: string }[];
  /** filled once the job is closed and shipped back */
  shipper: string;
  trackingNo: string;
  closedDate: string;
  /** courier profile of the return leg — logo + link into the courier's own tracking page */
  courier: { name: string; logoUrl: string; trackUrl: string } | null;
};

export const TRACK_STEPS: { key: TrackStepKey; label: string; hint: string }[] = [
  { key: "received", label: "รับเครื่องแล้ว", hint: "ศูนย์บริการได้รับเครื่องของคุณแล้ว" },
  { key: "diagnosing", label: "กำลังตรวจสอบ / ซ่อม", hint: "ช่างกำลังตรวจสอบและดำเนินการซ่อม" },
  { key: "waiting", label: "รอยืนยัน / รออะไหล่", hint: "รอคำตอบจากคุณ หรือรออะไหล่เข้า" },
  { key: "repaired", label: "ซ่อมเสร็จ", hint: "ซ่อมเสร็จแล้ว กำลังเตรียมส่งคืน" },
  { key: "returned", label: "ส่งคืน / รอรับเครื่อง", hint: "ส่งคืนแล้ว หรือพร้อมให้มารับที่ศูนย์" },
];

/** client-facing messages — one per outcome, never the reason (spec §V, §AM) */
export const TRACK_MSG = {
  sessionFail: "ไม่สามารถยืนยันได้ กรุณาลองใหม่อีกครั้ง",
  ticketFail: "หมดเวลา กรุณายืนยันอีกครั้ง",
  rateLimited: "มีคำขอมากเกินไป กรุณาลองใหม่ภายหลัง",
  unavailable: "ระบบยืนยันตัวตนไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลังหรือติดต่อศูนย์บริการ",
} as const;
