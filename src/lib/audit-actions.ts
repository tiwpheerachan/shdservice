/** the audit log's actions in Thai — the page and its Excel export */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  CREATE: 'เพิ่ม',
  UPDATE: 'แก้ไข',
  DELETE: 'ลบ',
  STATUS: 'เปลี่ยนสถานะ',
  APPROVE: 'อนุมัติ',
  ASSIGN: 'มอบหมาย',
  ISSUE: 'จ่ายสต๊อก',
  RECEIVE: 'รับเข้า',
  RETURN: 'รับคืน',
  UPLOAD: 'แนบไฟล์',
  // legacy rows only — sign-in / export / print are logged to security_log, not shown here
  LOGIN: 'เข้าสู่ระบบ',
  LOGIN_FAILED: 'เข้าสู่ระบบไม่สำเร็จ',
  EXPORT: 'ส่งออก Excel',
};

/** a sale order's DELETE is its cancel */
export const auditActionLabel = (r: { action: string; entity: string }) =>
  r.action === 'DELETE' && r.entity === 'sale_order' ? 'ยกเลิก' : (AUDIT_ACTION_LABEL[r.action] ?? r.action);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** the record's number as people know it (J…, Q…, a code) — a record with none (a brand, a symptom) shows none,
 *  never its internal id */
export const auditRecordNo = (r: { no?: string | null; key: string | null }) =>
  r.no || (r.key && !UUID.test(r.key) ? r.key : '');
